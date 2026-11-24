import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyReleaseArtifact } from "../scripts/verify-release-artifact.mjs";
import { readZipMembers } from "../lib/zip-extract.js";

const tag = "v1.0.0";
const prefix = "dsh-purge-1.0.0";

function fixture(t) {
  const parent = realpathSync(tmpdir());
  const dir = mkdtempSync(path.join(parent, "purge-release-verifier-"));
  t.after(() => {
    assert.equal(path.dirname(realpathSync(dir)), parent);
    rmSync(dir, { recursive: true, force: true });
  });
  const cwd = path.join(dir, "repo");
  const git = (...args) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], {
    cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_NAME: "Verifier Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Verifier Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" },
  }).trim();
  mkdirSync(path.join(cwd, "lib"), { recursive: true });
  git("init", "--quiet");
  const write = (file, text) => writeFileSync(path.join(cwd, file), text);
  write("package.json", JSON.stringify({ name: "dsh-purge", version: "1.0.0" }));
  for (const file of ["client.js", "lib/index.js", "lib/update.js"]) write(file, "fixture: " + file + "\n");
  const nextCommit = () => { git("add", "."); git("commit", "--quiet", "-m", "fixture"); return git("rev-parse", "HEAD"); };
  const commit = nextCommit();
  git("tag", tag, commit);
  const archive = path.join(dir, prefix + ".zip");
  const checksums = path.join(dir, "SHA256SUMS.txt");
  const build = ref => {
    git("archive", "--format=zip", "--prefix=" + prefix + "/", "--output=" + archive, ref);
    const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
    writeFileSync(checksums, digest + "  " + prefix + ".zip\n");
    return digest;
  };
  const options = { tag, archive, checksums, commit, cwd };
  return { options, write, nextCommit, build };
}

test("release asset verifies downloaded bytes and tagged source without running the package", t => {
  const f = fixture(t);
  const digest = f.build(tag);
  const result = verifyReleaseArtifact({ ...f.options, digest: "sha256:" + digest });
  assert.equal(result.sha256, digest);
  assert.equal(result.commit, f.options.commit);
  assert.equal(result.signatureVerified, false);
  assert.equal(result.runtimeVerified, false);
  assert.deepEqual(result.checkedFiles, ["package.json", "client.js", "lib/index.js", "lib/update.js"]);
});

test("release verifier rejects incorrect tag expectation, mismatched digest and duplicated checksums", t => {
  const f = fixture(t);
  const digest = f.build(tag);
  assert.throws(() => verifyReleaseArtifact({ ...f.options, commit: "0".repeat(40) }), /Tag does not match/);
  assert.throws(() => verifyReleaseArtifact({ ...f.options, digest: "0".repeat(64) }), /asset digest mismatch/);
  writeFileSync(f.options.checksums, "0".repeat(64) + "  " + prefix + ".zip\n");
  assert.throws(() => verifyReleaseArtifact(f.options), /ZIP SHA-256 mismatch/);
  writeFileSync(f.options.checksums, (digest + "  " + prefix + ".zip\n").repeat(2));
  assert.throws(() => verifyReleaseArtifact(f.options), /exactly one checksum/);
});

test("generating new valid checksums does not hide a changed tagged payload", t => {
  const f = fixture(t);
  f.write("client.js", "not the tagged client\n");
  const later = f.nextCommit();
  f.build(later);
  assert.throws(() => verifyReleaseArtifact(f.options), /differs from the tagged source: client\.js/);
});

test("read-only ZIP member verification rejects inconsistent local headers", t => {
  const f = fixture(t);
  f.build(tag);
  const original = readFileSync(f.options.archive);
  const name = prefix + "/client.js";
  const offset = original.indexOf(Buffer.from(name)) - 30;
  assert.ok(offset >= 0);
  assert.equal(original.readUInt32LE(offset), 0x04034b50);
  assert.equal(readZipMembers(original, [name]).get(name).toString(), "fixture: client.js\n");
  const wrongName = Buffer.from(original);
  wrongName[offset + 30] ^= 1;
  assert.throws(() => readZipMembers(wrongName, [name]), /ZIP local header mismatch/);
  const wrongMethod = Buffer.from(original);
  wrongMethod.writeUInt16LE(original.readUInt16LE(offset + 8) === 0 ? 8 : 0, offset + 8);
  assert.throws(() => readZipMembers(wrongMethod, [name]), /ZIP local header mismatch/);
});
