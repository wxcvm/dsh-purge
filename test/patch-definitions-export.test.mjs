import test from 'node:test'
import assert from 'node:assert/strict'
import { ALL_PATCHES, PATCH_DISPLAY_GROUPS } from '../lib/core.js'
import { ALL_PATCHES as SOURCE_PATCHES, PATCH_DISPLAY_GROUPS as SOURCE_GROUPS } from '../lib/patches-definitions.js'

test('core re-exports the exact patch definitions and display groups', () => {
  assert.strictEqual(ALL_PATCHES, SOURCE_PATCHES)
  assert.strictEqual(PATCH_DISPLAY_GROUPS, SOURCE_GROUPS)
  assert.ok(ALL_PATCHES.length > 0)
  const ids = new Set(ALL_PATCHES.map(row => row.id))
  assert.equal(ids.size, ALL_PATCHES.length, 'patch IDs stay unique')
  for (const group of Object.values(PATCH_DISPLAY_GROUPS)) {
    for (const id of group) assert.ok(ids.has(id), `unknown group patch ID: ${id}`)
  }
})
