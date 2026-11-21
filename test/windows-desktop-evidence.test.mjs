import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectReadOnlyDesktopEvidence } from '../scripts/inspect-windows-desktop-evidence.mjs';

const sampleFiles = [
  'lib/index.js', 'lib/prompt-profiles.js', 'lib/response-context.js',
  'lib/prompt-assembly-router.js', 'client.js',
];
function workspace(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-desktop-evidence-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'private-home'), root = path.join(base, 'checkout');
  fs.mkdirSync(home); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'dsh-purge', version: '1.1.92-wxcvm.18' }));
  const exe = path.join(base, 'DeepSeek Harness.exe');
  const resources = path.join(base, 'resources');
  fs.mkdirSync(path.join(resources, 'app'), { recursive: true });
  fs.writeFileSync(exe, 'fixture executable, must never be started');
  fs.writeFileSync(path.join(resources, 'app', 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version: '0.2.2-rc.5' }));
  return { base, home, root, exe, resources };
}
function plugin(f) {
  const profile = path.join(f.home, 'profiles', 'desktop');
  const installed = path.join(profile, 'node_modules', 'dsh-purge');
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(profile, 'package.json'),
    JSON.stringify({ dsh: { profile: { bundles: ['dsh-purge'] } } }));
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'),
    'sensitive local prompt and private username must not appear in evidence');
  fs.writeFileSync(path.join(installed, 'package.json'),
    JSON.stringify({ name: 'dsh-purge', version: '1.1.92-wxcvm.18' }));
  for (const rel of sampleFiles) {
    fs.mkdirSync(path.dirname(path.join(installed, rel)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(f.root, rel)), { recursive: true });
    fs.writeFileSync(path.join(installed, rel), 'release-payload-' + rel);
    fs.writeFileSync(path.join(f.root, rel), 'release-payload-' + rel);
  }
  return { profile, installed };
}

test('missing host/profile is an honest, read-only, nonfatal unknown', t => {
  const f = workspace(t);
  const result = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: '' });
  assert.equal(result.desktop.executableFound, false);
  assert.equal(result.process.observed, null);
  assert.equal(result.runtimeLoadVerified, false);
  assert.deepEqual(result.profiles.map(p => p.installation), ['absent', 'absent', 'absent']);
  assert.equal(result.candidate.version, '1.1.92-wxcvm.18');
  assert.equal(fs.readdirSync(f.home).length, 0, 'inspection must not create files in DSH_HOME');
});

test('checks actual installed bytes and runtime files, without exposing private paths or contents', t => {
  const f = workspace(t);
  const p = plugin(f);
  const before = fs.readFileSync(path.join(p.profile, 'cordis.patch.yml'));
  const matched = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: f.exe });
  assert.equal(matched.desktop.manifestValid, true);
  assert.equal(matched.desktop.version, '0.2.2-rc.5');
  assert.equal(matched.desktop.layout, 'unpacked');
  assert.equal(matched.desktop.runtimeFilesComplete, false);
  assert.equal(matched.profiles[0].installation, 'present');
  assert.equal(matched.profiles[0].sourceBytesEqual, true);
  assert.equal(matched.profiles[0].profileBundleRegistered, true);
  assert.equal(matched.profiles[0].cordisInsertPresent, true);
  assert.equal(matched.runtimeLoadVerified, false);
  fs.writeFileSync(path.join(p.installed, 'lib', 'index.js'), 'different installed version');
  const changed = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: f.exe });
  assert.equal(changed.profiles[0].sourceBytesEqual, false);
  assert.equal(changed.profiles[0].sourceFileComparison['lib/index.js'], 'different');
  assert.equal(changed.profiles[0].sourceFileComparison['client.js'], 'identical');
  assert.equal(changed.desktop.runtimeFilesComplete, false);
  const emitted = JSON.stringify(changed);
  assert.ok(!emitted.includes(f.home), 'do not expose DSH_HOME');
  assert.ok(!emitted.includes(f.base), 'do not expose absolute install or checkout paths');
  assert.ok(!emitted.includes('sensitive local prompt'));
  assert.deepEqual(fs.readFileSync(path.join(p.profile, 'cordis.patch.yml')), before,
    'inspection must not edit local Cordis config');
});

test('invalid desktop manifest is not misreported as a verified installation', t => {
  const f = workspace(t);
  fs.writeFileSync(path.join(f.resources, 'app', 'package.json'),
    JSON.stringify({ name: 'another-application', version: '1.0.0' }));
  const result = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: f.exe });
  assert.equal(result.desktop.executableFound, true);
  assert.equal(result.desktop.manifestValid, false);
  assert.equal(result.desktop.version, null);
  assert.equal(result.runtimeLoadVerified, false);
});

