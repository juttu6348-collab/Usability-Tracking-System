'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createApp } = require('../backend/server');
const { openDatabase } = require('../backend/database');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
async function until(check, label) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Timed out: ' + label);
}
async function main() {
  fs.mkdirSync('data', { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('data/integration-'));
  const filename = path.join(directory, 'analytics.sqlite');
  let collector;
  const host = http.createServer((req, res) => {
    const name = req.url.startsWith('/shop') ? 'shop' : req.url.startsWith('/docs') ? 'docs' : null;
    res.setHeader('Content-Type', 'text/html');
    res.end(name ? fs.readFileSync(path.resolve(`tests/fixtures/${name}.html`), 'utf8').replace('__TRACKER_ORIGIN__', collector) : '<!doctype html><title>Blank</title>Untracked page');
  });
  const origin = await listen(host);
  const app = createApp({ dbPath: filename, projects: ['integration-project'], origins: [origin] });
  // Observe actual server requests: browser automation may detach before unload
  // beacon network/console events are delivered to its page session.
  const received = [];
  app.server.prependListener('request', (req, res) => {
    if (req.url !== '/api/events' || req.method !== 'POST') return;
    const chunks = [];
    const record = { transport: req.headers['sec-fetch-mode'] === 'no-cors' ? 'beacon' : 'fetch' };
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { record.body = JSON.parse(Buffer.concat(chunks).toString()); received.push(record); });
    res.on('finish', () => { record.status = res.statusCode; });
  });
  collector = await listen(app.server);
  let browser;
  const report = { fixture_origin: origin, collector_origin: collector, checks: {}, pages: [], errors: [] };
  const requests = []; const responses = []; const beaconAttempts = [];
  const check = (name, condition) => { assert.ok(condition, name); report.checks[name] = 'PASS'; };
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    context.on('request', request => {
      if (request.url() === collector + '/api/events' && request.method() === 'POST') requests.push({ transport: request.resourceType(), body: JSON.parse(request.postData()) });
    });
    context.on('response', response => { if (response.url() === collector + '/api/events') responses.push(response.status()); });
    await context.addInitScript(() => {
      // Canary data is planted before the SDK loads; none may appear on the wire.
      localStorage.setItem('integration-secret', 'E2E_PRIVATE_STORAGE');
      document.cookie = 'integration=E2E_PRIVATE_COOKIE;path=/';
      window.__storageReads = 0; window.__cookieReads = 0; window.__listeners = {};
      window.__scrollRuns = 0;
      const timeout = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => timeout(() => {
        if (callback.name === 'scroll') window.__scrollRuns++;
        callback(...args);
      }, delay);
      const getItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (...args) { window.__storageReads++; return getItem.apply(this, args); };
      const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
      Object.defineProperty(document, 'cookie', { configurable: true, get() { window.__cookieReads++; return cookie.get.call(this); }, set(value) { cookie.set.call(this, value); } });
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, ...args) {
        if (this === document || this === window) window.__listeners[type] = (window.__listeners[type] || 0) + 1;
        return add.call(this, type, ...args);
      };
      const beacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (...args) => {
        try { const accepted = beacon(...args); localStorage.setItem('e2e-beacon', String(accepted)); console.debug('E2E_BEACON:' + accepted); return accepted; }
        catch (error) { localStorage.setItem('e2e-beacon-error', error.message); throw error; }
      };
    });
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.text().startsWith('E2E_BEACON:')) beaconAttempts.push(message.text() === 'E2E_BEACON:true'); });
    for (const fixture of ['shop', 'docs']) {
      await page.goto(origin + '/' + fixture + '?token=E2E_PRIVATE_TOKEN#E2E_PRIVATE_FRAGMENT');
      await page.bringToFront();
      await page.waitForFunction(() => Boolean(window.UsabilityTracker));
      // No page annotations and no inline tracker init on either fixture.
      await page.waitForTimeout(400);
      const before = await page.evaluate(() => ({ ...window.__listeners }));
      await page.addScriptTag({ url: collector + '/tracker.js' });
      const after = await page.evaluate(() => ({ ...window.__listeners }));
      for (const name of ['click', 'mousemove', 'scroll', 'focusin', 'focusout', 'change', 'submit', 'visibilitychange']) assert.equal(after[name], before[name], 'Duplicate listener: ' + name);
      await page.locator('#buy').click();
      await page.locator('#link').click();
      await page.locator('input[name=name]').fill('E2E_PRIVATE_INPUT');
      await page.locator('input[type=email]').fill('E2E_PRIVATE_EMAIL@example.invalid');
      await page.locator('input[type=password]').fill('E2E_PRIVATE_PASSWORD');
      await page.locator('textarea').fill('E2E_PRIVATE_MESSAGE');
      await page.locator('button[type=submit]').click();
      await page.evaluate(() => {
        const el = document.createElement('div'); el.contentEditable = 'true'; el.textContent = 'E2E_PRIVATE_EDITABLE'; document.body.append(el); el.focus();
        const card = document.createElement('input'); card.value = 'E2E_PRIVATE_CARD'; card.autocomplete = 'cc-number'; document.body.append(card); card.dispatchEvent(new Event('change', { bubbles: true }));
        const otp = document.createElement('input'); otp.value = 'E2E_PRIVATE_OTP'; otp.autocomplete = 'one-time-code'; document.body.append(otp); otp.focus();
      });
      if (fixture === 'docs') await page.locator('#route').click();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(250);
      // Isolate a high-frequency burst and prove it cannot create one event per DOM event.
      await page.evaluate(() => window.UsabilityTracker.init().flush());
      await page.waitForTimeout(350);
      const requestIndex = requests.length;
      const scrollRuns = await page.evaluate(() => window.__scrollRuns);
      await page.evaluate(() => {
        for (let i = 0; i < 1000; i++) {
          document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 }));
          window.dispatchEvent(new Event('scroll'));
        }
      });
      await page.waitForTimeout(200);
      await page.evaluate(() => window.UsabilityTracker.init().flush());
      await page.waitForTimeout(150);
      const burst = requests.slice(requestIndex).flatMap(r => r.body.events);
      const mouse = burst.filter(e => e.type === 'mouse_move').length;
      check(fixture + ': mouse sampling (1000 events)', mouse >= 1 && mouse <= 2);
      check(fixture + ': scroll burst bounded', burst.filter(e => e.type === 'scroll_depth').length <= 4);
      check(fixture + ': scroll throttled (1000 events)', await page.evaluate(() => window.__scrollRuns) - scrollRuns === 1);
      const reads = await page.evaluate(() => ({ storage: window.__storageReads, cookies: window.__cookieReads }));
      check(fixture + ': no storage or cookie reads', reads.storage === 0 && reads.cookies === 0);
      // Leave enough focused time to produce an active-duration checkpoint on pagehide.
      await page.waitForTimeout(450);
      const beaconStart = received.filter(r => r.transport === 'beacon').length;
      await page.evaluate(() => document.querySelector('#buy').click());
      await page.evaluate(() => {
        window.addEventListener('pagehide', () => localStorage.setItem('e2e-pagehide', 'yes'));
        document.addEventListener('visibilitychange', () => localStorage.setItem('e2e-visibility', document.visibilityState));
      });
      await page.goto(origin + '/blank');
      report.lifecycle_debug = await page.evaluate(() => ({ pagehide: localStorage.getItem('e2e-pagehide'), visibility: localStorage.getItem('e2e-visibility'), beacon: localStorage.getItem('e2e-beacon'), beacon_error: localStorage.getItem('e2e-beacon-error') }));
      check(fixture + ': sendBeacon accepted', report.lifecycle_debug.beacon === 'true');
      await until(() => received.filter(r => r.transport === 'beacon' && r.status === 200).length > beaconStart, fixture + ' beacon delivered');
      check(fixture + ': unload beacon delivered', true);
      await until(() => app.store.db.prepare('SELECT count(*) n FROM events WHERE page_path=?').get('/' + fixture).n > 0, 'database events');
      report.pages.push({ fixture, burst_mouse_events: mouse, burst_scroll_calculations: 1, cookie_reads: reads.cookies, storage_reads: reads.storage });
    }
    await until(() => received.every(r => r.status), 'all collector responses');
    const events = received.flatMap(r => r.body.events);
    const stored = app.store.db.prepare('SELECT payload FROM events').all().map(row => JSON.parse(row.payload));
    for (const type of ['page_view','page_active','click','focus','scroll_depth','form_interaction','form_submit','mouse_move','element_attention']) check(type, stored.some(e => e.event_type === type));
    for (const fixture of ['shop','docs']) for (const type of ['page_view','click','form_interaction','form_submit','element_attention']) check(fixture + ': ' + type, stored.some(e => e.page_path === '/' + fixture && e.event_type === type));
    check('button interactions', stored.some(e => e.event_type === 'click' && e.element.tag === 'button'));
    check('link interactions', stored.some(e => e.event_type === 'click' && e.element.tag === 'a'));
    check('all scroll thresholds', [25,50,75,100].every(depth => stored.some(e => e.scroll_percentage === depth)));
    check('SPA navigation', stored.some(e => e.event_type === 'page_view' && e.page_path === '/docs/guide'));
    check('sessions created', new Set(stored.map(e => e.session_id)).size === 2);
    check('duplicate script idempotent', events.filter(e => e.type === 'page_view').length === 3);
    check('fetch batching', received.some(r => r.transport === 'fetch' && r.body.events.length > 1));
    check('batch limit', received.every(r => r.body.events.length <= 20));
    check('sendBeacon flushing', received.filter(r => r.transport === 'beacon').length >= 2);
    check('collector responses', received.every(r => r.status === 200));
    check('wire privacy', !JSON.stringify(events).includes('E2E_PRIVATE'));
    check('database privacy', !JSON.stringify(stored).includes('E2E_PRIVATE'));
    check('all wire events persisted', events.every(e => stored.some(s => s.event_id === e.event_id)));
    const summary = await (await fetch(collector + '/api/projects/integration-project/dashboard')).json();
    assert.equal(summary.total_sessions, 2); assert.equal(summary.total_page_views, 3);
    await page.goto(collector + '/dashboard');
    await page.waitForFunction(() => document.getElementById('views').textContent === '3');
    check('dashboard analytics', await page.locator('#sessions').textContent() === '2' && await page.locator('#events').textContent() === String(stored.length) && summary.attention.length > 0 && summary.average_session_duration_ms > 0);
    await page.selectOption('#filter-page', '/shop'); await page.selectOption('#filter-event', 'click');
    check('dashboard filters', await page.locator('#interactions tr').count() > 0 && await page.locator('#pages tr').count() === 1);
    await page.locator('#recent tr').first().click();
    await page.waitForFunction(() => document.querySelectorAll('#timeline tr').length > 0);
    check('session timeline', await page.locator('#timeline tr').count() > 0 && !(await page.locator('#timeline').textContent()).includes('E2E_PRIVATE'));
    await page.selectOption('#heat-page', origin + '/shop');
    await page.waitForFunction(() => document.getElementById('heatmap').getAttribute('aria-label').startsWith('Click density:'));
    const heat = await (await fetch(collector + '/api/projects/integration-project/heatmap?page=%2Fshop')).json();
    check('click heatmap', heat.points.reduce((sum,p) => sum + p.count,0) === stored.filter(e => e.page_path === '/shop' && e.event_type === 'click').length);
    await page.screenshot({ path: path.join(directory, 'dashboard.png'), fullPage: true });
    check('browser errors', report.errors.length === 0);
    report.event_counts = Object.fromEntries([...new Set(stored.map(e => e.event_type))].map(type => [type, stored.filter(e => e.event_type === type).length]));
    report.batches = received.map(r => ({ transport: r.transport, events: r.body.events.length, status: r.status }));
    await close(app.server);
    const reopened = openDatabase(filename, ['integration-project']);
    check('database restart persistence', reopened.db.prepare('SELECT count(*) n FROM events').get().n === stored.length); reopened.close();
    report.status = 'PASS';
  } catch (error) { report.status = 'FAIL'; report.failure = error.stack; throw error; }
  finally {
    report.batches = received.map(r => ({ transport: r.transport, events: r.body.events.length, status: r.status }));
    report.beacon_attempts = beaconAttempts; report.response_statuses = responses;
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync('data/latest-integration-report.json', JSON.stringify({ directory, ...report }, null, 2));
    if (browser) await browser.close();
    if (app.server.listening) await close(app.server); await close(host);
    console.log(JSON.stringify({ status: report.status, directory, checks: report.checks, failure: report.failure }, null, 2));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
