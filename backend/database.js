'use strict';
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const { HttpError } = require('./validation');
function openDatabase(filename, projects) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS projects (project_id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      project_id TEXT NOT NULL REFERENCES projects(project_id), session_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
      active_duration_ms REAL NOT NULL DEFAULT 0, PRIMARY KEY(project_id, session_id));
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, event_id TEXT NOT NULL,
      session_id TEXT NOT NULL, event_type TEXT NOT NULL, page_url TEXT NOT NULL,
      page_path TEXT NOT NULL, timestamp TEXT NOT NULL, received_at TEXT NOT NULL,
      payload TEXT NOT NULL, UNIQUE(project_id, event_id),
      FOREIGN KEY(project_id, session_id) REFERENCES sessions(project_id, session_id));
    CREATE INDEX IF NOT EXISTS events_project_time ON events(project_id, timestamp);
    CREATE INDEX IF NOT EXISTS events_session ON events(project_id, session_id, id);
    CREATE INDEX IF NOT EXISTS events_page ON events(project_id, page_path, id);
    CREATE INDEX IF NOT EXISTS events_type ON events(project_id, event_type, id);`);
  for (const id of projects) db.prepare('INSERT OR IGNORE INTO projects VALUES (?, ?)').run(id, new Date().toISOString());
  function ingest(events) {
    let inserted = 0; db.exec('BEGIN IMMEDIATE');
    try {
      for (const e of events) {
        if (!db.prepare('SELECT 1 FROM projects WHERE project_id=?').get(e.project_id)) throw new HttpError(403, 'Unknown project');
        const session = db.prepare('SELECT visitor_id FROM sessions WHERE project_id=? AND session_id=?').get(e.project_id, e.session_id);
        if (session && session.visitor_id !== e.visitor_id) throw new HttpError(409, 'Session visitor mismatch');
        if (db.prepare('SELECT 1 FROM events WHERE project_id=? AND event_id=?').get(e.project_id, e.event_id)) continue;
        db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id, session_id) DO UPDATE SET
          first_seen=min(first_seen, excluded.first_seen), last_seen=max(last_seen, excluded.last_seen),
          active_duration_ms=active_duration_ms+excluded.active_duration_ms`).run(
          e.project_id, e.session_id, e.visitor_id, e.timestamp, e.timestamp, e.event_type === 'page_active' ? e.duration_ms : 0);
        db.prepare('INSERT INTO events(project_id,event_id,session_id,event_type,page_url,page_path,timestamp,received_at,payload) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(e.project_id, e.event_id, e.session_id, e.event_type, e.page_url, e.page_path, e.timestamp, new Date().toISOString(), JSON.stringify(e));
        inserted++;
      }
      db.exec('COMMIT'); return { accepted: events.length, inserted, duplicates: events.length - inserted };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function summary(project) {
    const totals = db.prepare('SELECT count(*) total_sessions, coalesce(avg(active_duration_ms),0) average_session_duration_ms FROM sessions WHERE project_id=?').get(project);
    return { ...totals,
      total_page_views: db.prepare("SELECT count(*) n FROM events WHERE project_id=? AND event_type='page_view'").get(project).n,
      most_visited_pages: db.prepare("SELECT page_url, page_path, count(*) page_views FROM events WHERE project_id=? AND event_type='page_view' GROUP BY page_url,page_path ORDER BY page_views DESC, page_url LIMIT 20").all(project),
      most_clicked_elements: db.prepare("SELECT page_url, json_extract(payload,'$.element.selector') selector, count(*) clicks FROM events WHERE project_id=? AND event_type='click' GROUP BY page_url,selector ORDER BY clicks DESC, page_url,selector LIMIT 20").all(project),
      scroll_depth_statistics: db.prepare(`SELECT page_url, json_extract(payload,'$.scroll_percentage') percentage,
        count(*) events, count(DISTINCT session_id) sessions, count(DISTINCT json_extract(payload,'$.page_view_id')) page_views
        FROM events WHERE project_id=? AND event_type='scroll_depth' GROUP BY page_url,percentage ORDER BY page_url,percentage`).all(project) };
  }
  return { db, ingest, summary, close: () => db.close() };
}
module.exports = { openDatabase };
