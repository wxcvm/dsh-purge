import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readZipMembers } from "../lib/zip-extract.js";

const files = ["package.json", "client.js", "lib/index.js", "lib/update.js",
  "bin/dsh-purge.js", "cordis.patch.yml", "maintenance/Harness-Recovery.ps1", "LICENSE", "NOTICE"];

// Compare the real npm-extracted files to a Git ZIP from the same candidate.
// This reads packaged bytes only: no installer hooks, host, or release operation.
function lfText(bytes) {
  const text = bytes.toString("utf8");
  return Buffer.from(text, "utf8").equals(bytes) ? text.replace(/\r\n/g, "\n") : null;
}

export function checkCandidateArchives({ cwd, outputDir, installedDir, commit = "HEAD" }) {
  const runGit = (args) => execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.eol=lf", ...args], { cwd, encoding: "utf8",
    windowsHide: true, timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
  const candidate = runGit(["rev-parse", "--verify", "--end-of-options", commit + "^{commit}"]).trim();
  assert.match(candidate, /^[a-f0-9]{40}$/, "expected a full candidate Git SHA");
  const packageBytes = readFileSync(path.join(installedDir, files[0]));
  const manifest = JSON.parse(packageBytes.toString("utf8"));
  assert.equal(manifest.name, "dsh-purge");
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/);
  const prefix = "dsh-purge-" + manifest.version + "/";
  const zipPath = path.join(outputDir, "candidate.zip");
  runGit(["archive", "--format=zip", "--prefix=" + prefix, "--output=" + zipPath, candidate]);

  const zip = readFileSync(zipPath);
  const members = readZipMembers(zip, files.map(file => prefix + file));
  let newlineOnly = 0;
  for (const file of files) {
    const member = members.get(prefix + file);
    assert.ok(member, "candidate ZIP missing " + file);
    const npmFile = file === files[0] ? packageBytes : readFileSync(path.join(installedDir, file));
    if (member.equals(npmFile)) continue;
    // Windows checkouts may convert tracked text to CRLF before npm packs it.
    // The generated renderer is explicitly byte-preserved by .gitattributes.
    const canonical = lfText(member);
    assert.ok(file !== "client.js" && canonical !== null && canonical === lfText(npmFile),
      "candidate ZIP and npm tarball differ: " + file);
    newlineOnly++;
  }
  return { commit: candidate, version: manifest.version, zipBytes: zip.length,
    zipSha256: createHash("sha256").update(zip).digest("hex"), fileCount: files.length, newlineOnly };
}
