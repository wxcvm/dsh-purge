import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { openArchive } from './archive-evidence.mjs';

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const packagePattern = /^(?:@[a-z0-9][a-z0-9_.-]*\/)?[a-z0-9][a-z0-9_.-]*$/u;
const requiredRuntimeFiles = [
  'versions.json',
  'bin/node.cmd',
  'cli/bin/dsh.cmd',
  'primary-runtime/dependencies/node/bin/node.exe',
  'primary-runtime/dependencies/pnpm/bin/pnpm.mjs',
  'primary-runtime/dependencies/pnpm/dist/pnpm.mjs',
];

function stat(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

function plainFile(root, relative) {
  const parts = relative.split('/');
  let location = root;
  for (const part of parts.slice(0, -1)) {
    location = join(location, part);
    if (!stat(location)?.isDirectory()) return false;
  }
  const file = stat(join(location, parts.at(-1)));
  return Boolean(file?.isFile() && file.size > 0);
}

function version(value) {
  return typeof value === 'string' && versionPattern.test(value) ? value : null;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, ''));
}

function inspectRuntime(resources) {
  const missing = requiredRuntimeFiles.filter((name) => !plainFile(resources, 'runtime/' + name));
  let versions = null;
  if (!missing.includes('versions.json')) {
    try {
      const manifest = loadJson(join(resources, 'runtime', 'versions.json'));
      if (manifest.schemaVersion === 1 && version(manifest.node) && version(manifest.pnpm)) {
        versions = { node: manifest.node, pnpm: manifest.pnpm };
      }
    } catch { /* Report invalid metadata separately from absent files. */ }
  }
  return { ready: missing.length === 0 && versions !== null, missing, versions };
}

function inspectLegacyTrees(resources) {
  return readdirSync(resources).sort().filter((name) => /^app(?:$|\.dshpurge-(?:prev|failed)(?:-|$))/iu.test(name)).map((name) => {
    const entry = stat(join(resources, name));
    return { name, directoryLink: entry?.isSymbolicLink() === true,
      runtimeLink: entry?.isDirectory() === true && stat(join(resources, name, 'runtime'))?.isSymbolicLink() === true };
  });
}

function inspectPlugins(profileRoot, archive, desktopVersion) {
  const profile = loadJson(join(profileRoot, 'package.json'));
  return Object.keys(profile.dependencies ?? {}).filter((name) => packagePattern.test(name)).sort().map((name) => {
    let manifest;
    try { manifest = loadJson(join(profileRoot, 'node_modules', name, 'package.json')); }
    catch (error) { return { name, status: error.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
    const pluginVersion = version(manifest.version);
    if (manifest.name !== name || !pluginVersion) return { name, status: 'manifest-invalid' };
    const pins = [], mismatches = [], unchecked = [];
    for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (!packagePattern.test(peer) || !/^@deepseek-ai\/(?:dsh(?:-|$)|cordis$)/u.test(peer)) continue;
      const declared = version(range);
      let actual = null;
      try {
        const bundled = archive.jsonMember('dsh/node_modules/' + peer + '/package.json');
        const host = bundled ?? archive.jsonMember('node_modules/' + peer + '/package.json');
        if (host?.name === peer) actual = version(host.version);
      } catch { /* A manifest that cannot be read is unverified. */ }
      if (!declared || !actual) { unchecked.push(peer); continue; }
      pins.push({ package: peer, expected: declared, actual });
      if (declared !== actual) mismatches.push({ package: peer, expected: declared, actual });
    }
    const targets = [...new Set([manifest.dshTarget,
      ...(Array.isArray(manifest.dshTargets) ? manifest.dshTargets : [])].map(version).filter(Boolean))];
    const targetDeclared = targets.length ? targets.includes(desktopVersion) : null;
    const status = mismatches.length ? 'peer-mismatch' : targetDeclared === false ? 'target-not-declared' :
      pins.length ? 'exact-pins-match' : 'unverified';
    return { name, version: pluginVersion, status, mismatches, pins, unchecked, targetDeclared };
  });
}

export function auditUpdate({ installRoot, profileRoot, targetArchive, expectedVersion }) {
  if (!isAbsolute(installRoot) || !isAbsolute(profileRoot) || (targetArchive && !isAbsolute(targetArchive))) {
    throw new Error('Use absolute paths for the installation, profile and optional target archive');
  }
  if (expectedVersion && !version(expectedVersion)) throw new Error('Invalid expected version');
  const resources = join(installRoot, 'resources');
  const currentArchive = join(resources, 'app.asar');
  if (!stat(resources)?.isDirectory() || !plainFile(resources, 'app.asar')) {
    throw new Error('A plain resources directory and a packed app.asar are required');
  }
  const current = openArchive(currentArchive);
  try {
    const target = targetArchive ? openArchive(targetArchive) : current;
    try {
      function desktopVersion(archive) {
        const manifest = archive.jsonMember('package.json');
        const value = manifest?.name === '@deepseek-ai/dsh-desktop' && version(manifest.version);
        if (!value) throw new Error('Missing or invalid desktop manifest in ASAR');
        return value;
      }
      const installed = desktopVersion(current), compared = desktopVersion(target);
      const runtime = inspectRuntime(resources);
      const legacyTrees = inspectLegacyTrees(resources);
      const pendingArchiveSwap = stat(join(resources, 'app.asar.rename-pending')) !== null;
      const blockers = [];
      if (expectedVersion && installed !== expectedVersion) blockers.push('installed-version-mismatch');
      if (!runtime.ready) blockers.push('runtime-incomplete');
      if (legacyTrees.length || pendingArchiveSwap) blockers.push('nonstandard-install-layout');
      const plugins = inspectPlugins(profileRoot, target, compared);
      return { installedVersion: installed, comparisonVersion: compared, candidateChecked: Boolean(targetArchive),
        runtime, legacyTrees, pendingArchiveSwap, blockers, plugins,
        pluginWarnings: plugins.filter((p) => !['exact-pins-match', 'unverified'].includes(p.status)) };
    } finally { if (target !== current) target.close(); }
  } finally { current.close(); }
}
