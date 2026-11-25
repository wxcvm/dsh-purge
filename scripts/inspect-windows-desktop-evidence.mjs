/**
 * P0 read-only Windows Desktop evidence. Never print absolute paths,
 * command lines, preferences, session files, prompts, logs or credentials.
 * Disk equality and process presence are NOT proof of loaded plugin code.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findDesktopAppExecutable } from '../lib/desktop.js';
import { readDesktopManifest, RUNTIME_FILES } from '../lib/desktop-runtime-health.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const CHECK_FILES = Object.freeze([
  'lib/index.js', 'lib/prompt-profiles.js', 'lib/response-context.js',
  'lib/prompt-assembly-router.js', 'client.js',
  'lib/redteam/ui.js', 'lib/redteam/bridge-auth.js', 'lib/redteam/bridge-origin.js',
]);
const PROFILES = Object.freeze(['desktop', 'web', 'default']);

function regularFile(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && stat.size > 0;
  } catch { return false; }
}
function safeJson(file) {
  try {
    if (!regularFile(file) || fs.statSync(file).size > 128 * 1024) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
}
function version(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,79}$/.test(value)
    ? value : null;
}
function digest(file) {
  try { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
  catch { return null; }
}
// A fixed generated identifier can be compared with the UI status page.
// It describes disk contents only, not the running renderer.
function diskRendererBuildId(file) {
  try {
    if (!regularFile(file)) return null;
    return fs.readFileSync(file, 'utf8').match(/const CLIENT_BUILD_ID = "([0-9a-f]{16})";/)?.[1] || null;
  } catch { return null; }
}
function inside(root, target) {
  if (!root || !target) return false;
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep)
    && !path.isAbsolute(relative);
}
function realDirectory(dir) {
  try { return fs.realpathSync(dir); } catch { return ''; }
}
// Only explicitly understood pnpm layouts are permitted for installed-byte
// checks. A directory whose *name* resembles .pnpm is never sufficient.
function ordinaryDirectory(dir) {
  try {
    const stat = fs.lstatSync(dir);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch { return false; }
}
function verifiedPnpmLinkTarget(home, profileDir, target) {
  const homeReal = realDirectory(home);
  const profileReal = realDirectory(profileDir);
  const candidates = [
    { scope: 'verified-profile-pnpm-store', base: path.join(profileDir, 'node_modules', '.pnpm'),
      parent: profileReal },
    // DSH may host a shared pnpm virtual store for multiple profiles.
    { scope: 'verified-shared-profile-pnpm-store', base: path.join(homeReal, 'profiles', 'node_modules', '.pnpm'),
      parent: homeReal },
  ];
  for (const { scope, base, parent } of candidates) {
    if (!parent || !ordinaryDirectory(base)) continue;
    const store = realDirectory(base);
    if (!store || !inside(parent, store) || !inside(store, target)) continue;
    const rel = path.relative(store, target).split(path.sep);
    // Reject path-shaped package names or links to another package in pnpm's
    // node_modules. The final package itself must be a normal directory.
    if (rel.length !== 3 || !/^dsh-purge@[^\\/]+$/.test(rel[0])
      || rel[1] !== 'node_modules' || rel[2] !== 'dsh-purge') continue;
    const packageDir = path.join(store, rel[0]);
    const modulesDir = path.join(packageDir, 'node_modules');
    if (!ordinaryDirectory(packageDir) || !ordinaryDirectory(modulesDir)
      || !ordinaryDirectory(target)) continue;
    if (realDirectory(packageDir) !== packageDir
      || realDirectory(modulesDir) !== modulesDir
      || realDirectory(target) !== target) continue;
    return scope;
  }
  return null;
}
/** Metadata-only path categories; never include any resolved path in output. */
function classifyLink(target, home, profileDir, repositoryRoot) {
  const profileReal = realDirectory(profileDir);
  const homeReal = realDirectory(home);
  const checkoutReal = realDirectory(repositoryRoot);
  if (profileReal && inside(profileReal, target)) return 'inside-same-profile-untrusted';
  if (homeReal && inside(homeReal, target)) {
    // Only return a fixed, non-sensitive category. Do not emit any suffixes.
    const rel = path.relative(homeReal, target).split(path.sep);
    if (rel[0] === 'profiles' && rel[1] === 'node_modules')
      return rel[2] === '.pnpm' ? 'dsh-home-shared-pnpm-untrusted'
        : 'dsh-home-shared-modules-untrusted';
    if (rel[0] === 'profiles' && PROFILES.includes(rel[1]))
      return 'dsh-home-other-profile-untrusted';
    if (rel[0] === 'profiles') return 'dsh-home-other-profile-pool-untrusted';
    if (rel[0] === 'node_modules') return 'dsh-home-root-node-modules-untrusted';
    return 'inside-dsh-home-untrusted';
  }
  if (checkoutReal && (target === checkoutReal || inside(checkoutReal, target)))
    return 'inside-ci-checkout-untrusted';
  for (const [key, dir] of [['local-appdata', process.env.LOCALAPPDATA],
                            ['roaming-appdata', process.env.APPDATA]]) {
    const resolved = realDirectory(dir || '');
    if (resolved && (target === resolved || inside(resolved, target)))
      return key + '-untrusted';
  }
  // A pnpm store outside this profile may be legitimate, but must NOT be
  // followed based on filename spelling or a package.json claim alone.
  return 'external-untrusted';
}
function confinedFile(file, root) {
  try { return inside(root, fs.realpathSync(file)); } catch { return false; }
}
function profileEvidence(home, name, root, { inspectHomeLinkedPlugin = false } = {}) {
  const dir = path.join(home, 'profiles', name);
  const installed = path.join(dir, 'node_modules', 'dsh-purge');
  const output = {
    profile: name, installation: 'absent', version: null,
    profileBundleRegistered: null, cordisInsertPresent: null,
    linkTargetScope: null, sourceBytesEqual: null, sourceFileComparison: {},
    rendererBuildIdOnDisk: null,
  };
  const homeReal = realDirectory(home);
  const profileReal = realDirectory(dir);
  if (!profileReal) return output;
  if (!homeReal || !inside(homeReal, profileReal)) {
    output.installation = 'linked-uninspected';
    output.linkTargetScope = 'profile-directory-untrusted';
    return output;
  }
  const manifest = safeJson(path.join(dir, 'package.json'));
  const bundles = manifest?.dsh?.profile?.bundles;
  if (Array.isArray(bundles)) output.profileBundleRegistered = bundles.includes('dsh-purge');
  // Presence only: do not print, parse or upload the user's cordis.patch.yml.
  output.cordisInsertPresent = regularFile(path.join(dir, 'cordis.patch.yml'));
  const modulesReal = realDirectory(path.join(dir, 'node_modules'));
  if (modulesReal && !inside(profileReal, modulesReal)) {
    output.installation = 'linked-uninspected';
    output.linkTargetScope = 'profile-modules-untrusted';
    return output;
  }
  let installedRoot = '';
  try {
    const stat = fs.lstatSync(installed);
    if (stat.isSymbolicLink()) {
      // Resolving link metadata does not read its target's package files.
      // This identifies why a link is skipped without printing any paths.
      output.installation = 'linked-uninspected';
      output.linkTargetScope = 'unresolved';
      installedRoot = fs.realpathSync(installed);
      const verified = verifiedPnpmLinkTarget(home, dir, installedRoot);
      if (verified) {
        output.linkTargetScope = verified;
        output.installation = 'present-pnpm-link';
      } else {
        // Unknown DSH_HOME links remain metadata-only in every automatic CI.
        // This path is inspected ONLY when the operator explicitly opted in.
        const homeReal = realDirectory(home);
        if (!inspectHomeLinkedPlugin || !homeReal || !inside(homeReal, installedRoot)
            || !ordinaryDirectory(installedRoot)) {
          output.linkTargetScope = classifyLink(installedRoot, home, dir, root);
          return output;
        }
        output.linkTargetScope = 'operator-opted-in-dsh-home-link';
        output.installation = 'present-operator-home-link';
      }
    } else if (!stat.isDirectory()) {
      output.installation = 'invalid';
      return output;
    } else {
      installedRoot = fs.realpathSync(installed);
    }
  } catch { return output; }
  const manifestFile = path.join(installed, 'package.json');
  // Defend against nested file/directory links escaping even a trusted store.
  const pkg = confinedFile(manifestFile, installedRoot) ? safeJson(manifestFile) : null;
  if (pkg?.name !== 'dsh-purge' || !version(pkg.version)) {
    output.installation = 'invalid-manifest';
    return output;
  }
  if (!['present-pnpm-link', 'present-operator-home-link'].includes(output.installation))
    output.installation = 'present';
  output.version = version(pkg.version);
  const client = path.join(installed, 'client.js');
  if (confinedFile(client, installedRoot)) output.rendererBuildIdOnDisk = diskRendererBuildId(client);
  for (const rel of CHECK_FILES) {
    const source = path.join(root, rel);
    const target = path.join(installed, rel);
    const a = regularFile(source) ? digest(source) : null;
    const b = regularFile(target) && confinedFile(target, installedRoot) ? digest(target) : null;
    output.sourceFileComparison[rel] = !b ? 'missing' : !a ? 'candidate-unavailable'
      : a === b ? 'identical' : 'different';
  }
  output.sourceBytesEqual = Object.values(output.sourceFileComparison)
    .every(s => s === 'identical');
  return output;
}
// An empty or malformed PowerShell result is unavailable, not zero processes.
export function parseDesktopProcessCount(result) {
  const raw = String(result?.stdout ?? '').trim();
  if (result?.status !== 0 || result?.error || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
function processEvidence() {
  if (process.platform !== 'win32') return { observed: null, reason: 'not-windows', loadedPluginVerified: false };
  const expr = "(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(DeepSeek[ -]Harness|Dsh[ -]Next)$' } | Measure-Object).Count";
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', expr],
      { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const n = parseDesktopProcessCount(result);
    if (n !== null)
      return { observed: n > 0, processCount: n, loadedPluginVerified: false };
  } catch {}
  return { observed: null, reason: 'process-query-unavailable', loadedPluginVerified: false };
}

// Official 0.2.3-alpha.2 runtime requirement; disk metadata only.
// https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/upgrade-guide/v0.2.3-alpha.1/node-24-22-3/guide.zh.md
function alpha2NodeEvidence(resources, desktopVersion) {
  const result = {
    nodeVersionOnDisk: null,
    alpha2NodeRequirement: desktopVersion === '0.2.3-alpha.2' ? '^24.22.3 || >=26.13.1' : null,
    alpha2NodeRequirementMet: null,
  };
  const runtime = path.join(resources, 'runtime');
  const manifest = ordinaryDirectory(runtime) ? safeJson(path.join(runtime, 'versions.json')) : null;
  const match = typeof manifest?.node === 'string' && manifest.node.length <= 64
    ? /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(manifest.node) : null;
  if (!match) return result;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return result;
  result.nodeVersionOnDisk = [major, minor, patch].join('.');
  if (result.alpha2NodeRequirement !== null) {
    result.alpha2NodeRequirementMet =
      (major === 24 && (minor > 22 || (minor === 22 && patch >= 3))) ||
      (major === 26 && (minor > 13 || (minor === 13 && patch >= 1))) || major > 26;
  }
  return result;
}

export function inspectReadOnlyDesktopEvidence({
  home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
  root = repository, exe,
  findExe = findDesktopAppExecutable, probeProcesses = false,
  inspectHomeLinkedPlugin = false,
} = {}) {
  const candidate = safeJson(path.join(root, 'package.json'));
  const evidence = {
    schema: 1,
    inspection: 'read-only-disk-and-process',
    writes: false, remoteRequests: false, runtimeLoadVerified: false,
    warning: 'Runner disk/process evidence cannot prove the running Desktop loaded this plugin, performed a restart, or delivered a Provider request.',
    candidate: { version: version(candidate?.version),
      rendererBuildIdOnDisk: diskRendererBuildId(path.join(root, 'client.js')),
      commit: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '') ? process.env.GITHUB_SHA : null },
    desktop: {
      executableFound: false, manifestValid: false, version: null, layout: 'unknown',
      unpackedManifestValid: null, unpackedVersionMismatch: null, runtimeFilesComplete: null, missingRuntimeFiles: [],
      nodeVersionOnDisk: null, alpha2NodeRequirement: null, alpha2NodeRequirementMet: null,
    },
    process: probeProcesses ? processEvidence() : { observed: null, reason: 'not-requested', loadedPluginVerified: false },
    profiles: PROFILES.map(p => profileEvidence(home, p, root, { inspectHomeLinkedPlugin })),
  };
  let selected = typeof exe === 'string' ? exe : '';
  if (exe === undefined) {
    try { selected = findExe({ discover: true }) || ''; } catch {}
  }
  if (!selected || !regularFile(selected)) return evidence;
  evidence.desktop.executableFound = true;
  const resources = path.join(path.dirname(selected), 'resources');
  // A damaged or redirected app directory is still a competing disk entry.
  // Report its presence without following links or treating it as a clean install.
  if (!ordinaryDirectory(resources)) return evidence;
  const archive = path.join(resources, 'app.asar');
  const app = path.join(resources, 'app');
  const entryPresent = file => {
    try { fs.lstatSync(file); return true; }
    catch (error) { return error?.code === 'ENOENT' ? false : null; }
  };
  const sealed = entryPresent(archive);
  const unpackedPresent = entryPresent(app);
  evidence.desktop.layout = sealed === null || unpackedPresent === null ? 'unknown'
    : sealed ? (unpackedPresent ? 'sealed-and-unpacked' : 'sealed')
    : unpackedPresent ? 'unpacked' : 'unknown';
  const unpacked = ordinaryDirectory(app) ? safeJson(path.join(app, 'package.json')) : null;
  evidence.desktop.unpackedManifestValid = unpackedPresent === true
    ? unpacked?.name === '@deepseek-ai/dsh-desktop' && Boolean(version(unpacked.version))
    : null;
  // Never open an invalid archive entry, or fall back through an untrusted app directory.
  if (sealed === null || unpackedPresent === null || (sealed && !regularFile(archive))
      || (!sealed && !evidence.desktop.unpackedManifestValid)) return evidence;
  let pkg;
  try { pkg = sealed ? readDesktopManifest(resources) : unpacked; } catch { return evidence; }
  if (pkg?.name !== '@deepseek-ai/dsh-desktop' || !version(pkg.version)) return evidence;
  evidence.desktop.manifestValid = true;
  evidence.desktop.version = version(pkg.version);
  evidence.desktop.unpackedVersionMismatch = evidence.desktop.unpackedManifestValid
    ? unpacked.version !== pkg.version : null;
  const missing = RUNTIME_FILES.filter(rel => !regularFile(path.join(resources, 'runtime', rel)));
  evidence.desktop.missingRuntimeFiles = missing;
  evidence.desktop.runtimeFilesComplete = missing.length === 0;
  Object.assign(evidence.desktop, alpha2NodeEvidence(resources, evidence.desktop.version));
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inspectHomeLinkedPlugin = process.argv.slice(2).includes('--inspect-home-plugin-link');
  const data = inspectReadOnlyDesktopEvidence({ probeProcesses: true, inspectHomeLinkedPlugin });
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}
