'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { openDatabase } = require('./database');
const { dashboard } = require('./analytics');
const { HttpError, check, identifier, TYPES, validateBatch } = require('./validation');
function createApp(options = {}) {
  const config = { dbPath: path.resolve(__dirname, '../data/analytics.sqlite'), projects: ['demo-project'],
    origins: ['http://localhost:3001', 'http://127.0.0.1:3001'], maxBytes: 65536, maxBatch: 50, ...options };
  check(config.projects.length > 0 && config.projects.every(identifier), 'Invalid configured projects');
  check(Number.isInteger(config.maxBytes) && config.maxBytes > 0 && config.maxBytes <= 1048576, 'Invalid byte limit');
  check(Number.isInteger(config.maxBatch) && config.maxBatch > 0 && config.maxBatch <= 500, 'Invalid batch limit');
  for (const origin of config.origins) check(new URL(origin).origin === origin && /^https?:/.test(origin), 'Use exact HTTP(S) origins');
  const store = openDatabase(config.dbPath, config.projects);
  const send = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
  async function readBody(req) {
    if (Number(req.headers['content-length']) > config.maxBytes) { req.resume(); throw new HttpError(413, 'Request too large'); }
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = []; let exceeded = false;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > config.maxBytes) { if (!exceeded) reject(new HttpError(413, 'Request too large')); exceeded = true; chunks.length = 0; }
        else if (!exceeded) chunks.push(chunk);
      });
      req.on('end', () => { if (exceeded) return; try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); } });
      req.on('error', () => reject(new HttpError(400, 'Request interrupted')));
      req.on('aborted', () => reject(new HttpError(400, 'Request interrupted')));
    });
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const origin = req.headers.origin;
      res.setHeader('Vary', 'Origin');
      if (origin && !config.origins.includes(origin)) throw new HttpError(403, 'Origin not allowed');
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }); return res.end();
      }
      if (url.pathname === '/api/events') {
        if (req.method !== 'POST') throw new HttpError(405, 'POST required');
        const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!['application/json', 'text/plain'].includes(contentType)) throw new HttpError(415, 'JSON or text/plain required');
        if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new HttpError(415, 'Compressed requests unsupported');
        const events = validateBatch(await readBody(req), config.maxBatch);
        if (events.some(e => !config.projects.includes(e.project_id))) throw new HttpError(403, 'Unknown project');
        return send(res, 200, store.ingest(events));
      }
      if (url.pathname === '/api/projects' && req.method === 'GET') return send(res, 200, { projects: config.projects });
      if (url.pathname === '/api/health' && req.method === 'GET') return send(res, 200, { status: 'ok' });
      const match = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]+)\/(summary|events|heatmap|dashboard)$/);
      if (match) {
        if (req.method !== 'GET') throw new HttpError(405, 'GET required');
        const [, project, action] = match;
        if (!config.projects.includes(project)) throw new HttpError(404, 'Project not found');
        if (action === 'summary') return send(res, 200, store.summary(project));
        if (action === 'dashboard') return send(res, 200, dashboard(store.db, project));
        const filters = ['project_id=?']; const args = [project];
        for (const [param, column] of [['session', 'session_id'], ['page', 'page_path'], ['event_type', 'event_type']]) {
          const value = url.searchParams.get(param);
          if (value !== null) {
            check(value.length > 0 && value.length <= 1024, 'Invalid filter');
            if (param === 'event_type') check(TYPES.includes(value), 'Unknown event type');
            filters.push(`${column}=?`); args.push(value);
          }
        }
        const integer = (name, fallback, min, max) => {
          const raw = url.searchParams.get(name); const value = raw === null ? fallback : Number(raw);
          check((raw === null || /^\d+$/.test(raw)) && Number.isSafeInteger(value) && value >= min && value <= max, `Invalid ${name}`); return value;
        };
        const limit = integer('limit', action === 'events' ? 100 : 500, 1, action === 'events' ? 500 : 2000);
        const offset = integer('offset', 0, 0, 1000000);
        if (action === 'events') {
          const where = filters.join(' AND ');
          const rows = store.db.prepare(`SELECT id,payload FROM events WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`).all(...args, limit, offset);
          return send(res, 200, { total: store.db.prepare(`SELECT count(*) n FROM events WHERE ${where}`).get(...args).n, limit, offset,
            events: rows.map(row => ({ id: row.id, ...JSON.parse(row.payload) })) });
        }
        filters.push("event_type='click'");
        const bin = integer('bin', 20, 1, 200);
        const rows = store.db.prepare(`SELECT page_url, page_path,
          json_extract(payload,'$.viewport.width') viewport_width, json_extract(payload,'$.viewport.height') viewport_height,
          CAST(json_extract(payload,'$.x') / ? AS INTEGER) * ? x,
          CAST(json_extract(payload,'$.y') / ? AS INTEGER) * ? y, count(*) count
          FROM events WHERE ${filters.join(' AND ')} GROUP BY page_url,page_path,viewport_width,viewport_height,x,y
          ORDER BY page_url,viewport_width,viewport_height,x,y LIMIT ? OFFSET ?`).all(bin, bin, bin, bin, ...args, limit + 1, offset);
        return send(res, 200, { coordinate_space: 'page', bin_size: bin, limit, offset, has_more: rows.length > limit, points: rows.slice(0, limit) });
      }
      const files = { '/': ['demo/index.html', 'text/html'], '/demo': ['demo/index.html', 'text/html'], '/demo/': ['demo/index.html', 'text/html'],
        '/tracker.js': ['dist/tracker.js', 'text/javascript'],
        '/dashboard': ['dashboard/index.html', 'text/html'], '/dashboard/': ['dashboard/index.html', 'text/html'],
        '/dashboard/app.js': ['dashboard/app.js', 'text/javascript'], '/dashboard/style.css': ['dashboard/style.css', 'text/css'] };
      if (req.method === 'GET' && Object.hasOwn(files, url.pathname)) {
        const [filename, type] = files[url.pathname];
        const content = await fs.readFile(path.resolve(__dirname, '..', filename));
        res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }); return res.end(content);
      }
      throw new HttpError(404, 'Not found');
    } catch (error) {
      if (!error.status) console.error('Request failed:', error.code || error.name);
      if (!res.destroyed && !res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.on('close', () => store.close());
  return { server, store };
}
module.exports = { createApp };
