import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRouting, saveRouting, effectiveRouting, routingPath, routingPage } from "../lib/prompt-routing-settings.js";

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-route-"));
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  return home;
}
test("persisted routing switches survive reload while preserving plugin config defaults", t => {
  const home = fixture(t);
  assert.deepEqual(readRouting(home), {});
  assert.deepEqual(effectiveRouting({ bundledDefault: true }), {
    bundledDefault: true, redteamTaskRoute: false, modelAdaptive: false, upstreamSafeBackup: false,
  });
  saveRouting(home, { modelAdaptive: true, redteamTaskRoute: false });
  saveRouting(home, { bundledDefault: true, redteamTaskRoute: true, upstreamSafeBackup: true });
  assert.deepEqual(readRouting(home), {
    modelAdaptive: true, redteamTaskRoute: true, bundledDefault: true, upstreamSafeBackup: true,
  });
  assert.equal(fs.readdirSync(path.dirname(routingPath(home))).length, 1);
});
test("invalid config cannot silently reset or overwrite existing routing switches", t => {
  const home = fixture(t);
  assert.throws(() => saveRouting(home, { oops: true }), /boolean switches/);
  assert.throws(() => saveRouting(home, { bundledDefault: "true" }), /boolean switches/);
  const file = routingPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"bundledDefault":"bad"}');
  assert.throws(() => readRouting(home), /boolean/);
  assert.throws(() => saveRouting(home, { modelAdaptive: true }), /boolean/);
  assert.equal(fs.readFileSync(file, "utf8"), '{"bundledDefault":"bad"}');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["prompt-routing.json"]);
});
test("local visual settings page exposes independent switches and assembly diagnostic semantics", () => {
  const page = routingPage();
  for (const key of ["bundledDefault", "redteamTaskRoute", "modelAdaptive", "upstreamSafeBackup"]) {
    assert.match(page, new RegExp('id="' + key + '"'));
  }
  assert.match(page, /prompt-routing-settings/);
  assert.match(page, /unverified/);
  assert.match(page, /保存并立即生效/);
});
