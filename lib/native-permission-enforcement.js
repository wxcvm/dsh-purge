import { ALL_PATCHES } from "./patches-definitions.js";

export const NATIVE_PERMISSION_PATCH_IDS = Object.freeze([
  5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 29, 33, 34, 35, 36, 37, 48, 59, 60, 61, 62, 63, 70,
]);

const LEGACY_PERMISSION_REVERSES = Object.freeze([
  {
    id: 51,
    marker: "[dsh-purge] official approval teaching removed",
    from: "Write inside the workspace and permitted temporary directories; wider retries are auto-granted. // [dsh-purge] official approval teaching removed",
    to: "Write inside the workspace and permitted temporary directories; wider retries require approval.",
  },
]);

const NATIVE_PERMISSION_PATCH_SET = new Set(NATIVE_PERMISSION_PATCH_IDS);

export function isNativePermissionPatch(patchOrId) {
  const id = typeof patchOrId === "object" && patchOrId !== null
    ? patchOrId.id
    : patchOrId;
  return NATIVE_PERMISSION_PATCH_SET.has(id);
}

export function nativePermissionPatches(patches = ALL_PATCHES) {
  return patches
    .filter((patch) => isNativePermissionPatch(patch))
    .sort((left, right) => left.id - right.id);
}

/** Keep the original recovery evidence until permission restoration is verified. */
export function unresolvedPermissionBackupPaths({ pending, failed }) {
  return [...new Set([...pending, ...failed].map((item) => item.path))];
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
  const outputs = replacementsOf(patch)
    .map((row) => typeof row?.replace === "string" ? normalize(row.replace) : "")
    .filter(Boolean);
  return markersOf(patch).some((marker) => {
    const needle = normalize(marker);
    return source.includes(needle) && outputs.some((output) => output.includes(needle));
  });
}

/** Remove the legacy approval-teaching fragment from #51 without undoing its
 * legitimate preservation of an explicitly selected danger-full-access mode. */
export function restoreLegacyPermissionText(text) {
  const source = String(text ?? "");
  let output = normalize(source);
  const hits = [];
  let markerFound = false;
  for (const rule of LEGACY_PERMISSION_REVERSES) {
    if (!output.includes(rule.marker)) continue;
    markerFound = true;
    const needle = normalize(rule.from);
    if (!output.includes(needle)) continue;
    output = output.split(needle).join(normalize(rule.to));
    hits.push(rule.id);
  }
  const next = restoreLineEndings(output, source);
  const remainingMarkers = LEGACY_PERMISSION_REVERSES.some(rule => normalize(next).includes(rule.marker));
  return { text: next, changed: next !== source, markerFound, remainingMarkers, hits };
}

/**
 * Reverse only exact, marker-owned output from a known Purge permission patch.
 * Unmarked text is never rewritten, even if it resembles an upstream fragment.
 */
export function restoreNativePermissionText(text, patch) {
  const source = String(text ?? "");
  const markerFound = hasNativePermissionPatchMarker(source, patch);
  // #15 has two possible upstream confine signatures but one shared output.
  // Without the pre-patch backup we cannot know which native signature to put back.
  if (patch?.id === 15) {
    return { text: source, changed: false, markerFound, remainingMarkers: markerFound, hits: [] };
  }
  if (!markerFound) {
    return { text: source, changed: false, markerFound: false, remainingMarkers: false, hits: [] };
  }

  let output = normalize(source);
  const hits = [];
  const replacements = [...replacementsOf(patch)].sort((left, right) =>
    normalize(right?.replace).length - normalize(left?.replace).length,
  );
  for (const replacement of replacements) {
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
 * known sandbox-local patch sequence. The original file is restored only when
 * that exact sequence matches; otherwise the host file is left untouched.
 */
export function restoreNativePermissionFromBackup({
  current,
  backup,
  patch,
  relatedPatches,
  restorePatchIds,
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
  const candidates = [[]];
  for (const item of related) {
    const count = candidates.length;
    for (let i = 0; i < count; i += 1) candidates.push([...candidates[i], item]);
  }
  const matched = candidates.find((items) =>
    items.reduce((text, item) => normalize(applyPatch(text, item)), original) === live,
  );
  if (!matched) return { status: "ambiguous", text: current };
  if (matched.length === 0) return { status: "not-applied", text: current };

  const restoreIds = new Set(restorePatchIds || [patch.id]);
  const restored = related
    .filter((item) => !restoreIds.has(item.id))
    .reduce((text, item) => normalize(applyPatch(text, item)), original);
  return {
    status: "restored",
    text: restoreLineEndings(restored, current),
    changed: restored !== live,
    matchedPatchIds: matched.map((item) => item.id),
  };
}
