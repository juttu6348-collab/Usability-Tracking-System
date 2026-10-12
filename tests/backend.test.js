const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createApp } = require('../backend/server');
const { openDatabase } = require('../backend/database');
function event(type = 'page_view', extra = {}) {
  return { event_id: randomUUID(), project_id: 'demo-project', session_id: 'session-1', visitor_id: 'visitor-1',
    type, page: { url: 'https://example.com/home?token=SECRET', path: '/home', view_id: 'view-1' },
    viewport: { width: 1000, height: 800 }, timestamp: '2026-10-07T10:00:00.000Z', ...extra };
}
async function fixture(t, options = {}) {
  const app = createApp({ dbPath: ':memory:', origins: ['https://example.com'], ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.server.listening ? new Promise(resolve => { app.server.close(resolve); app.server.closeAllConnections(); }) : undefined);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, base, post: (events, headers = {}) => fetch(base + '/api/events', { method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: 'https://example.com', ...headers }, body: JSON.stringify({ schema_version: 1, events }) }),
    get: route => fetch(base + '/api/projects/demo-project/' + route).then(r => r.json()) };
}
test('ingestion, deduplication, analytics, filters and privacy projection', async t => {
  const h = await fixture(t);
  const click = event('click', { element: { tag: 'button', track: 'save', value: 'SECRET', innerHTML: '<script>bad()</script>' }, x: 25, y: 45, relative_x: 5, relative_y: 5, password: 'SECRET' });
  const batch = [event(), click, event('click', { ...click, event_id: randomUUID(), x: 29 }),
    event('page_active', { duration_ms: 1000 }), event('element_attention', { element: { tag: 'section' }, duration_ms: 500 }), event('scroll_depth', { depth: 75 }),
    event('page_view', { session_id: 'session-2' })];
  assert.equal((await h.post(batch)).status, 200);
  assert.equal((await (await h.post(batch)).json()).duplicates, 7);
  const summary = await h.get('summary');
  assert.equal(summary.total_sessions, 2); assert.equal(summary.total_page_views, 2);
  assert.equal(summary.average_session_duration_ms, 500);
  assert.equal(summary.most_clicked_elements[0].clicks, 2);
  assert.equal(summary.scroll_depth_statistics[0].percentage, 75);
  const rows = await h.get('events?session=session-1&page=%2Fhome&event_type=click&limit=1');
  assert.equal(rows.total, 2); assert.equal(rows.events.length, 1);
  assert.doesNotMatch(JSON.stringify(await h.get('events')), /SECRET|script|password|innerHTML/);
  const heat = await h.get('heatmap?page=%2Fhome');
  assert.equal(heat.points.length, 1); assert.equal(heat.points[0].count, 2);
  assert.equal(heat.points[0].x, 20); assert.equal(heat.points[0].y, 40);
});
test('invalid batches never partially commit; session conflict rolls back', async t => {
  const h = await fixture(t);
  for (const invalid of [event('invalid'), event('click'), event('scroll_depth', { depth: 101 }), event('page_view', { timestamp: 'bad' }), event('page_view', { page: { url: 'javascript:alert(1)', path: '/' } })]) {
    assert.equal((await h.post([event(), invalid])).status, 400);
  }
  assert.equal((await h.get('events')).total, 0);
  await h.post([event()]);
  assert.equal((await h.post([event('page_active', { duration_ms: 500 }), event('page_view', { visitor_id: 'different' })])).status, 409);
  assert.equal((await h.get('events')).total, 1);
  assert.equal((await h.get('summary')).average_session_duration_ms, 0);
});
test('CORS, limits, malformed JSON, projects and query validation', async t => {
  const h = await fixture(t, { maxBatch: 2, maxBytes: 2000 });
  assert.equal((await h.post([event()], { Origin: 'https://evil.example' })).status, 403);
  const ok = await h.post([event()]); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://example.com');
  assert.equal((await fetch(h.base + '/api/events', { method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' } })).status, 204);
  assert.equal((await h.post([event(), event(), event()])).status, 400);
  assert.equal((await h.post([event('page_view', { extra: 'x'.repeat(3000) })])).status, 413);
  assert.equal((await h.post([event('page_view', { project_id: 'unknown' })])).status, 403);
  assert.equal((await fetch(h.base + '/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(h.base + '/api/projects/demo-project/events?limit=no')).status, 400);
  assert.equal((await fetch(h.base + '/api/projects/missing/summary')).status, 404);
});
test('SQLite survives close and reopen', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'usability-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'test.sqlite');
  const h = await fixture(t, { dbPath: filename }); await (await h.post([event()])).json();
  await new Promise(resolve => { h.server.close(resolve); h.server.closeAllConnections(); });
  const reopened = openDatabase(filename, ['demo-project']);
  assert.equal(reopened.summary('demo-project').total_page_views, 1); reopened.close();
});

test('dashboard derives per-view scroll, page time, sessions and attention from stored events', async t => {
  const h = await fixture(t);
  const empty = await h.get('dashboard');
  assert.equal(empty.average_scroll_depth, 0); assert.equal(empty.total_sessions, 0);
  assert.deepEqual(empty.pages, []); assert.ok(empty.scroll.every(s => s.percentage === 0));
  const batch = [event(), event('scroll_depth', { depth: 25 }), event('scroll_depth', { depth: 75 }),
    event('scroll_depth', { depth: 75 }), event('page_active', { duration_ms: 2000 }), event('page_active', { duration_ms: 1000 }),
    event('element_attention', { element: { tag: 'section', track: 'reading' }, duration_ms: 1200 }),
    event('element_attention', { element: { tag: 'section', track: 'reading' }, duration_ms: 800 }),
    event('click', { element: { tag: 'button' }, x: 5, y: 5, relative_x: 5, relative_y: 5 }),
    event('page_view', { session_id: 'session-2' })];
  await h.post(batch); await h.post(batch);
  const data = await h.get('dashboard');
  assert.equal(data.total_sessions, 2); assert.equal(data.total_page_views, 2);
  assert.equal(data.total_events, batch.length); assert.equal(data.total_interactions, 1);
  assert.equal(data.measured_page_views, 2); assert.equal(data.average_scroll_depth, 37.5);
  assert.equal(data.average_session_duration_ms, 1500);
  assert.equal(data.pages[0].average_active_ms, 1500); assert.equal(data.pages[0].views, 2);
  assert.equal(data.pages[0].sessions, 2);
  assert.deepEqual(data.scroll.map(s => s.percentage), [50,50,50,0]);
  assert.equal(data.attention[0].duration_ms, 2000); assert.equal(data.attention[0].sessions, 1);
  assert.equal(data.attention[0].average_duration_ms, 1000); assert.equal(data.attention[0].observations, 2);
  assert.equal(data.top_interactions[0].count, 1);
  const session = data.recent_sessions.find(s => s.session_id === 'session-1');
  assert.equal(session.first_page, '/home'); assert.equal(session.pages_visited, 1); assert.equal(session.interactions, 1);
  assert.equal(session.active_duration_ms, 3000);
  const response = await fetch(h.base + '/dashboard'); assert.equal(response.status, 200);
  assert.match(await response.text(), /Click heatmap/);
  assert.equal((await fetch(h.base + '/demo')).status, 200);
  assert.deepEqual(await (await fetch(h.base + '/api/health')).json(), { status: 'ok' });
  assert.deepEqual(await (await fetch(h.base + '/api/projects')).json(), { projects: ['demo-project'] });
});
