const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('extension uses Manifest V3 with narrowly scoped permissions', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'),
  );

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage', 'scripting', 'activeTab']);
  assert.deepEqual(manifest.host_permissions, [
    'http://localhost/*',
    'http://127.0.0.1/*',
  ]);
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.action.default_popup, 'popup.html');
});

test('extension packages the same tracker build served by the backend', () => {
  const distribution = fs.readFileSync(path.join(root, 'dist', 'tracker.js'));
  const packaged = fs.readFileSync(path.join(root, 'extension', 'tracker.js'));

  assert.deepEqual(packaged, distribution);
});

test('extension source does not request access to private browser data', () => {
  const manifest = fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8');
  const forbiddenPermissions = [
    'cookies',
    'history',
    'webRequest',
    'webRequestBlocking',
    'clipboardRead',
  ];

  for (const permission of forbiddenPermissions) {
    assert.equal(manifest.includes(`\"${permission}\"`), false, permission);
  }
});
