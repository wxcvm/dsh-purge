import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { auditUpdate } from './update-health.mjs';

const codex = '@deepseek-ai/dsh-subagent-codex';
const host = '@deepseek-ai/dsh-subagent';
const peerRange = '@deepseek-ai/cordis';
const pnpmEntry = 'primary-runtime/dependencies/pnpm/bin/pnpm.mjs';

function writeArchive(path, build, {
  cordis = '4.1.0', hostVersion = build, nodeRange = '>=24.9.0',
} = {}) {
  const entries = {
    'package.json': { name: '@deepseek-ai/dsh-desktop', version: build },
    'dsh/node_modules/@deepseek-ai/dsh/package.json': {
      name: '@deepseek-ai/dsh', version: hostVersion, engines: { node: nodeRange },
    },
    ['dsh/node_modules/' + host + '/package.json']: { name: host, version: build },
    ['dsh/node_modules/' + peerRange + '/package.json']: { name: peerRange, version: cordis },
  };
  let offset = 0;
  const files = Object.create(null), payload = [];
  for (const [name, data] of Object.entries(entries)) {
    const parts = name.split('/');
    let tree = files;
    for (const dir of parts.slice(0, -1)) {
      tree = (tree[dir] ??= { files: Object.create(null) }).files;
    }
    const bytes = Buffer.from(JSON.stringify(data));
    tree[parts.at(-1)] = { offset: String(offset), size: bytes.length };
    offset += bytes.length;
    payload.push(bytes);
  }
  const header = Buffer.from(JSON.stringify({ files }));
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(header.length + 8, 4);
  prefix.writeUInt32LE(header.length, 12);
  writeFileSync(path, Buffer.concat([prefix, header, ...payload]));
}

function writeRuntime(file, runtime, node) {
  file(join(runtime, 'versions.json'), { schemaVersion: 1, node, pnpm: '11.28.5' });
  for (const entry of ['bin/node.cmd', 'cli/bin/dsh.cmd', 'primary-runtime/dependencies/node/bin/node.exe',
    pnpmEntry, 'primary-runtime/dependencies/pnpm/dist/pnpm.mjs']) {
    file(join(runtime, entry), 'fixture, never executed');
  }
}

function fixture(t, { installed = '0.2.2-rc.5', plugin = '0.2.2-rc.3' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-update-preflight-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const installRoot = join(root, 'desktop'), profileRoot = join(root, 'profile');
  const resources = join(installRoot, 'resources'), runtime = join(resources, 'runtime');
  const pluginManifest = join(profileRoot, 'node_modules', codex, 'package.json');
  const file = (path, data) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data));
  };
  file(join(profileRoot, 'package.json'), { dependencies: { [codex]: plugin } });
  file(pluginManifest, { name: codex, version: plugin, peerDependencies: { [host]: plugin, [peerRange]: '~4.1.0' } });
  writeRuntime(file, runtime, '24.21.0');
  writeArchive(join(resources, 'app.asar'), installed);
  return { root, runtime, resources, pluginManifest, file, options: { installRoot, profileRoot } };
}

test('missing or empty package manager entry blocks upgrade acceptance', (t) => {
  const f = fixture(t);
  const entry = join(f.runtime, pnpmEntry);
  rmSync(entry);
  let r = auditUpdate({ ...f.options, expectedVersion: '0.2.2-rc.5' });
  assert.deepEqual(r.blockers, ['runtime-incomplete']);
  assert.deepEqual(r.runtime.missing, [pnpmEntry]);
  writeFileSync(entry, '');
  r = auditUpdate(f.options);
  assert.equal(r.runtime.ready, false);
  assert.deepEqual(r.runtime.missing, [pnpmEntry]);
});

test('archive-only comparison verifies supported peer ranges without claiming target runtime readiness', (t) => {
  const f = fixture(t, { installed: '0.2.2-rc.3' });
  const candidate = join(f.root, 'target.asar');
  writeArchive(candidate, '0.2.2-rc.5');
  assert.equal(auditUpdate(f.options).plugins[0].status, 'ranges-match');
  const r = auditUpdate({ ...f.options, targetArchive: candidate });
  assert.equal(r.installedVersion, '0.2.2-rc.3');
  assert.equal(r.comparisonVersion, '0.2.2-rc.5');
  assert.deepEqual(r.pluginWarnings[0].mismatches, [{ package: host, expected: '0.2.2-rc.3', actual: '0.2.2-rc.5' }]);
  assert.deepEqual(r.plugins[0].unchecked, []);
  assert.deepEqual(r.plugins[0].ranges, [{ package: peerRange, expected: '~4.1.0', actual: '4.1.0' }]);
  assert.deepEqual(r.blockers, ['target-runtime-unverified']);
  assert.equal(r.targetRuntime, null);
});

