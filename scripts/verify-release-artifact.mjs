import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { readZipMembers } from "../lib/zip-extract.js";

const files = ["package.json", "client.js", "lib/index.js", "lib/update.js"];
const sha256 = buffer => createHash("sha256").update(buffer).digest("hex");
const git = (args, cwd) => execFileSync("git", args, {
  cwd, windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
});

export function verifyReleaseArtifact({ tag, archive, checksums, commit, digest, cwd = process.cwd() }) {
  if (!/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(tag || "")) throw Error("Invalid release tag");
  if (commit && !/^[a-f\d]{40}$/i.test(commit)) throw Error("Expected commit must be a full Git SHA");
  const version = tag.slice(1);
  const root = "dsh-purge-" + version;
  const asset = root + ".zip";
  if (basename(archive || "") !== asset) throw Error("Expected release asset named " + asset);
  const checksumRecords = readFileSync(checksums, "utf8").split(/\r?\n/)
    .map(line => /^([a-f\d]{64})[ \t]+\*?(.+)$/i.exec(line)).filter(line => line?.[2] === asset);
  if (checksumRecords.length !== 1) throw Error("Expected exactly one checksum for " + asset);
  const tagged = git(["rev-parse", "--verify", "refs/tags/" + tag + "^{commit}"], cwd).toString("ascii").trim();
  if (commit && tagged !== commit.toLowerCase()) throw Error("Tag does not match the expected commit");
  const zip = readFileSync(archive);
  const checksum = sha256(zip);
  if (checksum !== checksumRecords[0][1].toLowerCase()) throw Error("Release ZIP SHA-256 mismatch");
  if (digest && checksum !== digest.toLowerCase().replace(/^sha256:/, "")) throw Error("Release asset digest mismatch");

  const names = files.map(file => root + "/" + file);
  const members = readZipMembers(zip, names);
  for (const member of names) if (!members.has(member)) throw Error("Missing ZIP member: " + member);
  const manifest = JSON.parse(members.get(names[0]).toString("utf8"));
  if (manifest.name !== "dsh-purge" || manifest.version !== version) throw Error("Package name or version does not match release");
  for (let i = 0; i < files.length; i++) {
    if (!members.get(names[i]).equals(git(["show", tagged + ":" + files[i]], cwd))) {
      throw Error("ZIP member differs from the tagged source: " + files[i]);
    }
  }
  return { tag, commit: tagged, asset, bytes: zip.length, sha256: checksum, checkedFiles: files,
    signatureVerified: false, runtimeVerified: false };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: {
      tag: { type: "string" }, archive: { type: "string" }, checksums: { type: "string" },
      commit: { type: "string" }, digest: { type: "string" },
    } });
    if (!values.tag || !values.archive || !values.checksums) {
      throw Error("Usage: node scripts/verify-release-artifact.mjs --tag vVERSION --archive ZIP --checksums SHA256SUMS.txt [--commit SHA] [--digest sha256:HEX]");
    }
    process.stdout.write(JSON.stringify(verifyReleaseArtifact(values), null, 2) + "\n");
  } catch (error) {
    process.stderr.write(String(error.message || error).split(/\r?\n/, 1)[0] + "\n");
    process.exitCode = 1;
  }
}
