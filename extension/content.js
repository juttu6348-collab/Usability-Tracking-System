'use strict';
(() => {
  if (globalThis.__usabilityExtensionController) return;
  globalThis.__usabilityExtensionController = true;
  let activeKey = '';
  async function reconcile() {
    const config = await chrome.storage.sync.get({ enabled: true, projectId: 'demo-project', endpoint: 'http://localhost:3001/api/events', allowedOrigins: [] });
    const allowed = config.enabled && config.allowedOrigins.includes(location.origin);
    const nextKey = allowed ? `${config.projectId}|${config.endpoint}` : '';
    if (nextKey === activeKey) return;
    if (activeKey && globalThis.UsabilityTracker) globalThis.UsabilityTracker.destroy();
    activeKey = '';
    if (!allowed || !globalThis.UsabilityTracker) return;
    try {
      globalThis.UsabilityTracker.init({ projectId: config.projectId, endpoint: config.endpoint });
      activeKey = nextKey;
    } catch { console.warn('Usability Tracker extension: invalid configuration.'); }
  }
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync') void reconcile(); });
  void reconcile();
})();
