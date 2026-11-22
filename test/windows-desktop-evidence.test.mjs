import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectReadOnlyDesktopEvidence } from '../scripts/inspect-windows-desktop-evidence.mjs';

const sampleFiles = [
  'lib/index.js', 'lib/prompt-profiles.js', 'lib/response-context.js',
  'lib/prompt-assembly-router.js', 'client.js',
  'lib/redteam/ui.js', 'lib/redteam/bridge-auth.js', 'lib/redteam/bridge-origin.js',
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

test('matching version and client do not hide stale Desktop bridge code', t => {
  const f = workspace(t);
  const { installed } = plugin(f);
  fs.writeFileSync(path.join(installed, 'lib', 'redteam', 'bridge-origin.js'), 'stale origin check');
  const result = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: f.exe });
  const desktop = result.profiles[0];
  assert.equal(desktop.version, result.candidate.version);
  assert.equal(desktop.sourceBytesEqual, false);
  assert.equal(desktop.sourceFileComparison['client.js'], 'identical');
  assert.equal(desktop.sourceFileComparison['lib/redteam/bridge-origin.js'], 'different');
  assert.equal(desktop.sourceFileComparison['lib/redteam/bridge-auth.js'], 'identical');
  assert.equal(desktop.sourceFileComparison['lib/redteam/ui.js'], 'identical');
  assert.equal(result.runtimeLoadVerified, false);
  assert.ok(!JSON.stringify(result).includes('stale origin check'));
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

test('shared DSH profiles virtual-store link proves installed version and exact source bytes', t => {
  const f = workspace(t);
  const target = path.join(f.home, 'profiles', 'node_modules', '.pnpm',
    'dsh-purge@1.1.92-wxcvm.18', 'node_modules', 'dsh-purge');
  const destination = path.join(f.home, 'profiles', 'desktop', 'node_modules', 'dsh-purge');
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(path.join(target, 'package.json'),
    JSON.stringify({ name: 'dsh-purge', version: '1.1.92-wxcvm.18' }));
  for (const rel of sampleFiles) {
    fs.mkdirSync(path.dirname(path.join(f.root, rel)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(target, rel)), { recursive: true });
    fs.writeFileSync(path.join(f.root, rel), 'identical-' + rel);
    fs.writeFileSync(path.join(target, rel), 'identical-' + rel);
  }
  try { fs.symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { t.skip('host cannot create symlinks: ' + error.code); return; }
  const result = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: '' });
  assert.equal(result.profiles[0].installation, 'present-pnpm-link');
  assert.equal(result.profiles[0].linkTargetScope, 'verified-shared-profile-pnpm-store');
  assert.equal(result.profiles[0].version, '1.1.92-wxcvm.18');
  assert.equal(result.profiles[0].sourceBytesEqual, true);
  assert.equal(result.runtimeLoadVerified, false);
  assert.ok(!JSON.stringify(result).includes(f.home));
  // Version string equality alone cannot pass the file byte comparison.
  fs.writeFileSync(path.join(target, 'lib', 'prompt-profiles.js'), 'old-prompt-routing-code');
  const changed = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: '' });
  assert.equal(changed.profiles[0].sourceBytesEqual, false);
  assert.equal(changed.profiles[0].sourceFileComparison['lib/prompt-profiles.js'], 'different');
});

test('a shared .pnpm lookalike with unrelated package identity stays unread', t => {
  const f = workspace(t);
  const target = path.join(f.home, 'profiles', 'node_modules', '.pnpm',
    'not-purge@1.0.0', 'node_modules', 'dsh-purge');
  const destination = path.join(f.home, 'profiles', 'desktop', 'node_modules', 'dsh-purge');
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(path.join(target, 'package.json'),
    JSON.stringify({ name: 'dsh-purge', version: '99.99.99' }));
  try { fs.symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { t.skip('host cannot create symlinks: ' + error.code); return; }
  const result = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: '' });
  assert.equal(result.profiles[0].installation, 'linked-uninspected');
  assert.equal(result.profiles[0].linkTargetScope, 'dsh-home-shared-pnpm-untrusted');
  assert.equal(result.profiles[0].version, null);
  assert.equal(result.profiles[0].sourceBytesEqual, null);
  assert.ok(!JSON.stringify(result).includes(target));
});

test('shared store with nested junction escape is not allowed to hash private content', t => {
  const f = workspace(t);
  const target = path.join(f.home, 'profiles', 'node_modules', '.pnpm',
    'dsh-purge@1.1.92-wxcvm.18', 'node_modules', 'dsh-purge');
  const destination = path.join(f.home, 'profiles', 'desktop', 'node_modules', 'dsh-purge');
  const privateDir = path.join(f.base, 'private-nested');
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.mkdirSync(privateDir);
  fs.writeFileSync(path.join(target, 'package.json'),
    JSON.stringify({ name: 'dsh-purge', version: '1.1.92-wxcvm.18' }));
  fs.writeFileSync(path.join(privateDir, 'index.js'), 'PRIVATE_VALUE_NOT_FOR_DIAGNOSTICS');
  try {
    fs.symlinkSync(privateDir, path.join(target, 'lib'), process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) { t.skip('host cannot create junctions: ' + error.code); return; }
  const result = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: '' });
  assert.equal(result.profiles[0].installation, 'present-pnpm-link');
  assert.equal(result.profiles[0].sourceFileComparison['lib/index.js'], 'missing');
  assert.equal(result.runtimeLoadVerified, false);
  assert.ok(!JSON.stringify(result).includes(privateDir));
  assert.ok(!JSON.stringify(result).includes('PRIVATE_VALUE_NOT_FOR_DIAGNOSTICS'));
});

