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
  const required = new Set(["package.json", "lib", "lib/index.js", "client.js"]);
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

const JOURNAL = "recovery.json";
const RECOVERY_NAMES = new Set(["lib","bin","docs","scripts","presets","skills","maintenance","client.js","cordis.patch.yml","screenshots.json","package.json","README.md","README.zh-CN.md","LICENSE","NOTICE"]);

async function saveJournal(root, journal) {
  await fsp.mkdir(root, { recursive: true });
  const tmp = path.join(root, JOURNAL + ".tmp");
  await fsp.writeFile(tmp, JSON.stringify(journal, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, path.join(root, JOURNAL));
}

export async function readUpdateRecovery(root) {
  const journal = JSON.parse(await fsp.readFile(path.join(root, JOURNAL), "utf8"));
  if (journal.schema !== 1 || !Array.isArray(journal.entries) ||
      !Number.isInteger(journal.touched) || journal.touched < 0 ||
      journal.touched > journal.entries.length ||
      !["copying", "complete", "restored", "rollback_incomplete"].includes(journal.phase)) {
    throw new Error("Invalid update recovery journal");
  }
  for (const entry of journal.entries) {
    if (!RECOVERY_NAMES.has(entry.name) || !path.isAbsolute(entry.dest) ||
        !Number.isInteger(entry.index) || entry.index < 0 ||
        typeof entry.exists !== "boolean") throw new Error("Invalid recovery entry");
  }
  return journal;
}

// Discover persistent transactions without modifying their files. A snapshot
// directory without a journal has not begun writing (journal precedes writes).
// Malformed/unreadable records must not be silently treated as complete.
export async function listPendingUpdateRecovery(home) {
  let dirs;
  try { dirs = await fsp.readdir(home, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const pending = [];
  for (const dir of dirs) {
    if (!dir.name.startsWith("copy-") || !dir.isDirectory()) continue;
    const root = path.join(home, dir.name);
    try {
      const journal = await readUpdateRecovery(root);
      if (["copying", "rollback_incomplete"].includes(journal.phase)) {
        pending.push({ root, phase: journal.phase, touched: journal.touched });
      }
    } catch (error) {
      if (error.code !== "ENOENT") pending.push({ root, phase: "unreadable", error: error.message });
    }
  }
  return pending;
}

export async function assertNoPendingUpdateRecovery(home) {
  const pending = await listPendingUpdateRecovery(home);
  if (pending.length) {
    throw new Error("存在未完成的更新恢复记录，请完全退出宿主并先检查或恢复: " +
      pending.map(item => item.root + " (" + item.phase + ")").join("; "));
  }
}

async function restoreEntries(root, entries, io = fsp) {
  const failures = [];
  for (const entry of [...entries].reverse()) {
    const target = path.join(entry.dest, entry.name);
    const backup = path.join(root, String(entry.index), entry.name);
    try {
      // Never remove an existing group if its required snapshot is absent.
      if (entry.exists) await io.lstat(backup);
      await io.rm(target, { recursive: true, force: true });
      if (entry.exists) await io.cp(backup, target, { recursive: true, force: true, verbatimSymlinks: true });
    } catch (error) { failures.push(target + ": " + error.message); }
  }
  return failures;
}

// Explicit offline recovery; a completed copy is not an interrupted copy.
// Caller must fully quit every host using the selected installations first.
export async function restoreInterruptedUpdate(root) {
  const journal = await readUpdateRecovery(root);
  if (!["copying", "rollback_incomplete"].includes(journal.phase)) {
    throw new Error("No interrupted file copy to restore: " + journal.phase);
  }
  const failures = await restoreEntries(root, journal.entries.slice(0, journal.touched));
  journal.phase = failures.length ? "rollback_incomplete" : "restored";
  await saveJournal(root, journal);
  if (failures.length) throw new Error("Recovery incomplete: " + failures.join("; "));
  return journal;
}

// A snapshot of all affected groups is completed before the first write.
// Preserve existing overlay semantics for groups other than lib/docs/bin.
export async function copyUpdatePayload(source, dests, backupRoot, copyNames, {
  io = fsp, onProgress = () => {},
} = {}) {
  const names = validateUpdatePayload(source, copyNames);
  const entries = [];
  const copyTotal = names.length * dests.length;
  for (const [index, dest] of dests.entries()) {
    for (const name of names) {
      const target = path.join(dest, name);
      const backup = path.join(backupRoot, String(index), name);
      onProgress({ copied: 0, copyTotal, group: "backup: " + name });
      let exists;
      try { await io.lstat(target); exists = true; }
      catch (error) { if (error.code !== "ENOENT") throw error; exists = false; }
      if (exists) {
        await io.mkdir(path.dirname(backup), { recursive: true });
        await io.cp(target, backup, { recursive: true, force: true, verbatimSymlinks: true });
      }
      entries.push({ name, target, backup, exists, dest: path.resolve(dest), index });
    }
  }
  const journal = { schema: 1, phase: "copying", touched: 0,
    entries: entries.map(({ name, dest, index, exists }) => ({ name, dest, index, exists })),
    startedAt: new Date().toISOString() };
  await saveJournal(backupRoot, journal);
  const touched = [];
  let copied = 0;
  try {
    for (const entry of entries) {
      journal.touched = touched.length + 1;
      await saveJournal(backupRoot, journal);
      touched.push(entry);
      onProgress({ copied, copyTotal: entries.length, group: entry.name });
      if (["lib", "docs", "bin"].includes(entry.name)) {
        await io.rm(entry.target, { recursive: true, force: true });
      }
      await io.cp(path.join(source, entry.name), entry.target, { recursive: true, force: true });
      onProgress({ copied: ++copied, copyTotal: entries.length, group: entry.name });
    }
    journal.phase = "complete";
    await saveJournal(backupRoot, journal);
  } catch (error) {
    const failures = await restoreEntries(backupRoot, touched, io);
    journal.phase = failures.length ? "rollback_incomplete" : "restored";
    try { await saveJournal(backupRoot, journal); }
    catch (journalError) { failures.push("recovery journal: " + journalError.message); }
    if (failures.length) {
      const failure = new Error("Update copy failed: " + error.message + "; rollback incomplete: " + failures.join("; ") + "; backup retained: " + backupRoot);
      failure.keepUpdateBackup = true;
      throw failure;
    }
    throw new Error("Update copy failed; previous plugin files restored: " + error.message);
  }
}
