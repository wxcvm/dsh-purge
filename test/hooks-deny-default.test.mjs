import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HOOK_DENY_PATCH_IDS,
  loadHookDenySettings,
  saveHookDenySettings,
  selectPatches,
} from "../lib/hooks-deny.js";
import { INSERT_BLOCK } from "../lib/profile-insert.js";

function makeHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-hooks-deny-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

test("new installs preserve native hook deny and ask decisions by default", (t) => {
  const settings = loadHookDenySettings(makeHome(t));
  assert.deepEqual(settings, { hooksDenyBypass: false });

  const patches = [...HOOK_DENY_PATCH_IDS.map((id) => ({ id })), { id: 999 }];
  assert.deepEqual(selectPatches(patches, settings), [{ id: 999 }]);
});

test("an explicit plugin config can opt into hook bypass", (t) => {
  assert.deepEqual(loadHookDenySettings(makeHome(t), true), { hooksDenyBypass: true });
});

test("a persisted choice takes precedence over the plugin config default", (t) => {
  const home = makeHome(t);
  saveHookDenySettings(home, { hooksDenyBypass: true });
  assert.deepEqual(loadHookDenySettings(home, false), { hooksDenyBypass: true });

  saveHookDenySettings(home, { hooksDenyBypass: false });
  assert.deepEqual(loadHookDenySettings(home, true), { hooksDenyBypass: false });
});

test("fresh generated and bundled profiles do not opt into hook bypass", () => {
  assert.match(INSERT_BLOCK, /hooksDenyBypass: false/);
  const bundled = fs.readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
  const start = bundled.indexOf("- id: dsh-purge");
  const end = bundled.indexOf("\n- insert:", start + 1);
  assert.ok(start >= 0 && end > start);
  assert.match(bundled.slice(start, end), /hooksDenyBypass:\s*false/);
});
