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
function profileEvidence(home, name, root) {
  const dir = path.join(home, 'profiles', name);
  const installed = path.join(dir, 'node_modules', 'dsh-purge');
  const output = {
    profile: name, installation: 'absent', version: null,
    profileBundleRegistered: null, cordisInsertPresent: null,
    sourceBytesEqual: null, sourceFileComparison: {},
  };
  const manifest = safeJson(path.join(dir, 'package.json'));
  const bundles = manifest?.dsh?.profile?.bundles;
  if (Array.isArray(bundles)) output.profileBundleRegistered = bundles.includes('dsh-purge');
  // Presence only: do not print, parse or upload the user's cordis.patch.yml.
  output.cordisInsertPresent = regularFile(path.join(dir, 'cordis.patch.yml'));
  try {
    const stat = fs.lstatSync(installed);
    if (stat.isSymbolicLink()) {
      // pnpm normally links a profile package into its own .pnpm store.
      // Inspect only links verified to stay strictly under that profile's
      // node_modules/.pnpm; arbitrary links may point to private user files.
      const target = fs.realpathSync(installed);
      const store = fs.realpathSync(path.join(dir, 'node_modules', '.pnpm'));
      const relative = path.relative(store, target);
      const inside = relative && relative !== '..' && !relative.startsWith('..' + path.sep)
        && !path.isAbsolute(relative);
      if (!inside) {
        output.installation = 'linked-uninspected';
        return output;
      }
      output.installation = 'present-pnpm-link';
    } else if (!stat.isDirectory()) {
      output.installation = 'invalid';
      return output;
    }
  } catch {
    // A link without a resolvable in-profile pnpm store is not trusted.
    if (fs.existsSync(installed)) output.installation = 'linked-uninspected';
    return output;
  }
  const pkg = safeJson(path.join(installed, 'package.json'));
  if (pkg?.name !== 'dsh-purge' || !version(pkg.version)) {
    output.installation = 'invalid-manifest';
    return output;
  }
  if (output.installation !== 'present-pnpm-link') output.installation = 'present';
  output.version = version(pkg.version);
  for (const rel of CHECK_FILES) {
    const source = path.join(root, rel);
    const target = path.join(installed, rel);
    const a = regularFile(source) ? digest(source) : null;
    const b = regularFile(target) ? digest(target) : null;
    output.sourceFileComparison[rel] = !b ? 'missing' : !a ? 'candidate-unavailable'
      : a === b ? 'identical' : 'different';
  }
  output.sourceBytesEqual = Object.values(output.sourceFileComparison)
    .every(s => s === 'identical');
  return output;
}
function processEvidence() {
  if (process.platform !== 'win32') return { observed: null, reason: 'not-windows' };
  const expr = "(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(DeepSeek[ -]Harness|Dsh[ -]Next)$' } | Measure-Object).Count";
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', expr],
      { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const n = Number(String(result.stdout || '').trim());
    if (result.status === 0 && Number.isSafeInteger(n) && n >= 0)
      return { observed: n > 0, processCount: n, loadedPluginVerified: false };
  } catch {}
  return { observed: null, reason: 'process-query-unavailable', loadedPluginVerified: false };
}

export function inspectReadOnlyDesktopEvidence({
  home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
  root = repository, exe,
  findExe = findDesktopAppExecutable, probeProcesses = false,
} = {}) {
  const candidate = safeJson(path.join(root, 'package.json'));
  const evidence = {
    schema: 1,
    inspection: 'read-only-disk-and-process',
    writes: false, remoteRequests: false, runtimeLoadVerified: false,
    warning: 'Runner disk/process evidence cannot prove the running Desktop loaded this plugin, performed a restart, or delivered a Provider request.',
    candidate: { version: version(candidate?.version),
      commit: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '') ? process.env.GITHUB_SHA : null },
    desktop: {
      executableFound: false, manifestValid: false, version: null, layout: 'unknown',
      unpackedVersionMismatch: null, runtimeFilesComplete: null, missingRuntimeFiles: [],
    },
    process: probeProcesses ? processEvidence() : { observed: null, reason: 'not-requested', loadedPluginVerified: false },
    profiles: PROFILES.map(p => profileEvidence(home, p, root)),
  };
  let selected = typeof exe === 'string' ? exe : '';
  if (exe === undefined) {
    try { selected = findExe({ discover: true }) || ''; } catch {}
  }
  if (!selected || !regularFile(selected)) return evidence;
  evidence.desktop.executableFound = true;
  const resources = path.join(path.dirname(selected), 'resources');
  let pkg;
  try { pkg = readDesktopManifest(resources); } catch { return evidence; }
  if (pkg?.name !== '@deepseek-ai/dsh-desktop' || !version(pkg.version)) return evidence;
  evidence.desktop.manifestValid = true;
  evidence.desktop.version = version(pkg.version);
  const sealed = regularFile(path.join(resources, 'app.asar'));
  const unpacked = safeJson(path.join(resources, 'app', 'package.json'));
  evidence.desktop.layout = sealed ? (unpacked ? 'sealed-and-unpacked' : 'sealed')
    : unpacked ? 'unpacked' : 'unknown';
  evidence.desktop.unpackedVersionMismatch = unpacked?.name === pkg.name
    && Boolean(version(unpacked.version)) ? unpacked.version !== pkg.version : null;
  const missing = RUNTIME_FILES.filter(rel => !regularFile(path.join(resources, 'runtime', rel)));
  evidence.desktop.missingRuntimeFiles = missing;
  evidence.desktop.runtimeFilesComplete = missing.length === 0;
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = inspectReadOnlyDesktopEvidence({ probeProcesses: true });
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}
