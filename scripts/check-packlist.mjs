/** Verify the npm tarball's published file contract without creating an archive. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(command, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  windowsHide: true,
  env: { ...process.env, npm_config_update_notifier: 'false' },
});
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error('npm pack --dry-run failed: ' + (result.stderr || result.stdout || result.status));
}
let packed;
try {
  packed = JSON.parse(String(result.stdout || '').trim());
} catch {
  throw new Error('npm pack did not return valid JSON: ' + String(result.stdout || '').slice(0, 1000));
}
assert.ok(Array.isArray(packed) && packed.length === 1, 'expected one npm pack result');
const item = packed[0];
assert.equal(item.filename, `dsh-purge-${manifest.version}.tgz`, 'tarball filename must match package.json');
assert.ok(Array.isArray(item.files), 'npm pack must report its file list');
const files = new Set(item.files.map(entry => entry.path));
const required = [
  'package.json',
  'client.js',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/redteam/client.js',
  'lib/redteam/store-core.js',
  'lib/redteam/tools.js',
  'lib/redteam/task-context.js',
  'lib/redteam/agent-work-items.js',
  'bin/dsh-purge.js',
  'scripts/secret-vault.mjs',
  'skills/redteam/deepseek-web-intel.md',
  'maintenance/Harness-Recovery.ps1',
  'docs/OPERATIONS_GUIDE.zh-CN.md',
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
  'NOTICE',
];
for (const file of required) assert.ok(files.has(file), `required package file missing: ${file}`);
for (const file of files) {
  assert.notEqual(file, 'lib/default-prompt-inject.md', 'sealed default prompt must not be packed');
  assert.ok(!/^maintenance\\/.+\\/dist\\//.test(file), `generated maintenance dist must not be packed: ${file}`);
  assert.ok(!/^(?:test|test-pending|\.github)\\//.test(file), `development-only path must not be packed: ${file}`);
}
assert.equal(item.entryCount, files.size, 'entryCount must match the reported file list');
console.log(`npm pack contract passed: ${item.filename}; ${files.size} files; required runtime, skills, maintenance and docs present; sealed prompt and development files excluded.`);
