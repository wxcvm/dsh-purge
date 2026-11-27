import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const supported = [
  "0.2.2-rc.5",
  "0.2.2-rc.3",
  "0.2.2-rc.1",
  "0.2.1-rc.5",
  "0.2.1-rc.2",
];
const expectedRange = "=0.2.2-rc.5 || =0.2.2-rc.3 || =0.2.2-rc.1 || =0.2.1-rc.5 || =0.2.1-rc.2";

test("DSH compatibility is enforced by engines.dsh, not only informational target fields", () => {
  assert.equal(manifest.dshTarget, "0.2.2-rc.5");
  assert.deepEqual(manifest.dshTargets, supported);
  assert.equal(manifest.engines?.dsh, expectedRange);
});