test('current version differs from expected even with complete runtime', (t) => {
  const f = fixture(t, { plugin: '0.2.2-rc.5' });
  const r = auditUpdate({ ...f.options, expectedVersion: '0.2.2-rc.6' });
  assert.deepEqual(r.blockers, ['installed-version-mismatch']);
  assert.deepEqual(r.pluginWarnings, []);
});

test('legacy backup and its runtime link are detected without traversing the link', (t) => {
  const f = fixture(t);
  const backup = join(f.resources, 'app.dshpurge-prev-2026-11-18T15-11-31');
  mkdirSync(backup);
  symlinkSync(f.runtime, join(backup, 'runtime'), process.platform === 'win32' ? 'junction' : 'dir');
  const original = readFileSync(join(f.runtime, pnpmEntry), 'utf8');
  const r = auditUpdate(f.options);
  assert.deepEqual(r.legacyTrees, [{ name: 'app.dshpurge-prev-2026-11-18T15-11-31', directoryLink: false, runtimeLink: true }]);
  assert.deepEqual(r.blockers, ['nonstandard-install-layout']);
  assert.equal(readFileSync(join(f.runtime, pnpmEntry), 'utf8'), original);
});

test('missing plugin files and explicitly undeclared host are reported separately', (t) => {
  const f = fixture(t, { plugin: '0.2.2-rc.5' });
  writeFileSync(f.pluginManifest, JSON.stringify({ name: codex, version: '0.2.2-rc.5', dshTargets: ['0.2.2-rc.3'] }));
  assert.equal(auditUpdate(f.options).pluginWarnings[0].status, 'target-not-declared');
  rmSync(f.pluginManifest);
  assert.equal(auditUpdate(f.options).pluginWarnings[0].status, 'missing');
});


test('alpha target checks its own runtime, exact target identity and published prerelease peers', (t) => {
  const alpha = '0.2.3-alpha.2';
  const f = fixture(t, { plugin: '0.2.2-rc.5' });
  const targetInstallRoot = join(f.root, 'candidate');
  const resources = join(targetInstallRoot, 'resources');
  const runtime = join(resources, 'runtime');
  const args = { ...f.options, targetInstallRoot, expectedVersion: '0.2.2-rc.5', expectedTargetVersion: alpha };
  writeRuntime(f.file, runtime, '24.21.0');
  writeArchive(join(resources, 'app.asar'), alpha, { cordis: '4.2.0-alpha.1', nodeRange: '^24.22.3 || >=26.13.1' });
  const manifest = { name: codex, version: '0.2.2-rc.5', dshTargets: [alpha], peerDependencies: { [peerRange]: '^4.0.1' } };
  f.file(f.pluginManifest, manifest);
  let result = auditUpdate(args);
  assert.deepEqual(result.blockers, ['target-runtime-incompatible']);
  assert.equal(result.targetRuntime.nodeStatus, 'incompatible');
  assert.equal(result.pluginWarnings[0].status, 'peer-mismatch');
  writeRuntime(f.file, runtime, '24.22.3');
  f.file(f.pluginManifest, { ...manifest, peerDependencies: { [peerRange]: '^4.0.1 || =4.2.0-alpha.1' } });
  result = auditUpdate(args);
  assert.equal(result.installedVersion, '0.2.2-rc.5');
  assert.equal(result.comparisonVersion, alpha);
  assert.equal(result.runtime.versions.node, '24.21.0');
  assert.equal(result.targetRuntime.versions.node, '24.22.3');
  assert.equal(result.targetRuntime.nodeStatus, 'compatible');
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.pluginWarnings, []);
  assert.deepEqual(auditUpdate({ ...args, expectedTargetVersion: '0.2.3-alpha.1' }).blockers,
    ['target-version-mismatch']);
  rmSync(join(runtime, pnpmEntry));
  assert.deepEqual(auditUpdate(args).blockers, ['target-runtime-incomplete']);
});

test('preview rejects mismatched embedded host versions and leaves an unreadable required peer unknown', (t) => {
  const alpha = '0.2.3-alpha.2';
  const f = fixture(t, { plugin: '0.2.2-rc.5' });
  const targetInstallRoot = join(f.root, 'candidate');
  const resources = join(targetInstallRoot, 'resources');
  writeRuntime(f.file, join(resources, 'runtime'), '24.22.3');
  writeArchive(join(resources, 'app.asar'), alpha, { hostVersion: '0.2.2-rc.5' });
  const unknownPeer = '@deepseek-ai/dsh-unavailable-in-archive';
  f.file(f.pluginManifest, { name: codex, version: '0.2.2-rc.5', peerDependencies: { [unknownPeer]: '^1.0.0' } });
  const r = auditUpdate({ ...f.options, targetInstallRoot });
  assert.deepEqual(r.blockers, ['target-host-version-mismatch']);
  assert.equal(r.pluginWarnings[0].status, 'unverified');
  assert.deepEqual(r.pluginWarnings[0].unchecked, [unknownPeer]);
});
