import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import semver from "semver";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const supported = [
  "0.2.3-alpha.2",
  "0.2.2-rc.5",
  "0.2.2-rc.3",
  "0.2.2-rc.1",
  "0.2.1-rc.5",
  "0.2.1-rc.2",
];
const expectedRange = supported.map(version => "=" + version).join(" || ");

test("DSH compatibility is enforced by engines.dsh, not only informational target fields", () => {
  assert.equal(manifest.dshTarget, "0.2.2-rc.5");
  assert.deepEqual(manifest.dshTargets, supported);
  assert.equal(manifest.engines?.dsh, expectedRange);
  assert.equal(manifest.engines.node, ">=18", "standalone plugin Node compatibility is unchanged");
  assert.ok(semver.satisfies("4.1.0", manifest.peerDependencies["@deepseek-ai/cordis"]));
  assert.ok(semver.satisfies("4.2.0-alpha.1", manifest.peerDependencies["@deepseek-ai/cordis"]));
  assert.equal(semver.satisfies("4.2.0-alpha.2", manifest.peerDependencies["@deepseek-ai/cordis"]), false);
  assert.equal(semver.satisfies("0.2.3-alpha.1", manifest.engines.dsh), false);
});
