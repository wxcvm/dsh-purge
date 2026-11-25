import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchAppliesHere } from '../lib/core.js';
import { ALL_PATCHES } from '../lib/patches-definitions.js';

test('legacy official updater takeover is retired on every surface', () => {
  for (const id of [45, 46]) {
    const patch = ALL_PATCHES.find(p => p.id === id);
    assert.ok(patch, 'retain historical patch definition for diagnosis');
    for (const surface of ['desktop', 'web', 'cli']) {
      assert.equal(patchAppliesHere(patch, surface), false);
    }
  }
});

test('startup settle does not automatically mutate or restart official hosts', () => {
  const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function settleInstalledPatches(');
  const end = source.indexOf('/** 应用之后的那一次重启', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /inspectNativePermissionMigration/);
  assert.match(body, /skip:boot-no-host-write/);
  assert.doesNotMatch(body, /reapplyInstalled|applyPatchesAllHosts|autoUpdateIfNeeded|scheduleRestart|clearStaleExtractedApps|rememberUnpackedArchive|patchAllShims|markPatchesApplied/);
});
