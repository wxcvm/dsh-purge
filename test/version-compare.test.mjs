import test from 'node:test'
import assert from 'node:assert/strict'
import { versionLess } from '../lib/redteam/version-compare.js'
import { versionIsNewer } from '../lib/update.js'

test('fork build revision changes are visible even when the base version stays the same', () => {
  assert.equal(versionLess('1.1.92-wxcvm.1', '1.1.92-wxcvm.2'), true)
  assert.equal(versionLess('v1.1.92-wxcvm.1', 'v1.1.92-wxcvm.2'), true)
  assert.equal(versionLess('1.1.92-wxcvm.2', '1.1.92-wxcvm.1'), false)
  assert.equal(versionLess('1.1.92-wxcvm.2', '1.1.92-wxcvm.2'), false)
  assert.equal(versionLess('1.1.92-wxcvm.2', '1.1.93'), true)
  assert.equal(versionLess('1.1.93', '1.1.92-wxcvm.3'), false)
  assert.equal(versionLess('1.1.92-wxcvm.2', '1.1.92'), true)
  assert.equal(versionLess('1.1.92', '1.1.92-wxcvm.2'), false)
})

test('update notification compares numeric prerelease identifiers instead of lexicographic strings', () => {
  for (const [newer, older] of [
    ['1.1.92-wxcvm.7-beta.10', '1.1.92-wxcvm.7-beta.9'],
    ['1.1.92-wxcvm.7-beta.11', '1.1.92-wxcvm.7-beta.10'],
    ['1.1.92-wxcvm.7-beta.100', '1.1.92-wxcvm.7-beta.99'],
    ['1.1.92-wxcvm.10', '1.1.92-wxcvm.9'],
    ['1.1.92', '1.1.92-wxcvm.7-beta.11'],
    ['1.1.93', '1.1.92'],
  ]) {
    assert.equal(versionIsNewer(newer, older), true, newer + ' > ' + older)
    assert.equal(versionIsNewer(older, newer), false)
    assert.equal(versionIsNewer(newer, newer), false)
  }
  assert.equal(versionIsNewer('v1.1.92-wxcvm.7-beta.11', '1.1.92-wxcvm.7-beta.11'), false)
})
