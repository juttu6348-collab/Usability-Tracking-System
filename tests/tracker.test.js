const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const source = readFileSync(require('node:path').join(__dirname, '../sdk/tracker.js'), 'utf8');
function setup() {
  const events = () => {
    const listeners = new Map();
    return {
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      dispatch(type, props = {}) { for (const fn of listeners.get(type) || []) fn(props); }
    };
  };
  let time = 0;
  let tick;
  let intersection;
  let fail = false;
  const requests = [];
  const beacons = [];
  const document = { ...events(), visibilityState: 'visible', hasFocus: () => true,
    referrer: 'https://ref.example/private?token=secret', title: 'PRIVATE TITLE',
    documentElement: { scrollHeight: 2000, getAttribute: () => 'Safe-title' }, body: { scrollHeight: 2000 }, querySelectorAll: () => [] };
  const window = { ...events(), location: new URL('https://example.com/home?token=SECRET#private'),
    innerWidth: 1200, innerHeight: 500, scrollY: 0, crypto: { randomUUID }, performance: { now: () => time },
    navigator: { userAgent: 'Chrome/123', maxTouchPoints: 0, sendBeacon: (url, body) => { beacons.push(body); return true; } },
    fetch: async (url, options) => { requests.push(JSON.parse(options.body)); return { ok: !fail }; },
    setInterval: fn => { tick = fn; return 1; }, clearInterval() {},
    setTimeout: fn => { fn(); return 1; }, clearTimeout() {},
    IntersectionObserver: class { constructor(fn) { intersection = fn; } observe() {} unobserve() {} disconnect() {} },
    history: { pushState(state, title, url) { window.location = new URL(url, window.location); }, replaceState(state, title, url) { window.location = new URL(url, window.location); } }
  };
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage accessed'); } });
  vm.runInNewContext(source, { window, document, URL, Blob });
  const api = window.UsabilityTracker.init({ projectId: 'test', endpoint: 'https://collector.example/events' });
  return { window, document, api, requests, beacons, advance: ms => { time += ms; }, tick: () => tick(), intersection: entries => intersection(entries), fail: value => { fail = value; } };
}
function element(tag = 'INPUT', attrs = {}) {
  return { tagName: tag, id: 'PRIVATE-ID', value: 'SECRET-VALUE', textContent: 'SECRET-TEXT', isConnected: true,
    getAttribute: name => attrs[name], hasAttribute: name => name in attrs,
    closest: selector => selector === 'form' ? {} : null,
    getBoundingClientRect: () => ({ left: 10, top: 20 }) };
}
test('privacy: excludes values, text, unapproved IDs, title and URL secrets', async () => {
  const h = setup();
  const target = element();
  h.document.dispatch('change', { target });
  h.document.dispatch('click', { target, pageX: 20, pageY: 30, clientX: 20, clientY: 30 });
  await h.api.flush();
  const serialized = JSON.stringify(h.requests);
  assert.doesNotMatch(serialized, /SECRET|PRIVATE|token|private/);
  assert.equal(h.requests[0].events[0].referrer, 'https://ref.example');
  assert.equal(h.requests[0].events[1].type, 'form_interaction');
  assert.equal(h.requests[0].events[2].relative_x, 10);
});
test('failed batches retry with stable event IDs', async () => {
  const h = setup(); h.fail(true); await h.api.flush();
  h.fail(false); await h.api.flush();
  assert.equal(h.requests[0].events[0].event_id, h.requests[1].events[0].event_id);
});
test('mouse samples, scroll milestones, SPA page views, and teardown', async () => {
  const h = setup(); const target = element('DIV');
  for (let i = 0; i < 20; i++) h.document.dispatch('mousemove', { target, pageX: i, pageY: i });
  h.advance(300); h.document.dispatch('mousemove', { target, pageX: 10, pageY: 10 });
  h.window.scrollY = 1500; h.window.dispatch('scroll');
  h.window.history.pushState({}, '', '/next?secret=yes');
  h.window.dispatch('popstate');
  await h.api.flush();
  const all = h.requests.flatMap(batch => batch.events);
  assert.equal(all.filter(e => e.type === 'mouse_move').length, 2);
  assert.deepEqual(all.filter(e => e.type === 'scroll_depth').map(e => e.depth), [25, 50, 75, 100]);
  assert.equal(all.filter(e => e.type === 'page_view').length, 2);
  assert.equal(all.at(-1).page.path, '/next');
  h.window.UsabilityTracker.destroy();
  h.document.dispatch('click', { target }); await h.api.flush();
  assert.equal(h.requests.length, 1);
});
test('hidden page uses beacon and excludes background time', async () => {
  const h = setup(); h.advance(1000); h.document.visibilityState = 'hidden';
  h.document.dispatch('visibilitychange');
  const batch = JSON.parse(await h.beacons[0].text());
  assert.equal(batch.events.find(e => e.type === 'page_active').duration_ms, 1000);
  h.advance(10000); h.tick(); await h.api.flush(); assert.equal(h.requests.length, 0);
});
test('attention measures only visible active intervals', async () => {
  const h = setup(); const target = element('SECTION', { 'data-track': 'section' });
  h.intersection([{ target, isIntersecting: true, intersectionRatio: 0.7 }]);
  h.advance(800);
  h.intersection([{ target, isIntersecting: false, intersectionRatio: 0 }]);
  await h.api.flush();
  assert.equal(h.requests[0].events.find(e => e.type === 'element_attention').duration_ms, 800);
});

test('pagehide suspends duration until pageshow restore', async () => {
  const h = setup(); h.advance(500); h.window.dispatch('pagehide');
  h.advance(10000); h.tick(); await h.api.flush();
  assert.equal(h.requests.length, 0);
  h.window.dispatch('pageshow', { persisted: true }); h.advance(250); h.tick();
  await h.api.flush();
  assert.equal(h.requests.flatMap(b => b.events).find(e => e.type === 'page_active').duration_ms, 250);
});

test('fragment-only popstate does not create a default SPA page view', async () => {
  const h = setup();
  h.window.location = new URL('https://example.com/home?token=SECRET#anchor');
  h.window.dispatch('popstate');
  await h.api.flush();
  assert.equal(h.requests.flatMap(b => b.events).filter(e => e.type === 'page_view').length, 1);
  h.window.history.replaceState({}, '', '/replacement');
  await h.api.flush();
  assert.equal(h.requests.flatMap(b => b.events).filter(e => e.type === 'page_view').length, 2);
});
