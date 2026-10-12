'use strict';
const TYPES = ['page_view', 'page_active', 'click', 'scroll_depth', 'focus', 'form_interaction', 'form_submit', 'mouse_move', 'element_attention'];
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const check = (condition, message = 'Invalid event') => { if (!condition) throw new HttpError(400, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const token = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
function numeric(value, min, max) { check(Number.isFinite(value) && value >= min && value <= max); return value; }
function safeUrl(value) {
  check(typeof value === 'string' && value.length <= 2048);
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, 'Invalid URL'); }
  check(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password);
  url.search = ''; url.hash = '';
  let decoded; try { decoded = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Invalid path encoding'); }
  check(!/[<>\x00-\x1f]/.test(decoded));
  return url.origin + url.pathname;
}
function normalize(e) {
  check(object(e));
  for (const key of ['event_id', 'project_id', 'session_id', 'visitor_id']) check(identifier(e[key]), `Invalid ${key}`);
  const type = e.event_type ?? e.type;
  check(TYPES.includes(type), 'Unknown event type');
  const page = object(e.page) ? e.page : {};
  const pageUrl = safeUrl(e.page_url ?? page.url);
  const pagePath = e.page_path ?? page.path;
  check(typeof pagePath === 'string' && pagePath.startsWith('/') && pagePath.length <= 1024);
  const cleanPath = pagePath.split(/[?#]/)[0];
  check(new URL(pageUrl).pathname === cleanPath, 'URL/path mismatch');
  check(typeof e.timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(e.timestamp) && Number.isFinite(Date.parse(e.timestamp)), 'Invalid timestamp');
  const result = { event_id: e.event_id, project_id: e.project_id, session_id: e.session_id,
    visitor_id: e.visitor_id, event_type: type, page_url: pageUrl, page_path: cleanPath,
    timestamp: new Date(e.timestamp).toISOString() };
  if (page.view_id !== undefined) { check(identifier(page.view_id)); result.page_view_id = page.view_id; }
  if (page.title) { check(token(page.title)); result.page_title = page.title; }
  check(object(e.viewport), 'Viewport required');
  result.viewport = { width: numeric(e.viewport.width, 0, 100000), height: numeric(e.viewport.height, 0, 100000) };
  if (e.device !== undefined) {
    check(object(e.device) && ['Edge', 'Firefox', 'Chrome', 'Safari', 'Other'].includes(e.device.browser));
    check(['mobile', 'desktop'].includes(e.device.category) && typeof e.device.touch === 'boolean');
    result.device = { browser: e.device.browser, category: e.device.category, touch: e.device.touch };
  }
  if (e.referrer) result.referrer = new URL(safeUrl(e.referrer)).origin;
  if (['click', 'focus', 'form_interaction', 'form_submit', 'element_attention'].includes(type)) {
    const el = e.element;
    check(object(el) && typeof el.tag === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(el.tag));
    result.element = { tag: el.tag };
    for (const key of ['id', 'track', 'label']) if (el[key] !== undefined) { check(token(el[key])); result.element[key] = el[key]; }
    result.element.selector = el.id ? '#' + el.id : el.track ? '[data-track="' + el.track + '"]' : el.tag;
  }
  if (['click', 'mouse_move'].includes(type)) { result.x = numeric(e.x, 0, 10000000); result.y = numeric(e.y, 0, 10000000); }
  if (type === 'click') { result.relative_x = numeric(e.relative_x, -100000, 100000); result.relative_y = numeric(e.relative_y, -100000, 100000); }
  if (type === 'scroll_depth') result.scroll_percentage = numeric(e.scroll_percentage ?? e.depth, 0, 100);
  if (['page_active', 'element_attention'].includes(type)) result.duration_ms = numeric(e.duration_ms, 0, 86400000);
  if (type === 'focus') { check(typeof e.focused === 'boolean'); result.focused = e.focused; }
  if (type === 'form_interaction') { check(e.action === 'change'); result.action = 'change'; }
  return result;
}
function validateBatch(body, maxBatch) {
  check(object(body) && body.schema_version === 1 && Array.isArray(body.events), 'Expected schema_version 1 and events array');
  check(body.events.length > 0 && body.events.length <= maxBatch, `Batch must contain 1-${maxBatch} events`);
  return body.events.map(normalize);
}
module.exports = { HttpError, check, identifier, TYPES, validateBatch };
