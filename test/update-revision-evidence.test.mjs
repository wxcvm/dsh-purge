import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describeLane, markCurrent } from "../lib/update.js";

const version = "1.1.92-wxcvm.18";
const old = "0bd3a58ba1981c61193e898a2d1ba4f3517d7f5d";
const head = "d3159ed1acd4bcae7e1aff4f6a836bd556af97e5";
const stable = { channel: "stable" };
const rows = [
  { ref: "master", kind: "head", version, sha: head, channel: "stable", latest: true },
  { ref: "v" + version, kind: "tag", version, sha: old, channel: "stable" },
];
const client = readFileSync(new URL("../client.js", import.meta.url), "utf8");
function clientFunction(name, next) {
  const from = client.indexOf("\t\tfunction " + name + "(");
  const to = client.indexOf("\t\tfunction " + next + "(", from);
  assert.ok(from >= 0 && to > from);
  return runInNewContext("(" + client.slice(from, to).trim() + ")");
}
const notice = clientFunction("updateCheckNotice", "versionChoiceLabel");
const label = clientFunction("versionChoiceLabel", "SkillsSection");
const tr = (key, vars) => vars ? key + JSON.stringify(vars) : key;
function fixture(rev, remoteVersion = version, state = stable) {
  const versions = markCurrent([{ ...rows[0], version: remoteVersion }, rows[1]], state, version, rev);
  const lane = describeLane("stable", { versions, stableSha: head }, state, version, rev);
  return { versions, lane, info: { ...state, lanes: { stable: lane }, pinned: Boolean(state.pin), hasUpdate: lane.hasUpdate,
    localVersion: version, remoteVersion, localSha: rev.slice(0, 7), remoteSha: head.slice(0, 7) } };
}

test("installed published tag and later master at the same version are not the same recorded build", () => {
  const { versions, lane, info } = fixture(old);
  assert.equal(lane.revisionStatus, "differs");
  assert.equal(lane.hasUpdate, false, "same-version polling must not schedule an install or restart");
  assert.equal(versions.find(row => row.current).ref, "v" + version);
  assert.equal(label(versions[0], tr), "v" + version + " · d3159ed · update.tip");
  assert.equal(label(versions[1], tr), "v" + version + " · 0bd3a58 · update.current");
  assert.match(notice(info, tr), /^update\.revisionsDiffer.*0bd3a58.*d3159ed/);
});

test("valid matching records are distinct from missing, stale, dubious, and legacy evidence", () => {
  const same = fixture(head.slice(0, 7).toUpperCase());
  assert.equal(same.lane.revisionStatus, "matches");
  assert.match(notice(same.info, tr), /^update\.revisionsMatch/);
  assert.match(label(same.versions[0], tr), /update\.current$/);
  for (const rev of ["", "d31", "not-a-commit"]) {
    const { lane, info, versions } = fixture(rev);
    assert.equal(lane.revisionStatus, "unknown");
    assert.match(notice(info, tr), /^update\.revisionsUnknown/);
    assert.doesNotMatch(label(versions[0], tr), /update\.current/);
  }
  assert.match(notice({ localVersion: version, remoteVersion: version }, tr), /^update\.revisionsUnknown/);
});

test("version updates, ahead-of-channel installs, and pinned notices keep their distinct meanings", () => {
  const higher = fixture(old, "1.1.92-wxcvm.19");
  assert.equal(higher.lane.hasUpdate, true);
  assert.match(notice(higher.info, tr), /^update\.available/);
  const lower = fixture(old, "1.1.92-wxcvm.17");
  assert.equal(lower.lane.hasUpdate, false);
  assert.match(notice(lower.info, tr), /^update\.noHigherVersion/);
  const pinned = fixture(old, version, { channel: "stable", pin: "v" + version });
  assert.equal(pinned.lane.hasUpdate, true, "keep existing explicit pinned-channel behavior");
  assert.match(notice(pinned.info, tr), /^update\.pinned/);
});
