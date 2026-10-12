'use strict';
const DEFAULTS = { enabled: true, projectId: 'demo-project', endpoint: 'http://localhost:3001/api/events', allowedOrigins: [] };
const PREFIX = 'usability-origin-';
const normalizeOrigin = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.origin : null; } catch { return null; }
};
const matchPattern = origin => {
  const url = new URL(origin);
  // Chrome match patterns do not distinguish ports. content.js still checks the exact origin.
  return `${url.protocol}//${url.hostname}/*`;
};
async function settings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored, allowedOrigins: [...new Set((stored.allowedOrigins || []).map(normalizeOrigin).filter(Boolean))] };
}
async function syncRegistrations() {
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const ours = existing.filter(script => script.id.startsWith(PREFIX)).map(script => script.id);
  if (ours.length) await chrome.scripting.unregisterContentScripts({ ids: ours });
  const config = await settings();
  if (!config.enabled || !config.allowedOrigins.length) return;
  const patterns = [...new Set(config.allowedOrigins.map(matchPattern))];
  await chrome.scripting.registerContentScripts(patterns.map((matches, index) => ({
    id: PREFIX + index,
    js: ['tracker.js', 'content.js'],
    matches: [matches],
    runAt: 'document_idle',
    persistAcrossSessions: true
  })));
}
chrome.runtime.onInstalled.addListener(() => { void chrome.storage.sync.get(DEFAULTS).then(current => chrome.storage.sync.set({ ...DEFAULTS, ...current })).then(syncRegistrations); });
chrome.runtime.onStartup.addListener(() => { void syncRegistrations(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && ['enabled', 'allowedOrigins'].some(key => changes[key])) void syncRegistrations(); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'sync-registrations') syncRegistrations().then(() => respond({ ok: true }), error => respond({ ok: false, error: error.message }));
  else if (message?.type === 'get-settings') settings().then(respond);
  else return false;
  return true;
});
