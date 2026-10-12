'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { createApp } = require('../backend/server');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
async function until(check, label) {
  for (let attempt = 0; attempt < 120; attempt++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Timed out: ' + label);
}
function host(name) {
  return http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><style>body{font:18px system-ui;margin:30px}section{height:700px}button,input{font:inherit}</style></head><body><section><h1>${name}</h1><button id="action">Action</button><form onsubmit="event.preventDefault()"><label>Email <input type="email"></label><button type="submit">Submit</button></form></section><section><h2>More content</h2></section></body></html>`);
  });
}
async function main() {
  const step = message => console.log(`[extension-e2e] ${message}`);
  const extensionPath = path.resolve('extension');
  assert.deepEqual(fs.readFileSync(path.join(extensionPath, 'tracker.js')), fs.readFileSync(path.resolve('dist/tracker.js')), 'Extension tracker must exactly match dist/tracker.js');
  const firstServer = host('Extension test one'); const secondServer = host('Extension test two');
  const firstOrigin = await listen(firstServer); const secondOrigin = await listen(secondServer);
  const directory = fs.mkdtempSync(path.resolve('data/extension-test-'));
  const database = path.join(directory, 'analytics.sqlite');
  const app = createApp({ dbPath: database, projects: ['extension-project'], origins: [firstOrigin, secondOrigin] });
  const collector = await listen(app.server);
  step('local sites and collector started');
  const profile = path.join(directory, 'profile');
  // Unpacked MV3 extensions require an extension-capable headed Chromium session.
  let context;
  const report = { status: 'FAIL', origins: [firstOrigin, secondOrigin], checks: {} };
  const pass = (name, condition) => { assert.ok(condition, name); report.checks[name] = 'PASS'; };
  try {
    context = await chromium.launchPersistentContext(profile, { headless: false,
      timeout: 15_000,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
    step('Chromium launched');
    let workers = context.serviceWorkers();
    if (!workers.length) workers = [await context.waitForEvent('serviceworker', { timeout: 15_000 })];
    const worker = workers[0]; const extensionId = new URL(worker.url()).host;
    step('extension service worker ready');
    await worker.evaluate(async config => {
      await chrome.storage.sync.set(config);
      await new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: 'sync-registrations' }, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    }, { enabled: true, projectId: 'extension-project', endpoint: collector + '/api/events', allowedOrigins: [firstOrigin, secondOrigin] });
    const storedSettings = await worker.evaluate(() => chrome.storage.sync.get(null));
    pass('settings persistence', storedSettings.projectId === 'extension-project' && storedSettings.allowedOrigins.length === 2);
    step('extension settings stored');

    for (const [origin, name] of [[firstOrigin, 'first'], [secondOrigin, 'second']]) {
      const page = await context.newPage(); await page.goto(origin + '/test');
      await page.locator('#action').click(); await page.locator('input').fill('EXTENSION_PRIVATE_EMAIL@example.invalid');
      await page.locator('button[type=submit]').click(); await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(300); await page.goto(origin + '/done');
      await until(() => app.store.db.prepare("SELECT count(*) n FROM events WHERE project_id=? AND page_url LIKE ?").get('extension-project', origin + '%').n > 0, name + ' origin events');
      pass(name + ' local website tracked', true); await page.close();
      step(`${name} local website tracked`);
    }
    const stored = () => app.store.db.prepare('SELECT payload FROM events WHERE project_id=?').all('extension-project').map(row => JSON.parse(row.payload));
    pass('tracker injected', stored().some(event => event.event_type === 'page_view'));
    pass('interactions delivered', ['click', 'form_interaction', 'form_submit', 'scroll_depth'].every(type => stored().some(event => event.event_type === type)));
    pass('privacy preserved', !JSON.stringify(stored()).includes('EXTENSION_PRIVATE_EMAIL'));
    pass('two origins share backend', new Set(stored().map(event => new URL(event.page_url).origin)).size === 2);
    step('delivery and privacy assertions passed');

    const duplicatePage = await context.newPage(); await duplicatePage.goto(firstOrigin + '/duplicate');
    await until(() => stored().filter(event => event.page_url === firstOrigin + '/duplicate' && event.event_type === 'page_view').length === 1, 'initial duplicate page view');
    const [tab] = await worker.evaluate(async url => chrome.tabs.query({ url: url + '/*' }), firstOrigin);
    await worker.evaluate(async ({ tabId }) => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['tracker.js', 'content.js'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['tracker.js', 'content.js'] });
    }, { tabId: tab.id });
    await duplicatePage.waitForTimeout(400);
    pass('duplicate injection idempotent', stored().filter(event => event.page_url === firstOrigin + '/duplicate' && event.event_type === 'page_view').length === 1);
    await duplicatePage.close();
    step('duplicate injection assertion passed');

    await worker.evaluate(async origin => {
      const settings = await chrome.storage.sync.get({ allowedOrigins: [] });
      await chrome.storage.sync.set({ allowedOrigins: settings.allowedOrigins.filter(item => item !== origin) });
      await new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: 'sync-registrations' }, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    }, firstOrigin);
    const before = stored().length; const disabled = await context.newPage(); await disabled.goto(firstOrigin + '/disabled'); await disabled.waitForTimeout(500);
    pass('per-site disable', stored().length === before); await disabled.close();
    const enabled = await context.newPage(); await enabled.goto(secondOrigin + '/still-enabled');
    await until(() => stored().some(event => event.page_url === secondOrigin + '/still-enabled'), 'second origin remains enabled');
    pass('other allowed site remains enabled', true); await enabled.close();
    step('site enable and disable assertions passed');

    const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
    pass('options UI loads settings', await options.locator('#project').inputValue() === 'extension-project' && await options.locator('#origins li').count() === 1); await options.close();
    const dashboard = await context.newPage(); await dashboard.goto(collector + '/dashboard');
    await dashboard.waitForFunction(() => document.querySelector('#views')?.textContent !== '—');
    pass('dashboard receives extension events', Number((await dashboard.locator('#views').textContent()).replaceAll(',', '')) >= 5); await dashboard.close();
    step('options and dashboard assertions passed');
    report.status = 'PASS'; report.event_count = stored().length; report.extension_id = extensionId;
  } finally {
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync('data/latest-extension-report.json', JSON.stringify({ directory, ...report }, null, 2));
    if (context) await context.close();
    await close(app.server); await close(firstServer); await close(secondServer);
  }
  console.log(JSON.stringify({ directory, ...report }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