test('DSH_HOME private checkout link stays uninspected even with a valid manifest', t => {
  const f = workspace(t);
  const target = path.join(f.home, 'dsh-purge-developer-checkout');
  const destination = path.join(f.home, 'profiles', 'desktop', 'node_modules', 'dsh-purge');
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(path.join(target, 'package.json'),
    JSON.stringify({ name: 'dsh-purge', version: '1.1.92-wxcvm.18' }));
  try { fs.symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { t.skip('host cannot create symlinks: ' + error.code); return; }
  const result = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: '' });
  assert.equal(result.profiles[0].installation, 'linked-uninspected');
  assert.equal(result.profiles[0].linkTargetScope, 'inside-dsh-home-untrusted');
  assert.equal(result.profiles[0].version, null);
});

test('nonstandard DSH_HOME plugin link stays unread by default and is fingerprinted only on opt-in', t => {
  const f = workspace(t);
  const target = path.join(f.home, 'private-plugin-workspace');
  const dest = path.join(f.home, 'profiles', 'desktop', 'node_modules', 'dsh-purge');
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(path.join(target, 'package.json'),
    JSON.stringify({ name: 'dsh-purge', version: '1.1.92-wxcvm.18' }));
  for (const rel of sampleFiles) {
    fs.mkdirSync(path.dirname(path.join(f.root, rel)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(target, rel)), { recursive: true });
    fs.writeFileSync(path.join(f.root, rel), 'source-' + rel);
    fs.writeFileSync(path.join(target, rel), 'source-' + rel);
  }
  try { fs.symlinkSync(target, dest, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { t.skip('host cannot create symlinks: ' + error.code); return; }
  const normal = inspectReadOnlyDesktopEvidence({ home: f.home, root: f.root, exe: '' });
  assert.equal(normal.profiles[0].installation, 'linked-uninspected');
  assert.equal(normal.profiles[0].version, null);
  const permitted = inspectReadOnlyDesktopEvidence({
    home: f.home, root: f.root, exe: '', inspectHomeLinkedPlugin: true,
  });
  assert.equal(permitted.profiles[0].installation, 'present-operator-home-link');
  assert.equal(permitted.profiles[0].linkTargetScope, 'operator-opted-in-dsh-home-link');
  assert.equal(permitted.profiles[0].version, '1.1.92-wxcvm.18');
  assert.equal(permitted.profiles[0].sourceBytesEqual, true);
  fs.writeFileSync(path.join(target, 'lib', 'index.js'), 'earlier installed source');
  const changed = inspectReadOnlyDesktopEvidence({
    home: f.home, root: f.root, exe: '', inspectHomeLinkedPlugin: true,
  });
  assert.equal(changed.profiles[0].sourceBytesEqual, false);
  assert.equal(changed.profiles[0].sourceFileComparison['lib/index.js'], 'different');
  assert.equal(changed.runtimeLoadVerified, false);
  assert.ok(!JSON.stringify(changed).includes(target), 'do not show destination pathname');
});

test('operator opt-in never follows links outside DSH_HOME or symlinked private payloads', t => {
  const f = workspace(t);
  const outside = path.join(f.base, 'private-external-package');
  const dest = path.join(f.home, 'profiles', 'desktop', 'node_modules', 'dsh-purge');
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(path.join(outside, 'package.json'),
    JSON.stringify({ name: 'dsh-purge', version: 'private-secret-value' }));
  try { fs.symlinkSync(outside, dest, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { t.skip('host cannot create symlinks: ' + error.code); return; }
  const result = inspectReadOnlyDesktopEvidence({
    home: f.home, root: f.root, exe: '', inspectHomeLinkedPlugin: true,
  });
  assert.equal(result.profiles[0].installation, 'linked-uninspected');
  assert.equal(result.profiles[0].version, null);
  assert.equal(result.profiles[0].sourceBytesEqual, null);
  assert.ok(!JSON.stringify(result).includes(outside));
  assert.ok(!JSON.stringify(result).includes('private-secret-value'));
});

test('operator opt-in never reads a linked manifest or nested code escaping its plugin root', t => {
  const f = workspace(t);
  const target = path.join(f.home, 'private-plugin-workspace');
  const outside = path.join(f.base, 'external');
  const dest = path.join(f.home, 'profiles', 'desktop', 'node_modules', 'dsh-purge');
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(outside);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(path.join(outside, 'package.json'),
    JSON.stringify({ name: 'dsh-purge', version: '99.99.99' }));
  fs.writeFileSync(path.join(outside, 'index.js'), 'SECRET_NOT_READ');
  try {
    fs.symlinkSync(path.join(outside, 'package.json'), path.join(target, 'package.json'), 'file');
    fs.symlinkSync(outside, path.join(target, 'lib'), process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(target, dest, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) { t.skip('host cannot create symlinks: ' + error.code); return; }
  const result = inspectReadOnlyDesktopEvidence({
    home: f.home, root: f.root, exe: '', inspectHomeLinkedPlugin: true,
  });
  assert.equal(result.profiles[0].installation, 'invalid-manifest');
  assert.equal(result.profiles[0].version, null);
  assert.ok(!JSON.stringify(result).includes('SECRET_NOT_READ'));
  assert.ok(!JSON.stringify(result).includes(outside));
});
