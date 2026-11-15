import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { inspectPrivateInstallArchive, privateInstallArchiveUrl, stagePrivateInstallArchive } from "../lib/private-install-cache.js";

const sha = "a".repeat(40);
const version = "1.1.92-wxcvm.7-beta.3";
const fixture = (pkg = { name: "dsh-purge", version }) => {
  const data = Buffer.from(JSON.stringify(pkg));
  const header = Buffer.alloc(512);
  header.write("wxcvm-dsh-purge-aaaaaaa/package.json", 0);
  header.write(data.length.toString(8).padStart(11, "0"), 124);
  header[156] = 48;
  return gzipSync(Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512), Buffer.alloc(1024)]));
};

test("private install archive requires a full commit and validates the package manifest", () => {
  assert.equal(privateInstallArchiveUrl(sha), "https://api.github.com/repos/wxcvm/dsh-purge/tarball/" + sha);
  assert.throws(() => privateInstallArchiveUrl("beta"), /SHA/);
  assert.deepEqual(inspectPrivateInstallArchive(fixture(), version), { name: "dsh-purge", version });
  assert.throws(() => inspectPrivateInstallArchive(fixture({ name: "wrong", version }), version), /不一致/);
  assert.throws(() => inspectPrivateInstallArchive(fixture({ name: "dsh-purge", version: "1.0.0" }), version), /不一致/);
  assert.throws(() => inspectPrivateInstallArchive(Buffer.from("not a tarball"), version));
});

test("private install cache verifies integrity, reuses valid bytes and replaces damaged cache", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "purge-private-cache-"));
  try {
    const bytes = fixture();
    let downloads = 0;
    const args = { home, sha, version, fetchArchive: async url => {
      assert.equal(url, privateInstallArchiveUrl(sha));
      downloads++;
      return bytes;
    }};
    const first = await stagePrivateInstallArchive(args);
    assert.equal(first.reused, false);
    assert.equal(first.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(first.size, bytes.length);
    assert.deepEqual(await fs.readFile(first.archivePath), bytes);
    assert.equal((await stagePrivateInstallArchive(args)).reused, true);
    assert.equal(downloads, 1);
    await fs.writeFile(first.archivePath, "corrupt");
    assert.equal((await stagePrivateInstallArchive(args)).reused, false);
    assert.equal(downloads, 2);
    assert.deepEqual(await fs.readFile(first.archivePath), bytes);
    assert.equal((await fs.readdir(path.dirname(first.archivePath))).some(n => n.startsWith(".stage-")), false);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("failed or wrong-version downloads do not publish an installation archive", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "purge-private-cache-"));
  try {
    await assert.rejects(stagePrivateInstallArchive({ home, sha, version, fetchArchive: async () => { throw Error("offline"); } }), /offline/);
    await assert.rejects(stagePrivateInstallArchive({ home, sha, version, fetchArchive: async () => fixture({ name: "dsh-purge", version: "0.0.0" }) }), /不一致/);
    assert.deepEqual(await fs.readdir(path.join(home, "dsh-purge", "install-cache")), []);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
