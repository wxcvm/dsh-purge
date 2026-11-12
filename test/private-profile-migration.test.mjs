import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { stagePrivateInstallArchive } from "../lib/private-install-cache.js";
import { migratePrivateProfile, privateMigrationCommand } from "../lib/private-profile-migration.js";

const sha = "a".repeat(40), version = "1.2.3";
const old = JSON.stringify({ dependencies: { "dsh-purge": "https://example.invalid/old.tgz", other: "1.0.0" } });
const oldLock = "lockfileVersion: '9.0'\n";
function archive() {
  const data = Buffer.from(JSON.stringify({ name: "dsh-purge", version }));
  const header = Buffer.alloc(512);
  header.write("repo/package.json");
  header.write(data.length.toString(8).padStart(11, "0"), 124);
  header[156] = 48;
  return gzipSync(Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512 + 1024)]));
}
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "purge-migration-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const dir = path.join(home, "profiles", "desktop");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "package.json"), old);
  await fs.writeFile(path.join(dir, "pnpm-lock.yaml"), oldLock);
  await stagePrivateInstallArchive({ home, sha, version, fetchArchive: async () => archive() });
  return { home, dir, profile: "desktop", sha, hostStopped: true };
}
async function resolveLock(dir) {
  const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
  const spec = pkg.dependencies["dsh-purge"];
  assert.match(spec, /^file:/);
  await fs.writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      dsh-purge:\n        specifier: " + JSON.stringify(spec) + "\n        version: " + JSON.stringify(spec) + "\n");
}
test("migration requires confirmation and validates the profile name", async t => {
  const opts = await fixture(t);
  await assert.rejects(migratePrivateProfile({ ...opts, hostStopped: false }), /host-stopped/);
  await assert.rejects(migratePrivateProfile({ ...opts, profile: "../desktop" }), /profile/);
  assert.equal(await fs.readFile(path.join(opts.dir, "package.json"), "utf8"), old);
});
test("migration resolves lockfile before installing and verifies installed version", async t => {
  const opts = await fixture(t), calls = [];
  const result = await migratePrivateProfile({ ...opts, run: async (_, args, dir) => {
    calls.push(args);
    if (args.includes("--lockfile-only")) await resolveLock(dir);
    else {
      const dest = path.join(dir, "node_modules", "dsh-purge");
      await fs.mkdir(dest, { recursive: true });
      await fs.writeFile(path.join(dest, "package.json"), JSON.stringify({ name: "dsh-purge", version }));
    }
  }});
  assert.equal(result.ok, true);
  assert.equal(result.needsRestart, true);
  assert.deepEqual(calls, [["install", "--lockfile-only", "--no-frozen-lockfile", "--ignore-scripts"], ["install", "--frozen-lockfile", "--ignore-scripts"]]);
  assert.equal(await fs.readFile(path.join(result.backupDir, "package.json"), "utf8"), old);
  assert.equal(JSON.parse(await fs.readFile(path.join(opts.dir, "package.json"), "utf8")).dependencies.other, "1.0.0");
});
test("resolution failure restores manifest and lockfile exactly", async t => {
  const opts = await fixture(t);
  await assert.rejects(migratePrivateProfile({ ...opts, run: async (_, args, dir) => {
    await fs.writeFile(path.join(dir, "pnpm-lock.yaml"), "broken");
    throw new Error("resolution failed");
  }}), /restored/);
  assert.equal(await fs.readFile(path.join(opts.dir, "package.json"), "utf8"), old);
  assert.equal(await fs.readFile(path.join(opts.dir, "pnpm-lock.yaml"), "utf8"), oldLock);
});
test("install failure preserves resolved configuration and reports incomplete installation", async t => {
  const opts = await fixture(t);
  await assert.rejects(migratePrivateProfile({ ...opts, run: async (_, args, dir) => {
    if (args.includes("--lockfile-only")) await resolveLock(dir);
    else throw new Error("install failed");
  }}), /install_incomplete/);
  assert.match(await fs.readFile(path.join(opts.dir, "package.json"), "utf8"), /file:/);
  const dirs = await fs.readdir(path.join(opts.home, "dsh-purge", "profile-migrations"));
  const journal = JSON.parse(await fs.readFile(path.join(opts.home, "dsh-purge", "profile-migrations", dirs[0], "migration.json"), "utf8"));
  assert.equal(journal.restoration, "install_incomplete");
});
test("Windows launcher rejects command wrappers", () => {
  assert.throws(() => privateMigrationCommand("pnpm.cmd", [], "win32"), /pnpm.exe/);
  const js = path.resolve("pnpm.cjs");
  assert.deepEqual(privateMigrationCommand(js, ["install"], "win32"), { file: process.execPath, args: [js, "install"] });
});
