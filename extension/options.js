'use strict';
const DEFAULTS = { enabled: true, projectId: 'demo-project', endpoint: 'http://localhost:3001/api/events', allowedOrigins: [] };
const $ = id => document.getElementById(id);
let origins = [];
const normalizeOrigin = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.origin : null; } catch { return null; } };
const pattern = value => { const url = new URL(value); return `${url.protocol}//${url.hostname}/*`; };
function render() {
  $('origins').replaceChildren();
  if (!origins.length) { const item = document.createElement('li'); item.textContent = 'No websites enabled yet.'; $('origins').append(item); return; }
  origins.forEach(origin => { const item = document.createElement('li'); const text = document.createElement('span'); text.textContent = origin; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.addEventListener('click', () => { origins = origins.filter(value => value !== origin); render(); }); item.append(text, remove); $('origins').append(item); });
}
async function load() {
  const config = await chrome.storage.sync.get(DEFAULTS); $('enabled').checked = config.enabled; $('project').value = config.projectId; $('endpoint').value = config.endpoint; origins = config.allowedOrigins || []; render();
}
$('add').addEventListener('click', async () => {
  const origin = normalizeOrigin($('origin').value);
  if (!origin) { $('message').textContent = 'Enter a valid HTTP or HTTPS website URL.'; return; }
  const granted = await chrome.permissions.request({ origins: [pattern(origin)] });
  if (!granted) { $('message').textContent = 'Website permission was not granted.'; return; }
  origins = [...new Set([...origins, origin])]; $('origin').value = ''; $('message').textContent = ''; render();
});
$('save').addEventListener('click', async () => {
  const endpoint = $('endpoint').value.trim(); const projectId = $('project').value.trim();
  try { const url = new URL(endpoint); if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) throw new Error(); } catch { $('message').textContent = 'Enter a valid HTTP(S) event endpoint without query or fragment.'; return; }
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(projectId)) { $('message').textContent = 'Project ID must be a safe identifier.'; return; }
  await chrome.storage.sync.set({ enabled: $('enabled').checked, projectId, endpoint, allowedOrigins: origins });
  const result = await chrome.runtime.sendMessage({ type: 'sync-registrations' }); $('message').textContent = result.ok ? 'Settings saved.' : result.error;
});
$('clear').addEventListener('click', async () => {
  const permissions = await chrome.permissions.getAll(); const removable = (permissions.origins || []).filter(item => item.startsWith('http'));
  if (removable.length) await chrome.permissions.remove({ origins: removable });
  await chrome.storage.sync.clear(); await chrome.storage.sync.set(DEFAULTS); origins = []; await chrome.runtime.sendMessage({ type: 'sync-registrations' }); await load(); $('message').textContent = 'Settings cleared.';
});
void load();
