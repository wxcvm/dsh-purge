import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkCandidateArchives } from "../scripts/check-candidate-archives.mjs";

test("paired archives reject modified packaged bytes and a different source manifest", t => {
  const parent = realpathSync(tmpdir());
  const root = mkdtempSync(path.join(parent, "purge-candidate-archive-test-"));
  t.after(() => {
    assert.equal(path.dirname(realpathSync(root)), parent);
    rmSync(root, { recursive: true, force: true });
  });
  const cwd = path.join(root, "repo");
  const installedDir = path.join(root, "installed");
  const git = (...args) => execFileSync("git", ["-c", "core.autocrlf=false", "-c", "commit.gpgsign=false",
    "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args],
  { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  mkdirSync(cwd);
  git("init", "--quiet");
  for (const file of ["client.js", "lib/index.js", "lib/update.js", "bin/dsh-purge.js",
    "cordis.patch.yml", "maintenance/Harness-Recovery.ps1", "LICENSE", "NOTICE"]) {
    const target = path.join(cwd, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "fixture " + file + "\n");
  }
  const manifest = path.join(cwd, "package.json");
  writeFileSync(manifest, '{"name":"dsh-purge","version":"1.0.0"}\n');
  git("add", ".");
  git("commit", "--quiet", "-m", "candidate");
  cpSync(cwd, installedDir, { recursive: true });
  const args = { cwd, outputDir: root, installedDir };
  const result = checkCandidateArchives(args);
  assert.equal(result.commit, git("rev-parse", "HEAD"));
  assert.equal(result.fileCount, 9);
  assert.match(result.zipSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.version, "1.0.0");
  assert.equal(result.zipBytes, readFileSync(path.join(root, "candidate.zip")).length);

  const cleanNotice = readFileSync(path.join(cwd, "NOTICE"), "utf8");
  writeFileSync(path.join(installedDir, "NOTICE"), cleanNotice.replace(/\n/g, "\r\n"));
  assert.equal(checkCandidateArchives(args).newlineOnly, 1);
  const client = path.join(installedDir, "client.js");
  writeFileSync(client, "fixture client.js\r\n");
  assert.throws(() => checkCandidateArchives(args), /differ: client\.js/);
  writeFileSync(client, "not the candidate\n");
  assert.throws(() => checkCandidateArchives(args), /differ: client\.js/);
  writeFileSync(client, readFileSync(path.join(cwd, "client.js")));
  writeFileSync(path.join(installedDir, "package.json"), '{"name":"dsh-purge","version":"1.0.1"}\n');
  assert.throws(() => checkCandidateArchives(args), /differ: package\.json/);
});
