(function (window, document) {
  'use strict';
  if (window.UsabilityTracker) return;
  const embedScript = document.currentScript;
  let instance;
  const token = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) ? value : undefined;
  const round = value => Math.round(value || 0);

  function create(options) {
    if (!options || !token(options.projectId)) throw new Error('A safe projectId is required');
    const endpoint = new URL(options.endpoint || '/api/events', embedScript && embedScript.src || window.location.href);
    if (!/^https?:$/.test(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error('Endpoint must be an HTTP(S) URL without credentials, query, or fragment');
    }
    const number = (value, fallback, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
    const batchSize = number(options.batchSize, 20, 1, 50);
    const maxQueue = 200;
    const interval = number(options.flushIntervalMs, 5000, 1000, 60000);
    const mouseInterval = number(options.mouseSampleMs, 250, 100, 5000);
    const uuid = () => window.crypto.randomUUID();
    const visitorId = uuid();
    const sessionId = uuid();
    const queue = [];
    const removers = [];
    const observed = new Set();
    const attention = new Map();
    const milestones = new Set();
    let stopped = false;
    let sending = false;
    let activeSince = null;
    let activeMs = 0;
    let lastMouse = -Infinity;
    let scrollTimer;
    let page;
    let suspended = false;
    let lastUrl = window.location.href;
    const now = () => window.performance.now();
    const visible = () => !suspended && document.visibilityState !== 'hidden' && document.hasFocus();
    const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
    const safePath = () => {
      let path = window.location.pathname;
      if (typeof options.sanitizePath === 'function') {
        try { path = options.sanitizePath(path); } catch { path = '/redacted'; }
      }
      return typeof path === 'string' && path.startsWith('/') ? path.split(/[?#]/)[0].slice(0, 256) : '/redacted';
    };
    const safeReferrer = () => {
      try { return new URL(document.referrer).origin; } catch { return ''; }
    };
    const metadata = element => {
      if (!element || !element.tagName || element.closest('[data-track-ignore]')) return null;
      // IDs, labels and tracking names are explicit developer-owned annotations only.
      const tag = element.tagName.toLowerCase();
      const track = token(element.getAttribute('data-track'));
      const id = element.hasAttribute('data-track-id') ? token(element.id) : undefined;
      const label = element.getAttribute('data-track-label');
      return {
        tag,
        id,
        selector: id ? '#' + id : track ? '[data-track="' + track + '"]' : tag,
        track,
        label: /^(button|a)$/.test(tag) && token(label) ? label : undefined
      };
    };
    function emit(type, data = {}) {
      if (stopped) return;
      if (queue.length >= maxQueue) queue.shift();
      queue.push({ event_id: uuid(), type, project_id: options.projectId,
        visitor_id: visitorId, session_id: sessionId, timestamp: new Date().toISOString(),
        page: { ...page }, viewport: viewport(), ...data });
      if (queue.length >= batchSize && document.visibilityState !== 'hidden') void flush();
    }
    function body(events) { return JSON.stringify({ schema_version: 1, events }); }
    async function flush(beacon = false) {
      if (!queue.length) return;
      if (beacon) {
        // Keep each payload below common 64 KiB keepalive limits. Failed admission stays queued.
        while (queue.length) {
          const events = queue.slice(0, batchSize);
          let payload = new Blob([body(events)], { type: 'text/plain;charset=UTF-8' });
          while (payload.size > 48000 && events.length > 1) {
            events.pop();
            payload = new Blob([body(events)], { type: 'text/plain;charset=UTF-8' });
          }
          try {
            if (!window.navigator.sendBeacon || !window.navigator.sendBeacon(endpoint.href, payload)) break;
          } catch { break; }
          queue.splice(0, events.length);
        }
        return;
      }
      if (sending || stopped) return;
      sending = true;
      const events = queue.splice(0, batchSize);
      try {
        const response = await window.fetch(endpoint.href, {
          method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: body(events)
        });
        if (!response.ok) throw new Error('Collector rejected batch');
      } catch {
        if (!stopped) queue.unshift(...events);
        if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
      } finally { sending = false; }
    }
    function updateActive() {
      if (activeSince !== null) activeMs += Math.max(0, now() - activeSince);
      activeSince = visible() ? now() : null;
    }
    function endAttention(element) {
      const start = attention.get(element);
      if (start !== undefined) {
        attention.delete(element);
        const meta = metadata(element);
        if (meta) emit('element_attention', { element: meta, duration_ms: round(now() - start) });
      }
    }
    function checkpoint() {
      updateActive();
      if (activeMs > 0) emit('page_active', { duration_ms: round(activeMs) });
      activeMs = 0;
      for (const element of [...attention.keys()]) endAttention(element);
      if (visible()) for (const element of observed) attention.set(element, now());
    }
    function startPage() {
      const path = safePath();
      page = { view_id: uuid(), url: window.location.origin + path, path,
        title: document.documentElement.getAttribute('data-track-title') || '' };
      // Never read document.title: it commonly contains user names or document contents.
      page.title = token(page.title) || '';
      milestones.clear();
      activeSince = visible() ? now() : null;
      const ua = window.navigator.userAgent;
      const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
      emit('page_view', { referrer: safeReferrer(), device: { browser,
        category: /Mobi|Android/i.test(ua) ? 'mobile' : 'desktop',
        touch: window.navigator.maxTouchPoints > 0 } });
    }
    function on(target, type, handler, opts) {
      target.addEventListener(type, handler, opts);
      removers.push(() => target.removeEventListener(type, handler, opts));
    }
    function targetOf(event) { return event.target && event.target.closest ? event.target : null; }
    startPage();
    on(document, 'click', event => {
      const target = targetOf(event);
      if (!target || target.closest('[data-track-ignore]')) return;
      const element = target.closest('button,a,[data-track]') || target;
      const meta = metadata(element);
      if (!meta) return;
      const rect = element.getBoundingClientRect();
      emit('click', { element: meta, x: round(event.pageX), y: round(event.pageY),
        relative_x: round(event.clientX - rect.left), relative_y: round(event.clientY - rect.top) });
    }, { passive: true });
    for (const type of ['focusin', 'focusout', 'change', 'submit']) {
      on(document, type, event => {
        const target = targetOf(event);
        const meta = metadata(target);
        if (!meta) return;
        if (type === 'focusin' || type === 'focusout') emit('focus', { element: meta, focused: type === 'focusin' });
        else if (type === 'submit') emit('form_submit', { element: meta });
        // Change marks a completed edit without collecting keystroke timing or field values.
        else if (type === 'change' && target.closest('form')) emit('form_interaction', { element: meta, action: 'change' });
      }, true);
    }
    function scroll() {
      scrollTimer = undefined;
      const height = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      const extent = height - window.innerHeight;
      const depth = extent <= 0 ? 100 : Math.min(100, Math.max(0, window.scrollY / extent * 100));
      for (const threshold of [25, 50, 75, 100]) if (depth >= threshold && !milestones.has(threshold)) {
        milestones.add(threshold); emit('scroll_depth', { depth: threshold });
      }
    }
    on(window, 'scroll', () => { if (!scrollTimer) scrollTimer = window.setTimeout(scroll, 150); }, { passive: true });
    on(document, 'mousemove', event => {
      if (!visible() || now() - lastMouse < mouseInterval) return;
      const target = targetOf(event);
      if (target && target.closest('[data-track-ignore]')) return;
      lastMouse = now();
      emit('mouse_move', { x: round(event.pageX), y: round(event.pageY) });
    }, { passive: true });
    let observer;
    if (window.IntersectionObserver) {
      observer = new window.IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5 && metadata(entry.target)) {
            observed.add(entry.target);
            if (visible() && !attention.has(entry.target)) attention.set(entry.target, now());
          } else { observed.delete(entry.target); endAttention(entry.target); }
        }
      }, { threshold: [0, 0.5] });
    }
    const tracked = new Set();
    function refresh() {
      if (!observer || stopped) return;
      for (const element of tracked) if (!element.isConnected) {
        endAttention(element); observed.delete(element); tracked.delete(element); observer.unobserve(element);
      }
      for (const element of document.querySelectorAll('[data-track-attention], main, section, article')) {
        if (tracked.size >= 100) break;
        if (!tracked.has(element) && metadata(element)) { tracked.add(element); observer.observe(element); }
      }
    }
    refresh();
    function navigate() {
      if (window.location.href === lastUrl) return;
      const previous = new URL(lastUrl);
      const current = new URL(window.location.href);
      lastUrl = window.location.href;
      if (options.trackHashChanges !== true && previous.origin + previous.pathname + previous.search === current.origin + current.pathname + current.search) return;
      checkpoint(); startPage(); refresh();
    }
    for (const method of ['pushState', 'replaceState']) {
      const original = window.history[method];
      const wrapped = function (...args) {
        const before = window.location.href;
        const result = original.apply(this, args);
        if (window.location.href !== before) navigate();
        return result;
      };
      window.history[method] = wrapped;
      removers.push(() => { if (window.history[method] === wrapped) window.history[method] = original; });
    }
    on(window, 'popstate', navigate);
    on(window, 'hashchange', () => { if (options.trackHashChanges === true) navigate(); });
    on(document, 'visibilitychange', () => { checkpoint(); if (document.visibilityState === 'hidden') void flush(true); });
    on(window, 'blur', checkpoint);
    on(window, 'focus', checkpoint);
    on(window, 'pagehide', () => {
      suspended = true; checkpoint(); activeSince = null; attention.clear(); void flush(true);
    });
    on(window, 'pageshow', event => { if (event.persisted) { suspended = false; checkpoint(); refresh(); } });
    const timer = window.setInterval(() => { checkpoint(); void flush(); }, interval);
    return {
      flush: () => flush(), refresh,
      destroy() {
        if (stopped) return;
        checkpoint(); void flush(true); stopped = true;
        window.clearInterval(timer); window.clearTimeout(scrollTimer);
        removers.forEach(remove => remove());
        if (observer) observer.disconnect();
        queue.length = 0; attention.clear(); observed.clear(); tracked.clear();
      }
    };
  }
  window.UsabilityTracker = {
    init(options) { if (!instance) instance = create(options); return instance; },
    destroy() { if (instance) instance.destroy(); instance = undefined; }
  };
  if (embedScript && embedScript.getAttribute('data-project-id')) {
    const start = () => {
      try {
        window.UsabilityTracker.init({ projectId: embedScript.getAttribute('data-project-id'),
          endpoint: embedScript.getAttribute('data-endpoint') || undefined });
      } catch { window.console.warn('UsabilityTracker: initialization failed; check script configuration.'); }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(window, document);
