'use strict';
const $ = id => document.getElementById(id);
const count = value => new Intl.NumberFormat().format(value);
const duration = ms => ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(Math.round(ms / 1000) / 60)}m ${Math.round(ms / 1000) % 60}s`;
let generation = 0;
let heatGeneration = 0;
let heatPoints = [];
let dashboardData;
async function json(url) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Request failed (${response.status}). Check the server and try Refresh data.`);
  return response.json();
}
const api = () => `/api/projects/${encodeURIComponent($('project').value)}`;
function option(select, value, label) { const node = document.createElement('option'); node.value = value; node.textContent = label; select.append(node); }
function table(id, rows) {
  const body = $(id); body.replaceChildren();
  if (!rows.length) rows = [['No recorded activity yet.']];
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const value of row) {
      const td = document.createElement('td');
      if (Array.isArray(value)) { td.textContent = value[0]; const detail = document.createElement('small'); detail.textContent = value[1]; td.append(detail); }
      else td.textContent = value;
      tr.append(td);
    }
    body.append(tr);
  }
}
function render(data) {
  dashboardData = data;
  $('sessions').textContent = count(data.total_sessions); $('views').textContent = count(data.total_page_views);
  $('events').textContent = count(data.total_events); $('interaction-total').textContent = `${count(data.total_interactions)} direct interactions`;
  $('duration').textContent = duration(data.average_session_duration_ms); $('depth').textContent = `${data.average_scroll_depth.toFixed(1)}%`;
  $('empty').hidden = data.total_page_views > 0;
  syncFilters(data); renderFiltered();
  $('scroll').replaceChildren();
  for (const item of data.scroll) {
    const row = document.createElement('div'); row.className = 'scroll-row';
    const label = document.createElement('div'); label.className = 'scroll-label';
    const name = document.createElement('span'); name.textContent = `${item.depth}% depth`;
    const value = document.createElement('span'); value.textContent = `${item.percentage.toFixed(1)}% · ${count(item.page_views)} views`;
    label.append(name, value);
    const bar = document.createElement('div'); bar.className = 'bar'; const fill = document.createElement('span'); fill.style.width = `${item.percentage}%`; bar.append(fill);
    row.append(label, bar); $('scroll').append(row);
  }
  const previous = $('heat-page').value; $('heat-page').replaceChildren();
  for (const p of data.pages) option($('heat-page'), p.page_url, `${p.page_path} · ${new URL(p.page_url).host}`);
  if (data.pages.some(p => p.page_url === previous)) $('heat-page').value = previous;
}
function syncFilters(data) {
  const previous = { page: $('filter-page').value, event: $('filter-event').value, session: $('filter-session').value };
  const reset = (id, label) => { const select = $(id); select.replaceChildren(); option(select, '', label); return select; };
  const pages = reset('filter-page', 'All pages');
  [...new Set(data.pages.map(p => p.page_path))].forEach(path => option(pages, path, path));
  const events = reset('filter-event', 'All interaction types');
  [...new Set(data.top_interactions.map(e => e.event_type))].sort().forEach(type => option(events, type, type.replaceAll('_', ' ')));
  const sessions = reset('filter-session', 'All sessions');
  data.recent_sessions.forEach(session => option(sessions, session.session_id, session.session_id.slice(0, 12) + '…'));
  if ([...pages.options].some(o => o.value === previous.page)) pages.value = previous.page;
  if ([...events.options].some(o => o.value === previous.event)) events.value = previous.event;
  if ([...sessions.options].some(o => o.value === previous.session)) sessions.value = previous.session;
}
function renderFiltered() {
  if (!dashboardData) return;
  const page = $('filter-page').value; const event = $('filter-event').value; const session = $('filter-session').value;
  const pages = dashboardData.pages.filter(item => !page || item.page_path === page);
  const interactions = dashboardData.top_interactions.filter(item => (!page || item.page_path === page) && (!event || item.event_type === event));
  const attention = dashboardData.attention.filter(item => !page || item.page_path === page);
  const sessions = dashboardData.recent_sessions.filter(item => (!session || item.session_id === session) && (!page || item.first_page === page));
  table('pages', pages.map(item => [[item.page_path, new URL(item.page_url).origin], count(item.views), count(item.sessions), duration(item.average_active_ms)]));
  table('interactions', interactions.map(item => [[item.selector, `${item.page_path} · ${item.tag}${item.label ? ' · ' + item.label : ''}`], item.event_type.replaceAll('_', ' '), count(item.count)]));
  table('attention', attention.map(item => [[item.selector, item.page_path], duration(item.duration_ms), duration(item.average_duration_ms), count(item.sessions)]));
  renderSessions(sessions);
}
function renderSessions(sessions) {
  const body = $('recent'); body.replaceChildren();
  if (!sessions.length) return table('recent', [['No matching sessions.']]);
  for (const session of sessions) {
    const row = document.createElement('tr'); row.tabIndex = 0; row.className = 'session-row';
    [session.session_id, new Date(session.first_seen).toLocaleString(), session.first_page || 'No page view received', count(session.pages_visited), duration(session.active_duration_ms), count(session.interactions)].forEach(value => {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    });
    const open = () => loadTimeline(session.session_id); row.addEventListener('click', open);
    row.addEventListener('keydown', key => { if (key.key === 'Enter' || key.key === ' ') { key.preventDefault(); open(); } });
    body.append(row);
  }
}
function eventDetail(event) {
  if (event.event_type === 'click') return `${event.element?.selector || event.element?.tag || 'element'} · (${event.x}, ${event.y})`;
  if (event.event_type === 'scroll_depth') return `${event.scroll_percentage}% depth`;
  if (event.event_type === 'page_active' || event.event_type === 'element_attention') return `${event.element?.selector || ''} ${duration(event.duration_ms)}`.trim();
  if (event.event_type === 'focus') return `${event.element?.selector || event.element?.tag || 'element'} · ${event.focused ? 'focused' : 'blurred'}`;
  if (event.event_type === 'form_interaction' || event.event_type === 'form_submit') return event.element?.selector || event.element?.tag || 'form';
  if (event.event_type === 'mouse_move') return `sampled at (${event.x}, ${event.y})`;
  return event.event_type === 'page_view' ? 'Navigation / page view' : '';
}
async function loadTimeline(sessionId) {
  $('timeline-panel').hidden = false; $('timeline-title').textContent = `Loading ${sessionId}…`; $('timeline').replaceChildren();
  try {
    const result = await json(`${api()}/events?session=${encodeURIComponent(sessionId)}&limit=500`);
    $('timeline-title').textContent = `${sessionId} · ${count(result.total)} events${result.total > result.events.length ? ' · first 500 shown' : ''}`;
    table('timeline', result.events.map(event => [new Date(event.timestamp).toLocaleTimeString(), event.event_type.replaceAll('_', ' '), event.page_path, eventDetail(event)]));
    $('timeline-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { $('timeline-title').textContent = error.message; }
}
async function load() {
  const id = ++generation; ++heatGeneration;
  $('refresh').disabled = true; $('error').hidden = true; $('content').hidden = true; $('empty').hidden = true;
  $('status').textContent = 'Loading stored events…';
  try {
    if (!$('project').options.length) {
      const projects = await json('/api/projects');
      if (id !== generation) return;
      projects.projects.forEach(p => option($('project'), p, p));
    }
    const data = await json(api() + '/dashboard');
    if (id !== generation) return;
    render(data); $('content').hidden = false;
    $('status').textContent = `Updated ${new Date().toLocaleTimeString()} · ${count(data.measured_page_views)} page views measured for scroll`;
    await loadHeat();
  } catch (error) {
    if (id !== generation) return;
    $('error').textContent = error.message; $('error').hidden = false; $('status').textContent = 'Unable to load analytics';
  } finally { if (id === generation) $('refresh').disabled = false; }
}
async function loadHeat() {
  const id = ++heatGeneration; heatPoints = []; $('heat-viewport').replaceChildren(); drawHeat();
  const page = $('heat-page').value;
  if (!page) { $('heat-status').textContent = 'No pages available yet.'; return; }
  $('heat-status').textContent = 'Loading click coordinates…';
  try {
    const points = []; let offset = 0; let more;
    do {
      const result = await json(`${api()}/heatmap?page=${encodeURIComponent(new URL(page).pathname)}&limit=2000&offset=${offset}`);
      if (id !== heatGeneration) return;
      points.push(...result.points.filter(p => p.page_url === page)); more = result.has_more; offset += 2000;
    } while (more && offset < 20000);
    heatPoints = points;
    const sizes = [...new Set(points.map(p => `${p.viewport_width}×${p.viewport_height}`))];
    sizes.forEach(size => option($('heat-viewport'), size, size));
    $('heat-status').textContent = more ? 'Showing the first 20,000 coordinate bins. Narrower analysis is needed for larger datasets.' : points.length ? 'Recorded clicks · grouped by original viewport size' : 'No clicks recorded for this page yet.';
    drawHeat();
  } catch (error) { if (id === heatGeneration) $('heat-status').textContent = error.message; }
}
function drawHeat() {
  const canvas = $('heatmap'); const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const points = heatPoints.filter(p => `${p.viewport_width}×${p.viewport_height}` === $('heat-viewport').value);
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0,0,900,560);
  const clicks = points.reduce((sum, p) => sum + p.count, 0);
  $('heat-count').textContent = `${count(clicks)} clicks in this viewport`;
  canvas.setAttribute('aria-label', points.length ? `Click density: ${clicks} clicks across ${points.length} bins, viewport ${$('heat-viewport').value}` : 'No click coordinates available');
  if (!points.length) { ctx.fillStyle = '#697b92'; ctx.font = '16px system-ui'; ctx.textAlign = 'center'; ctx.fillText('No click coordinates available', 450, 280); return; }
  const width = Math.max(1, points[0].viewport_width, ...points.map(p => p.x + 20));
  const height = Math.max(1, points[0].viewport_height, ...points.map(p => p.y + 20));
  const scale = Math.min(800 / width, 460 / height); const w = width * scale; const h = height * scale;
  const left = (900 - w) / 2; const top = 45;
  ctx.fillStyle = 'white'; ctx.fillRect(left, top, w, h); ctx.strokeStyle = '#c8d5e7'; ctx.strokeRect(left, top, w, h);
  ctx.save(); ctx.beginPath(); ctx.rect(left,top,w,h); ctx.clip();
  ctx.strokeStyle = '#e7edf5'; ctx.setLineDash([4,5]);
  const step = Math.max(points[0].viewport_height, height / 100);
  for (let y = step; y < height && y > 0; y += step) { ctx.beginPath(); ctx.moveTo(left, top + y * scale); ctx.lineTo(left+w, top+y*scale); ctx.stroke(); }
  const max = Math.max(...points.map(p => p.count));
  for (const p of points) {
    const x = left + (p.x + 10) * scale; const y = top + (p.y + 10) * scale; const density = p.count / max;
    const radius = 12 + 18 * Math.sqrt(density); const gradient = ctx.createRadialGradient(x,y,0,x,y,radius);
    gradient.addColorStop(0, `rgba(238,83,56,${0.4 + density * .5})`); gradient.addColorStop(.35, 'rgba(249,183,66,.55)'); gradient.addColorStop(.7, 'rgba(35,171,209,.3)'); gradient.addColorStop(1,'rgba(65,136,231,0)');
    ctx.fillStyle = gradient; ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
  }
  ctx.restore(); ctx.fillStyle = '#627184'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`${Math.round(width)} × ${Math.round(height)} px observed area`,450,535);
}
$('refresh').addEventListener('click', load); $('project').addEventListener('change', load);
$('heat-page').addEventListener('change', loadHeat); $('heat-viewport').addEventListener('change', drawHeat);
$('filter-page').addEventListener('change', renderFiltered); $('filter-event').addEventListener('change', renderFiltered); $('filter-session').addEventListener('change', renderFiltered);
$('clear-filters').addEventListener('click', () => { $('filter-page').value = ''; $('filter-event').value = ''; $('filter-session').value = ''; renderFiltered(); });
$('close-timeline').addEventListener('click', () => { $('timeline-panel').hidden = true; });
void load();