test('linked plugin tree is labelled uninspected instead of following an arbitrary target', t => {
  const f = workspace(t);
  const dir = path.join(f.home, 'profiles', 'desktop', 'node_modules');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(f.base, 'potentially-private');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'package.json'),
    JSON.stringify({ name: 'dsh-purge', version: '99.99.99' }));
  try { fs.symlinkSync(target, path.join(dir, 'dsh-purge'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { t.skip('host does not allow creating symbolic links: ' + error.code); return; }
  const result = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: '' });
  assert.equal(result.profiles[0].installation, 'linked-uninspected');
  assert.match(result.profiles[0].linkTargetScope, /-untrusted$/);
  assert.equal(result.profiles[0].version, null);
  assert.equal(result.profiles[0].sourceBytesEqual, null);
});

test('only pnpm links confined to the current profile store may be inspected', t => {
  const f = workspace(t);
  const store = path.join(f.home, 'profiles', 'desktop', 'node_modules', '.pnpm',
    'dsh-purge@1.1.92-wxcvm.18', 'node_modules', 'dsh-purge');
  fs.mkdirSync(store, { recursive: true });
  const destination = path.join(f.home, 'profiles', 'desktop', 'node_modules', 'dsh-purge');
  fs.writeFileSync(path.join(store, 'package.json'),
    JSON.stringify({ name: 'dsh-purge', version: '1.1.92-wxcvm.18' }));
  for (const rel of sampleFiles) {
    fs.mkdirSync(path.dirname(path.join(store, rel)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(f.root, rel)), { recursive: true });
    fs.writeFileSync(path.join(store, rel), 'same-source-' + rel);
    fs.writeFileSync(path.join(f.root, rel), 'same-source-' + rel);
  }
  try { fs.symlinkSync(store, destination, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { t.skip('host does not allow creating symbolic links: ' + error.code); return; }
  const result = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: '' });
  assert.equal(result.profiles[0].installation, 'present-pnpm-link');
  assert.equal(result.profiles[0].linkTargetScope, 'verified-profile-pnpm-store');
  assert.equal(result.profiles[0].sourceBytesEqual, true);
  assert.equal(result.runtimeLoadVerified, false);
});

test('untrusted same-profile link returns only a category and never reads its manifest', t => {
  const f = workspace(t);
  const dir = path.join(f.home, 'profiles', 'desktop');
  const links = path.join(dir, 'node_modules');
  const target = path.join(dir, 'private-package');
  fs.mkdirSync(links, { recursive: true });
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'package.json'), '{"name":"dsh-purge","version":"99.99.99"}');
  try { fs.symlinkSync(target, path.join(links, 'dsh-purge'),
      process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { t.skip('host does not allow links: ' + error.code); return; }
  const result = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: '' });
  assert.equal(result.profiles[0].installation, 'linked-uninspected');
  assert.equal(result.profiles[0].linkTargetScope, 'inside-same-profile-untrusted');
  assert.equal(result.profiles[0].version, null);
  assert.equal(result.profiles[0].sourceBytesEqual, null);
  assert.ok(!JSON.stringify(result).includes(target), 'never reveal junction destination');
});

test('broken link is not mistaken for an absent package or followed elsewhere', t => {
  const f = workspace(t);
  const dir = path.join(f.home, 'profiles', 'desktop', 'node_modules');
  fs.mkdirSync(dir, { recursive: true });
  const missing = path.join(f.base, 'does-not-exist');
  try { fs.symlinkSync(missing, path.join(dir, 'dsh-purge'),
      process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { t.skip('host does not allow links: ' + error.code); return; }
  const result = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: '' });
  assert.equal(result.profiles[0].installation, 'linked-uninspected');
  assert.equal(result.profiles[0].linkTargetScope, 'unresolved');
  assert.equal(result.profiles[0].version, null);
});

test('nested directory link escaping a verified pnpm store cannot disclose private files', t => {
  const f = workspace(t);
  const store = path.join(f.home, 'profiles', 'desktop', 'node_modules', '.pnpm',
    'dsh-purge@1.1.92-wxcvm.18', 'node_modules', 'dsh-purge');
  const link = path.join(f.home, 'profiles', 'desktop', 'node_modules', 'dsh-purge');
  const outside = path.join(f.base, 'private-source');
  fs.mkdirSync(store, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(store, 'package.json'),
    JSON.stringify({ name: 'dsh-purge', version: '1.1.92-wxcvm.18' }));
  fs.writeFileSync(path.join(outside, 'index.js'), 'DO_NOT_READ_PRIVATE_MARKER');
  try {
    fs.symlinkSync(outside, path.join(store, 'lib'), process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(store, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) { t.skip('host does not allow links: ' + error.code); return; }
  const result = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: '' });
  assert.equal(result.profiles[0].installation, 'present-pnpm-link');
  assert.equal(result.profiles[0].sourceFileComparison['lib/index.js'], 'missing');
  assert.ok(!JSON.stringify(result).includes('DO_NOT_READ_PRIVATE_MARKER'));
  assert.ok(!JSON.stringify(result).includes(outside));
});
