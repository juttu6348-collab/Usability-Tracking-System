// Run in the dashboard's browser context: agent-browser eval --stdin < this file.
(async () => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const data = await (await fetch('/api/projects/' + encodeURIComponent(document.getElementById('project').value) + '/dashboard')).json();
  assert(document.getElementById('sessions').textContent === new Intl.NumberFormat().format(data.total_sessions), 'Session card mismatch');
  assert(document.getElementById('views').textContent === new Intl.NumberFormat().format(data.total_page_views), 'Page-view card mismatch');
  assert(document.getElementById('depth').textContent === data.average_scroll_depth.toFixed(1) + '%', 'Scroll card mismatch');
  assert(document.getElementById('duration').textContent === duration(data.average_session_duration_ms), 'Duration card mismatch');
  assert(document.getElementById('recent').rows.length === data.recent_sessions.length, 'Session table mismatch');
  assert(document.documentElement.scrollWidth <= innerWidth, 'Mobile horizontal overflow');
  assert(document.getElementById('error').hidden, 'Dashboard error visible');
  assert(document.getElementById('heatmap').getAttribute('aria-label').includes('Click density:'), 'Heatmap missing click data');
  return { passed: true, sessions: data.total_sessions, views: data.total_page_views,
    average_scroll_depth: data.average_scroll_depth, average_session_duration_ms: data.average_session_duration_ms,
    heatmap: document.getElementById('heatmap').getAttribute('aria-label'), width: innerWidth };
})();
