import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALL_PATCHES } from "../lib/patches-definitions.js";
import { applyPatches, backupAll, inspectNativePermissionMigration, patchStatus, refreshStaleBaksForUpgrade, restoreNativePermissionForBases } from "../lib/core.js";
import {
  NATIVE_PERMISSION_PATCH_IDS,
  hasNativePermissionPatchMarker,
  isNativePermissionPatch,
  nativePermissionPatches,
  unresolvedPermissionBackupPaths,
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
  for (const id of [5, 7, 8, 9, 10, 11, 12, 14, 16, 17, 29, 33, 34, 35, 36, 37, 48, 59, 60, 61, 62, 63, 70]) {
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

test("patch #15 cannot be reversed without the exact pre-patch backup", () => {
  const patch = byId(15);
  const restored = restoreNativePermissionText(patch.replace, patch);
  assert.equal(restored.changed, false);
  assert.equal(restored.markerFound, true);
  assert.equal(restored.remainingMarkers, true);
});

test("patch #6/#15 restore the original sandbox-local file only after exact sequence match", () => {
  const patch = byId(6);
  const sibling = byId(15);
  const relatedPatches = [patch, sibling];
  const backup = `${patch.patterns[0]}\n${sibling.patterns[0]}\n`;
  const applyPatch = (text, item) => {
    let output = text;
    const replacements = Array.isArray(item.replacements)
      ? item.replacements
      : (item.patterns ?? []).map(pattern => ({ pattern, replace: item.replace }));
    for (const row of replacements) {
      if (typeof row.pattern === "string" && typeof row.replace === "string") {
        output = output.split(row.pattern).join(row.replace);
      }
    }
    return output;
  };
  const current = relatedPatches.reduce((text, item) => applyPatch(text, item), backup);
  const restored = restoreNativePermissionFromBackup({
    current,
    backup,
    patch,
    relatedPatches,
    restorePatchIds: [6, 15],
    applyPatch,
  });
  assert.equal(restored.status, "restored");
  assert.equal(restored.text, backup);
});

test("patch #15 can be restored when #6 never matched the installed source", () => {
  const patch = byId(6);
  const sibling = byId(15);
  const relatedPatches = [patch, sibling];
  const backup = `${patch.patterns[0]}\n${sibling.patterns[0]}\n`;
  const applyPatch = (text, item) => {
    let output = text;
    const replacements = Array.isArray(item.replacements)
      ? item.replacements
      : (item.patterns ?? []).map(pattern => ({ pattern, replace: item.replace }));
    for (const row of replacements) {
      if (typeof row.pattern === "string" && typeof row.replace === "string") {
        output = output.split(row.pattern).join(row.replace);
      }
    }
    return output;
  };
  const current = applyPatch(backup, sibling);
  const restored = restoreNativePermissionFromBackup({
    current,
    backup,
    patch,
    relatedPatches,
    restorePatchIds: [6, 15],
    applyPatch,
  });
  assert.equal(restored.status, "restored");
  assert.equal(restored.matchedPatchIds.length, 1);
  assert.deepEqual(restored.matchedPatchIds, [15]);
  assert.equal(restored.text, backup);
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

function makeSandboxHost(t, original) {
  const aiBase = fs.mkdtempSync(path.join(os.tmpdir(), "purge-native-permission-host-"));
  const file = path.join(aiBase, "dsh-sandbox-local", "lib", "index.js");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, original);
  t.after(() => fs.rmSync(aiBase, { recursive: true, force: true }));
  return { aiBase, file };
}

function applyPatchText(text, patch) {
  let output = text;
  const replacements = Array.isArray(patch.replacements)
    ? patch.replacements
    : (patch.patterns ?? []).map(pattern => ({ pattern, replace: patch.replace }));
  for (const row of replacements) {
    if (typeof row.pattern === "string" && typeof row.replace === "string") {
      output = output.split(row.pattern).join(row.replace);
    }
  }
  return output;
}

test("applyPatches leaves native sandbox deny and confine enforcement unchanged", async t => {
  const patch6 = byId(6);
  const patch15 = byId(15);
  const original = `${patch6.patterns[0]}\n${patch15.patterns[0]}\n`;
  const { aiBase, file } = makeSandboxHost(t, original);
  const report = await applyPatches(aiBase, [patch6, patch15]);
  assert.deepEqual(report.map(row => [row.patch_id, row.status]), [[6, "off"], [15, "off"]]);
  assert.equal(fs.readFileSync(file, "utf8"), original);
  const status = await patchStatus(aiBase, [patch6, patch15]);
  assert.equal(status[6], "off");
  assert.equal(status[15], "off");
});

test("ambiguous #6 host drift leaves both current file and original backup untouched", async t => {
  const patch6 = byId(6);
  const patch15 = byId(15);
  const original = `${patch6.patterns[0]}\n`;
  const { aiBase, file } = makeSandboxHost(t, original);
  const current = applyPatchText(original, patch6) + "// unrelated host edit\n";
  fs.writeFileSync(file, current);
  fs.writeFileSync(`${file}.dshpurge.bak`, original);

  const report = await applyPatches(aiBase, [patch6, patch15]);
  assert.equal(fs.readFileSync(file, "utf8"), current);
  assert.equal(fs.readFileSync(`${file}.dshpurge.bak`, "utf8"), original);
  assert.equal(report.find(row => row.patch_id === 6)?.status, "pending");
});

test("a missing #15 backup is not replaced with the already-bypassed host file", async t => {
  const patch15 = byId(15);
  const { aiBase, file } = makeSandboxHost(t, patch15.replace);
  const result = await restoreNativePermissionForBases([aiBase]);
  assert.ok(result.pending.some(row => row.patch_id === 15 && row.reason === "marker_remaining"));
  await backupAll(aiBase, { skipFiles: [file] });
  assert.equal(fs.existsSync(`${file}.dshpurge.bak`), false);
});

test("startup migration restores exact #6/#15 sandbox bypass output from its original backup", async t => {
  const patch6 = byId(6);
  const patch15 = byId(15);
  const original = `${patch6.patterns[0]}\n${patch15.patterns[0]}\n`;
  const { aiBase, file } = makeSandboxHost(t, original);
  const current = applyPatchText(applyPatchText(original, patch6), patch15);
  fs.writeFileSync(file, current);
  fs.writeFileSync(`${file}.dshpurge.bak`, original);

  const result = await restoreNativePermissionForBases([aiBase]);
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.equal(result.pending.length, 0);
  assert.equal(result.failed.length, 0);
  assert.ok(result.changed.some(row => row.patch_id === 6 && row.path === file));
  const status = await patchStatus(aiBase, [patch6, patch15]);
  assert.equal(status[6], "off");
  assert.equal(status[15], "off");
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

test("unresolved permission migrations preserve original backups after failure or ambiguity", async t => {
  const { aiBase, file } = makeSandboxHost(t, "original recovery evidence\n");
  const backup = file + ".dshpurge.bak";
  fs.writeFileSync(backup, "original recovery evidence\n");
  fs.writeFileSync(file, "unverified current file\n");
  const other = path.join(aiBase, "another-file");
  const paths = unresolvedPermissionBackupPaths({
    pending: [{ patch_id: 16, path: other }],
    failed: [{ patch_id: 6, path: file }, { patch_id: 15, path: file }],
  });
  assert.deepEqual(paths, [other, file]);
  assert.deepEqual(unresolvedPermissionBackupPaths({ pending: [], failed: [] }), []);
  await backupAll(aiBase, { skipFiles: paths });
  assert.deepEqual(refreshStaleBaksForUpgrade(aiBase, { skipPaths: paths }), []);
  assert.equal(fs.readFileSync(backup, "utf8"), "original recovery evidence\n");
  assert.equal(fs.readFileSync(file, "utf8"), "unverified current file\n");
});

test("read-only permission migration inventory distinguishes unknown and unresolved hosts", async t => {
  assert.deepEqual(await inspectNativePermissionMigration([]), {
    status: "unverified", inspected: 0, unresolved: 0,
  });
  const patch = byId(6);
  const original = patch.patterns[0];
  const { aiBase, file } = makeSandboxHost(t, original);
  const clean = await inspectNativePermissionMigration([aiBase]);
  assert.equal(clean.status, "no-known-residue");
  assert.ok(clean.inspected > 0);
  assert.equal(clean.unresolved, 0);
  const current = applyPatchText(original, patch);
  fs.writeFileSync(file, current);
  const before = fs.readFileSync(file);
  const unresolved = await inspectNativePermissionMigration([aiBase]);
  assert.equal(unresolved.status, "review");
  assert.ok(unresolved.unresolved > 0);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.existsSync(file + ".dshpurge.bak"), false);
});
