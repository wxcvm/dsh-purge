import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import semver from 'semver';
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
  return typeof value === 'string' && versionPattern.test(value) && semver.valid(value) ? value : null;
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

function readHostPackage(archive, name) {
  for (const prefix of ['dsh/node_modules/', 'node_modules/']) {
    try {
      const pkg = archive.jsonMember(prefix + name + '/package.json');
      if (pkg?.name === name && version(pkg.version)) return pkg;
    } catch { /* Missing, unverified or non-packed members are not a match. */ }
  }
  return null;
}

function inspectPlugins(profileRoot, archive, desktopVersion) {
  const profile = loadJson(join(profileRoot, 'package.json'));
  return Object.keys(profile.dependencies ?? {}).filter((name) => packagePattern.test(name)).sort().map((name) => {
    let manifest;
    try { manifest = loadJson(join(profileRoot, 'node_modules', name, 'package.json')); }
    catch (error) { return { name, status: error.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
    const pluginVersion = version(manifest.version);
    if (manifest.name !== name || !pluginVersion) return { name, status: 'manifest-invalid' };
    const pins = [], ranges = [], mismatches = [], unchecked = [];
    for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (!packagePattern.test(peer) || !/^@deepseek-ai\/(?:dsh(?:-|$)|cordis$)/u.test(peer)) continue;
      const actual = readHostPackage(archive, peer)?.version;
      const expected = typeof range === 'string' ? range.trim() : '';
      if (!expected || !semver.validRange(expected) || !actual) {
        if (!(manifest.peerDependenciesMeta?.[peer]?.optional && !actual)) unchecked.push(peer);
        continue;
      }
      const record = { package: peer, expected, actual };
      if (version(expected)) pins.push(record);
      else ranges.push(record);
      // In particular, a stable range must not silently admit an alpha peer.
      if (!semver.satisfies(actual, expected)) mismatches.push(record);
    }
    const targets = [...new Set([manifest.dshTarget,
      ...(Array.isArray(manifest.dshTargets) ? manifest.dshTargets : [])].map(version).filter(Boolean))];
    const targetDeclared = targets.length ? targets.includes(desktopVersion) : null;
    const status = mismatches.length ? 'peer-mismatch' : targetDeclared === false ? 'target-not-declared' :
      unchecked.length ? 'unverified' : ranges.length ? 'ranges-match' : pins.length ? 'exact-pins-match' : 'unverified';
    return { name, version: pluginVersion, status, mismatches, pins, ranges, unchecked, targetDeclared };
  });
}

export function auditUpdate({ installRoot, profileRoot, targetArchive, targetInstallRoot,
  expectedVersion, expectedTargetVersion }) {
  if (!isAbsolute(installRoot) || !isAbsolute(profileRoot) || (targetArchive && !isAbsolute(targetArchive)) ||
      (targetInstallRoot && !isAbsolute(targetInstallRoot))) {
    throw new Error('Use absolute paths for the installation, profile and optional target');
  }
  if (targetInstallRoot && targetArchive) throw new Error('Select either the target installation root or the target archive');
  if (expectedVersion && !version(expectedVersion)) throw new Error('Invalid expected version');
  if (expectedTargetVersion && (!version(expectedTargetVersion) || !(targetArchive || targetInstallRoot))) {
    throw new Error('An exact expected target version requires a target installation root or archive');
  }
  const resources = join(installRoot, 'resources');
  const targetResources = targetInstallRoot && join(targetInstallRoot, 'resources');
  const currentArchive = join(resources, 'app.asar');
  if (!stat(resources)?.isDirectory() || !plainFile(resources, 'app.asar')) {
    throw new Error('A plain resources directory and a packed app.asar are required');
  }
  if (targetResources && (!stat(targetResources)?.isDirectory() || !plainFile(targetResources, 'app.asar'))) {
    throw new Error('The target installation must contain a plain resources directory and a packed app.asar');
  }
  const candidate = targetArchive || (targetResources && join(targetResources, 'app.asar'));
  const current = openArchive(currentArchive);
  try {
    const target = candidate ? openArchive(candidate) : current;
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
      let targetRuntime = null;
      if (candidate) {
        if (expectedTargetVersion && compared !== expectedTargetVersion) blockers.push('target-version-mismatch');
        if (!targetResources) blockers.push('target-runtime-unverified');
        else {
          const files = inspectRuntime(targetResources);
          const host = readHostPackage(target, '@deepseek-ai/dsh');
          const requirement = host?.engines?.node;
          const nodeRange = typeof requirement === 'string' && requirement.trim() &&
            semver.validRange(requirement) ? requirement : null;
          const nodeStatus = !files.ready || !nodeRange ? 'unverified' :
            semver.satisfies(files.versions.node, nodeRange) ? 'compatible' : 'incompatible';
          targetRuntime = { ...files, hostVersion: host?.version ?? null, nodeRange, nodeStatus };
          if (!files.ready) blockers.push('target-runtime-incomplete');
          else if (nodeStatus === 'unverified') blockers.push('target-runtime-unverified');
          else if (nodeStatus === 'incompatible') blockers.push('target-runtime-incompatible');
          if (host && host.version !== compared) blockers.push('target-host-version-mismatch');
          if (inspectLegacyTrees(targetResources).length || stat(join(targetResources, 'app.asar.rename-pending'))) {
            blockers.push('nonstandard-target-layout');
          }
        }
      }
      const plugins = inspectPlugins(profileRoot, target, compared);
      return { installedVersion: installed, comparisonVersion: compared, candidateChecked: Boolean(candidate),
        runtime, targetRuntime, legacyTrees, pendingArchiveSwap, blockers, plugins,
        pluginWarnings: plugins.filter((p) =>
          !['exact-pins-match', 'ranges-match', 'unverified'].includes(p.status) ||
          (Boolean(candidate) && p.status === 'unverified' && p.unchecked?.length > 0)) };
    } finally { if (target !== current) target.close(); }
  } finally { current.close(); }
}
