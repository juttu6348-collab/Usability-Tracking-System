// Verify previously generated browser interactions against both HTTP and the on-disk DB.
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { writeFileSync } = require('node:fs');
async function main() {
  const base = process.env.VERIFY_URL || 'http://localhost:3001';
  const db = new DatabaseSync(process.env.DB_PATH || 'data/analytics.sqlite', { readOnly: true });
  try {
    const counts = db.prepare('SELECT event_type,count(*) count FROM events WHERE project_id=? GROUP BY event_type').all('demo-project');
    for (const type of ['page_view', 'click', 'scroll_depth', 'focus', 'form_interaction', 'form_submit', 'mouse_move', 'page_active', 'element_attention']) {
      assert.ok(counts.find(row => row.event_type === type)?.count > 0, `Missing ${type}: generate demo interactions first`);
    }
    const privateMatches = db.prepare('SELECT count(*) n FROM events WHERE payload LIKE ?').get('%PHASE2_PRIVATE%').n;
    assert.equal(privateMatches, 0);
    const get = async suffix => {
      const response = await fetch(`${base}/api/projects/demo-project/${suffix}`);
      assert.equal(response.status, 200); return response.json();
    };
    const summary = await get('summary');
    assert.equal(summary.total_page_views, counts.find(row => row.event_type === 'page_view').count);
    const filtered = await get('events?event_type=click&page=%2F');
    assert.ok(filtered.total > 0); assert.ok(filtered.events.every(e => e.event_type === 'click' && e.page_path === '/'));
    const heatmap = await get('heatmap?page=%2F');
    assert.equal(heatmap.points.reduce((total, point) => total + point.count, 0), filtered.total);
    const report = { verified_at: new Date().toISOString(), counts, private_value_matches: privateMatches, summary, heatmap };
    writeFileSync('data/verification.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
