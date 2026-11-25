import test from "node:test";
import assert from "node:assert/strict";
import { ALL_PATCHES } from "../lib/patches-definitions.js";
import {
  NATIVE_PERMISSION_PATCH_IDS,
  hasNativePermissionPatchMarker,
  isNativePermissionPatch,
  nativePermissionPatches,
  restoreLegacyPermissionText,
  restoreNativePermissionFromBackup,
  restoreNativePermissionText,
} from "../lib/native-permission-enforcement.js";

const byId = id => ALL_PATCHES.find(patch => patch.id === id);
const replacementsOf = patch => Array.isArray(patch.replacements)
  ? patch.replacements
  : [{ pattern: patch.patterns?.[0], replace: patch.replace }];

test("the default patch set disables permission and approval bypasses, not compatibility fixes", () => {
  assert.deepEqual(
    nativePermissionPatches().map(patch => patch.id),
    NATIVE_PERMISSION_PATCH_IDS,
  );
  for (const id of NATIVE_PERMISSION_PATCH_IDS) assert.equal(isNativePermissionPatch(id), true);
  for (const id of [13, 51, 94, 30, 31, 64, 65]) assert.equal(isNativePermissionPatch(id), false);
});

test("marked approval, sandbox and filesystem patches reverse only their exact Purge output", () => {
  for (const id of [5, 7, 8, 9, 10, 11, 12, 14, 15, 17, 33, 34, 35, 36, 48, 60, 61, 62, 63]) {
    const patch = byId(id);
    assert.ok(patch, `missing patch #${id}`);
    const replacements = replacementsOf(patch);
    const marker = [patch.marker, ...(patch.markers ?? [])]
      .filter(Boolean)
      .find(value => replacements.some(row => typeof row.replace === "string" && row.replace.includes(value)));
    assert.ok(marker, `#${id} has no marker tied to its output`);
    const patched = replacements.map(row => row.replace).filter(Boolean).join("\n");
    assert.equal(hasNativePermissionPatchMarker(patched, patch), true, `#${id} marker not detected`);
    const restored = restoreNativePermissionText(patched, patch);
    assert.equal(restored.changed, true, `#${id} did not reverse`);
    assert.equal(restored.remainingMarkers, false, `#${id} left a Purge marker`);
    assert.ok(
      replacements.some(row => typeof row.pattern === "string" && restored.text.includes(row.pattern)),
      `#${id} did not restore a native fragment`,
    );
  }
});

test("unmarked permission-looking text is never rewritten", () => {
  const patch = byId(14);
  const text = 'const outcome = approval.approver !== undefined ? "allowed-once" : "allowed-once";';
  const restored = restoreNativePermissionText(text, patch);
  assert.equal(restored.changed, false);
  assert.equal(restored.text, text);
});

test("patch #51 keeps explicit full access but restores the legacy auto-grant sentence", () => {
  const patch = byId(51);
  assert.equal(isNativePermissionPatch(patch), false);
  assert.equal(patch.replacements.length, 1, "only the explicit deployed-mode preservation remains active");
  const active = patch.replacements[0].replace;
  const legacy = "Write inside the workspace and permitted temporary directories; wider retries are auto-granted. // [dsh-purge] official approval teaching removed";
  const source = active + "\n" + legacy;
  const restored = restoreLegacyPermissionText(source);
  assert.equal(restored.changed, true);
  assert.ok(restored.text.includes(active));
  assert.ok(restored.text.includes("Write inside the workspace and permitted temporary directories; wider retries require approval."));
  assert.equal(restored.remainingMarkers, false);
});

test("patch #7/#8 restore the official workspace-write default while retaining env override", () => {
  const mode = byId(7);
  const policy = byId(8);
  const modeResult = restoreNativePermissionText(mode.replace, mode);
  const policyResult = restoreNativePermissionText(policy.replace, policy);
  assert.equal(modeResult.text, mode.patterns[0]);
  assert.equal(policyResult.text, policy.patterns[0]);
  assert.match(policyResult.text, /process\.env\.DSH_PERMISSION_MODE/);
  assert.match(policyResult.text, /'workspace-write'/);
  assert.match(policyResult.text, /=== 'danger-full-access' \? 'never' : 'ask'/);
});

test("patch #6 restores only its own sandbox-local change and preserves sibling patch #15", () => {
  const patch = byId(6);
  const sibling = {
    id: 15,
    patterns: ["native-confine"],
    replace: "purge-confine",
  };
  const relatedPatches = [patch, sibling];
  const backup = 'const rules = ["deny file-write*"];\nfunction confine() { native-confine }\n';
  const applyPatch = (text, item) => {
    let output = text;
    for (const pattern of item.patterns ?? []) output = output.split(pattern).join(item.replace);
    return output;
  };
  const current = relatedPatches.reduce((text, item) => applyPatch(text, item), backup);
  const restored = restoreNativePermissionFromBackup({
    current,
    backup,
    patch,
    relatedPatches,
    applyPatch,
  });
  assert.equal(restored.status, "restored");
  assert.equal(restored.text, 'const rules = ["deny file-write*"];\nfunction confine() { purge-confine }\n');
});

test("patch #6 refuses to overwrite a host file that changed after its backup", () => {
  const patch = byId(6);
  const backup = 'const rules = ["deny file-write*"];\n';
  const applyPatch = (text, item) => text.split(item.patterns[0]).join(item.replace);
  const current = applyPatch(backup, patch) + "// unrelated host update\n";
  const result = restoreNativePermissionFromBackup({
    current,
    backup,
    patch,
    relatedPatches: [patch],
    applyPatch,
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.text, current);
});

test("patch #6 is idempotent after an exact restoration", () => {
  const patch = byId(6);
  const backup = 'const rules = ["deny file-write*"];\n';
  const result = restoreNativePermissionFromBackup({
    current: backup,
    backup,
    patch,
    relatedPatches: [patch],
    applyPatch: (text, item) => text.split(item.patterns[0]).join(item.replace),
  });
  assert.equal(result.status, "already-restored");
  assert.equal(result.text, backup);
});
