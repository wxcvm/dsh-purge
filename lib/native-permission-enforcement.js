import { ALL_PATCHES } from "./patches-definitions.js";

export const NATIVE_PERMISSION_PATCH_IDS = Object.freeze([
  5, 6, 7, 8, 9, 10, 11, 12, 14, 17, 35, 60, 61, 62,
]);

const NATIVE_PERMISSION_PATCH_SET = new Set(NATIVE_PERMISSION_PATCH_IDS);

export function isNativePermissionPatch(patchOrId) {
  const id = typeof patchOrId === "object" && patchOrId !== null
    ? patchOrId.id
    : patchOrId;
  return NATIVE_PERMISSION_PATCH_SET.has(id);
}

export function nativePermissionPatches(patches = ALL_PATCHES) {
  return patches.filter((patch) => isNativePermissionPatch(patch));
}

function markersOf(patch) {
  return [
    ...(typeof patch?.marker === "string" ? [patch.marker] : []),
    ...(Array.isArray(patch?.markers) ? patch.markers : []),
  ].filter((marker) => typeof marker === "string" && marker.length > 0);
}

function replacementsOf(patch) {
  if (Array.isArray(patch?.replacements)) return patch.replacements;
  return (patch?.patterns ?? []).map((pattern) => ({ pattern, replace: patch.replace }));
}

function normalize(text) {
  return String(text ?? "").replace(/\r\n/g, "\n");
}

function restoreLineEndings(text, source) {
  return source.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
}

export function hasNativePermissionPatchMarker(text, patch) {
  if (!isNativePermissionPatch(patch) || patch.id === 6) return false;
  const source = normalize(text);
  return markersOf(patch).some((marker) => source.includes(normalize(marker)));
}

/**
 * Reverse only exact, marker-owned output from a known Purge permission patch.
 * Unmarked text is never rewritten, even if it resembles an upstream fragment.
 */
export function restoreNativePermissionText(text, patch) {
  const source = String(text ?? "");
  const markerFound = hasNativePermissionPatchMarker(source, patch);
  if (!markerFound) {
    return { text: source, changed: false, markerFound: false, remainingMarkers: false, hits: [] };
  }

  let output = normalize(source);
  const hits = [];
  for (const replacement of replacementsOf(patch)) {
    const { pattern, replace } = replacement || {};
    if (typeof pattern !== "string" || typeof replace !== "string" || pattern === replace) continue;
    const written = normalize(replace);
    if (!written || !output.includes(written)) continue;
    output = output.split(written).join(normalize(pattern));
    hits.push(pattern);
  }

  const next = restoreLineEndings(output, source);
  return {
    text: next,
    changed: next !== source,
    markerFound: true,
    remainingMarkers: hasNativePermissionPatchMarker(next, patch),
    hits,
  };
}

/**
 * Patch #6 has no unique marker. It may be reversed only when the existing
 * pre-patch backup proves the exact current file is the result of the complete
 * known sandbox-local patch sequence. Related patches are replayed so #15 is
 * preserved rather than restoring the whole file blindly.
 */
export function restoreNativePermissionFromBackup({
  current,
  backup,
  patch,
  relatedPatches,
  applyPatch,
}) {
  if (!isNativePermissionPatch(patch) || patch.id !== 6) {
    return { status: "not-applicable", text: current };
  }
  if (typeof current !== "string" || typeof backup !== "string" || typeof applyPatch !== "function") {
    return { status: "unverified", text: current };
  }

  const live = normalize(current);
  const original = normalize(backup);
  if (live === original) return { status: "already-restored", text: current };

  const related = Array.isArray(relatedPatches) ? relatedPatches : [patch];
  const expected = related.reduce((text, item) => normalize(applyPatch(text, item)), original);
  if (expected === original) return { status: "not-applied", text: current };
  if (live !== expected) return { status: "ambiguous", text: current };

  const restored = related
    .filter((item) => item.id !== patch.id)
    .reduce((text, item) => normalize(applyPatch(text, item)), original);
  return {
    status: "restored",
    text: restoreLineEndings(restored, current),
    changed: restored !== live,
  };
}
