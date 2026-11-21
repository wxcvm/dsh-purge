/**
 * P0 release smoke: create a real npm tarball, install it inside a fresh
 * disposable DSH_HOME, and load the installed plugin entrypoints.
 *
 * This does NOT boot Harness Desktop, mutate an existing DSH_HOME, execute
 * model/Provider requests, apply host patches, or authorize external scans.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const temp = mkdtempSync(path.join(tmpdir(), 'dsh-purge-pack-smoke-'));
const home = path.join(temp, 'fresh-DSH_HOME');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = {
  ...process.env,
  DSH_HOME: home,
  REDTEAM_HOME: path.join(home, 'redteam'),
  npm_config_update_notifier: 'false',
  npm_config_loglevel: 'error',
};

function command(bin, args, cwd = root, timeout = 300_000) {
  const result = spawnSync(bin, args, {
    cwd, env, encoding: 'utf8',
    shell: process.platform === 'win32' && bin === npm,
    windowsHide: true, timeout, maxBuffer: 6 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const details = String(result.stderr || result.stdout || result.error || result.signal || '').slice(-3200);
    throw new Error(`${bin} ${args[0]} failed (exit ${result.status}): ${details}`);
  }
  return String(result.stdout || '');
}

try {
  mkdirSync(home);
  const output = command(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', temp]);
  const pack = JSON.parse(output.trim());
  assert.equal(pack.length, 1, 'npm pack must produce one archive');
  const item = pack[0];
  assert.equal(item.filename, `dsh-purge-${manifest.version}.tgz`);
  const archive = path.join(temp, item.filename);
  assert.ok(existsSync(archive), 'npm pack must create the actual tarball');
  assert.ok(statSync(archive).size > 0, 'packed tarball must not be empty');
  const bytes = readFileSync(archive);
  const sha1 = createHash('sha1').update(bytes).digest('hex');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(item.shasum, sha1, 'archive bytes must match npm pack shasum');
  if (item.integrity) {
    assert.equal(item.integrity, 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
      'archive bytes must match npm integrity');
  }

  const installedBefore = path.join(home, 'node_modules', manifest.name);
  assert.equal(existsSync(installedBefore), false, 'DSH_HOME must start without an installed plugin');
  writeFileSync(path.join(home, 'package.json'), JSON.stringify({
    name: 'dsh-purge-disposable-install-smoke',
    version: '0.0.0', private: true, type: 'module',
  }, null, 2) + '\n');
  // redteam/tools is a host-scoped plugin: its defineTool comes from the
  // official DSH host, not from Purge's own npm dependencies. A bare plugin
  // folder correctly refuses to import that entrypoint without a host.
  // Supply a reviewed host API fixture in the disposable installation only.
  const hostToolsVersion = process.env.PURGE_PACK_SMOKE_TOOLS_VERSION || '0.2.2-rc.5';
  assert.match(hostToolsVersion, /^\d+\.\d+\.\d+-rc\.\d+$/,
    'the host API fixture version must be explicitly pinned');
  command(npm, [
    'install', '--prefix', home, archive, '@deepseek-ai/dsh-tools@' + hostToolsVersion,
    '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund',
    '--no-save', '--package-lock=false', '--omit=optional', '--prefer-offline',
  ], temp);
  const toolsManifest = JSON.parse(readFileSync(path.join(
    home, 'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json'), 'utf8'));
  assert.equal(toolsManifest.version, hostToolsVersion, 'installed host tool fixture must match the pin');

  const installed = realpathSync(installedBefore);
  assert.equal(installed, realpathSync(path.join(home, 'node_modules', manifest.name)),
    'installed entry must resolve inside the disposable DSH_HOME');
  const installedManifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(installedManifest.name, manifest.name);
  assert.equal(installedManifest.version, manifest.version, 'installed version must equal the packed version');
  assert.equal(installedManifest.dsh?.install?.tarball, manifest.dsh?.install?.tarball);
  for (const file of [
    'client.js', 'lib/index.js', 'lib/redteam/index.js', 'lib/redteam/store.js',
    'lib/redteam/ui.js', 'lib/redteam/tools.js', 'lib/redteam/agent-work-items.js',
    'bin/dsh-purge.js', 'cordis.patch.yml', 'skills/redteam/deepseek-web-intel.md',
    'maintenance/Harness-Recovery.ps1',
  ]) {
    assert.ok(statSync(path.join(installed, file)).isFile(), 'missing packed runtime file: ' + file);
  }
  assert.equal(existsSync(path.join(installed, 'lib', 'default-prompt-inject.md')), false,
    'sealed development prompt must not leak into the installed package');
  assert.equal(existsSync(path.join(installed, '.github')), false,
    'repository automation must not be in the package');

  const probe = [
    "import assert from 'node:assert/strict';",
    "import path from 'node:path';",
    "import { pathToFileURL } from 'node:url';",
    "const root = process.env.PURGE_PACK_SMOKE_INSTALLED;",
    "const modules = [",
    "  ['lib/index.js', 'dsh-purge'],",
    "  ['lib/redteam/index.js', 'dsh-purge-redteam'],",
    "  ['lib/redteam/store.js', 'redteam-store'],",
    "  ['lib/redteam/ui.js', 'dsh-purge-redteam-ui'],",
    "  ['lib/redteam/tools.js', 'dsh-purge-redteam-tools'],",
    "];",
    "for (const [file, name] of modules) {",
    "  const plugin = await import(pathToFileURL(path.join(root, file)).href);",
    "  assert.equal(plugin.name, name, file + ': packaged plugin name');",
    "  assert.equal(typeof plugin.apply, 'function', file + ': packaged apply entry');",
    "  assert.ok(Array.isArray(plugin.inject), file + ': packaged inject contract');",
    "}",
    "console.log('five packaged host entrypoints import successfully');",
  ].join('\n');
  const childEnv = { ...env, PURGE_PACK_SMOKE_INSTALLED: installed };
  const importResult = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    cwd: home, env: childEnv, encoding: 'utf8', windowsHide: true, timeout: 120_000,
  });
  assert.equal(importResult.status, 0, 'fresh installed plugin imports failed: '
    + String(importResult.stderr || importResult.stdout || importResult.error || '').slice(-3200));
  const syntax = spawnSync(process.execPath, ['--check', path.join(installed, 'client.js')], {
    cwd: home, env: childEnv, encoding: 'utf8', windowsHide: true, timeout: 120_000,
  });
  assert.equal(syntax.status, 0, 'installed client.js syntax failed: ' + String(syntax.stderr || syntax.error || ''));
  const help = spawnSync(process.execPath, [path.join(installed, 'bin/dsh-purge.js'), '--help'], {
    cwd: home, env: childEnv, encoding: 'utf8', windowsHide: true, timeout: 120_000,
  });
  assert.equal(help.status, 0, 'packaged CLI --help failed: ' + String(help.stderr || help.error || ''));
  assert.match(String(help.stdout), /dsh-purge --status/, 'packaged CLI must expose its help entry');
  console.log(`Fresh packed install passed: ${manifest.name}@${manifest.version}; sha256=${sha256}; `
    + 'new temporary DSH_HOME, pinned official host tools, five plugin imports, client syntax and CLI --help. '
    + 'No real Desktop, host startup, patch application or Provider delivery was tested.');
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
