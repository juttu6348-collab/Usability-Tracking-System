'use strict';
const $ = id => document.getElementById(id);
let tab; let origin; let config;
const pattern = value => { const url = new URL(value); return `${url.protocol}//${url.hostname}/*`; };
async function refresh() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  config = await chrome.runtime.sendMessage({ type: 'get-settings' });
  try { const url = new URL(tab.url); origin = ['http:', 'https:'].includes(url.protocol) ? url.origin : null; } catch { origin = null; }
  $('site').textContent = origin || 'Unsupported Chrome page';
  const enabled = Boolean(origin && config.enabled && config.allowedOrigins.includes(origin));
  $('indicator').classList.toggle('on', enabled); $('toggle').disabled = !origin;
  $('toggle').textContent = enabled ? 'Disable on this site' : 'Enable on this site';
  $('message').textContent = !config.enabled ? 'Tracking is globally paused in Settings.' : enabled ? 'Tracking is active for this origin.' : 'This origin is not being tracked.';
}
$('toggle').addEventListener('click', async () => {
  const enabled = config.allowedOrigins.includes(origin);
  if (!enabled) {
    const granted = await chrome.permissions.request({ origins: [pattern(origin)] });
    if (!granted) { $('message').textContent = 'Site permission was not granted.'; return; }
  }
  const allowedOrigins = enabled ? config.allowedOrigins.filter(item => item !== origin) : [...new Set([...config.allowedOrigins, origin])];
  await chrome.storage.sync.set({ allowedOrigins });
  await chrome.runtime.sendMessage({ type: 'sync-registrations' });
  if (!enabled) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['tracker.js', 'content.js'] });
  } else {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.UsabilityTracker?.destroy() });
  }
  await refresh();
});
$('dashboard').addEventListener('click', () => { try { const url = new URL(config.endpoint); chrome.tabs.create({ url: url.origin + '/dashboard' }); } catch { void 0; } });
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
void refresh();
