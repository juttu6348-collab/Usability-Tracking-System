const { mkdirSync, copyFileSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
mkdirSync(resolve(root, 'dist'), { recursive: true });
copyFileSync(resolve(root, 'sdk/tracker.js'), resolve(root, 'dist/tracker.js'));
mkdirSync(resolve(root, 'extension'), { recursive: true });
copyFileSync(resolve(root, 'dist/tracker.js'), resolve(root, 'extension/tracker.js'));
console.log('Built dist/tracker.js and extension/tracker.js');
