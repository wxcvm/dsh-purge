import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";

// Only the package's shipped payload is touched. Validate all declared roots
// before taking snapshots or modifying any destination.
export function validateUpdatePayload(source, copyNames) {
  const pkg = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
  if (pkg.name !== "dsh-purge" || typeof pkg.version !== "string" || !pkg.version) {
    throw new Error("Invalid dsh-purge update manifest");
  }
  const declared = Array.isArray(pkg.files) ? pkg.files : [];
  const required = new Set(["package.json", "lib", "client.js"]);
  for (const entry of declared) {
    if (typeof entry !== "string" || entry.startsWith("!")) continue;
    const root = entry.split("/")[0];
    if (!root || !copyNames.includes(root)) throw new Error("Unsupported update payload: " + entry);
    required.add(root);
  }
  for (const file of ["lib/redteam/vps-admin-config.js", "lib/redteam/vps-admin-probe.js"]) {
    if (fs.existsSync(path.join(source, file))) required.add("scripts/vps-admin-check.mjs");
  }
  if (declared.includes("scripts")) required.add("scripts/ensure-profile-bundle.mjs");
  for (const file of required) {
    if (!fs.existsSync(path.join(source, file))) throw new Error("Missing update payload: " + file);
  }
  return copyNames.filter(name => fs.existsSync(path.join(source, name)));
}

// A snapshot of all affected groups is completed before the first write.
// Preserve existing overlay semantics for groups other than lib/docs/bin.
export async function copyUpdatePayload(source, dests, backupRoot, copyNames, {
  io = fsp, onProgress = () => {},
} = {}) {
  const names = validateUpdatePayload(source, copyNames);
  const entries = [];
  for (const [index, dest] of dests.entries()) {
    for (const name of names) {
      const target = path.join(dest, name);
      const backup = path.join(backupRoot, String(index), name);
      let exists;
      try { await io.lstat(target); exists = true; }
      catch (error) { if (error.code !== "ENOENT") throw error; exists = false; }
      if (exists) {
        await io.mkdir(path.dirname(backup), { recursive: true });
        await io.cp(target, backup, { recursive: true, force: true, verbatimSymlinks: true });
      }
      entries.push({ name, target, backup, exists });
    }
  }
  const touched = [];
  let copied = 0;
  try {
    for (const entry of entries) {
      touched.push(entry);
      onProgress({ copied, copyTotal: entries.length, group: entry.name });
      if (["lib", "docs", "bin"].includes(entry.name)) {
        await io.rm(entry.target, { recursive: true, force: true });
      }
      await io.cp(path.join(source, entry.name), entry.target, { recursive: true, force: true });
      onProgress({ copied: ++copied, copyTotal: entries.length, group: entry.name });
    }
  } catch (error) {
    const failures = [];
    for (const entry of touched.reverse()) {
      try {
        await io.rm(entry.target, { recursive: true, force: true });
        if (entry.exists) await io.cp(entry.backup, entry.target, { recursive: true, force: true, verbatimSymlinks: true });
      } catch (rollbackError) {
        failures.push(entry.target + ": " + rollbackError.message);
      }
    }
    if (failures.length) {
      const failure = new Error("Update copy failed: " + error.message + "; rollback incomplete: " + failures.join("; ") + "; backup retained: " + backupRoot);
      failure.keepUpdateBackup = true;
      throw failure;
    }
    throw new Error("Update copy failed; previous plugin files restored: " + error.message);
  }
}
