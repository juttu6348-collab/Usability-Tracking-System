const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { writeFileSync } = require('node:fs');
async function main() {
  const db = new DatabaseSync(process.env.DB_PATH || 'data/analytics.sqlite', { readOnly: true });
  try {
    const events = db.prepare('SELECT payload FROM events WHERE project_id=?').all('demo-project').map(row => JSON.parse(row.payload));
    const response = await fetch((process.env.VERIFY_URL || 'http://localhost:3001') + '/api/projects/demo-project/dashboard');
    assert.equal(response.status, 200); const data = await response.json();
    const sessions = new Set(events.map(e => e.session_id));
    const views = events.filter(e => e.event_type === 'page_view');
    const active = events.filter(e => e.event_type === 'page_active').reduce((sum, e) => sum + e.duration_ms, 0);
    assert.equal(data.total_sessions, sessions.size); assert.equal(data.total_page_views, views.length);
    assert.equal(data.average_session_duration_ms, sessions.size ? active / sessions.size : 0);
    const depths = views.map(view => Math.max(0, ...events.filter(e => e.event_type === 'scroll_depth' && e.session_id === view.session_id && e.page_url === view.page_url && e.page_view_id === view.page_view_id).map(e => e.scroll_percentage)));
    assert.equal(data.average_scroll_depth, depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0);
    for (const milestone of data.scroll) assert.equal(milestone.page_views, depths.filter(d => d >= milestone.depth).length);
    for (const page of data.pages) {
      const pageViews = views.filter(e => e.page_url === page.page_url);
      const time = events.filter(e => e.event_type === 'page_active' && pageViews.some(v => v.session_id === e.session_id && v.page_view_id === e.page_view_id && v.page_url === e.page_url)).reduce((sum,e) => sum + e.duration_ms,0);
      assert.equal(page.views, pageViews.length); assert.equal(page.average_active_ms, time / pageViews.length);
    }
    for (const section of data.attention) assert.equal(section.duration_ms, events.filter(e => e.event_type === 'element_attention' && e.page_path === section.page_path && e.element.selector === section.selector).reduce((sum,e) => sum + e.duration_ms,0));
    assert.ok(!JSON.stringify(events).includes('PHASE3_PRIVATE'));
    writeFileSync('data/dashboard-verification.json', JSON.stringify({ passed: true, ...data }, null, 2));
    console.log(JSON.stringify({ passed: true, stored_events: events.length, sessions: sessions.size, views: views.length, average_scroll_depth: data.average_scroll_depth, average_session_duration_ms: data.average_session_duration_ms, private_value_matches: 0 }));
  } finally { db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
