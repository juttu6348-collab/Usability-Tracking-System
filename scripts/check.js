const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
for (const dir of ['sdk', 'backend', 'dashboard', 'extension', 'scripts', 'tests']) {
  for (const entry of readdirSync(dir)) if (entry.endsWith('.js')) execFileSync(process.execPath, ['--check', join(dir, entry)], { stdio: 'inherit' });
}
console.log('JavaScript syntax checks passed');
