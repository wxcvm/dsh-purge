import test from 'node:test'
import assert from 'node:assert/strict'
import { versionLess } from '../lib/redteam/version-compare.js'
import { latestStableVersion, versionIsNewer } from '../lib/update.js'

test('updater compares numeric prerelease components across digit boundaries', () => {
  const prefix = '1.1.92-wxcvm.7-beta.'
  for (const [low, high] of [[9, 10], [99, 100]]) {
    const from = prefix + low, to = prefix + high
    assert.equal(versionIsNewer(to, from), true)
    assert.equal(versionIsNewer(from, to), false)
    assert.equal(versionIsNewer('v' + to, to), false)
  }
  assert.equal(versionIsNewer('1.1.92', prefix + '100'), true)
  assert.equal(versionIsNewer(prefix + '100', '1.1.92'), false)
  assert.equal(latestStableVersion([
    { version: '1.1.92-wxcvm.99', channel: 'stable' },
    { version: '1.1.92-wxcvm.100', channel: 'stable' },
    { version: '1.1.93-beta.1', channel: 'beta' },
  ]), '1.1.92-wxcvm.100')
})

test('fork build revision changes are visible even when the base version stays the same', () => {
  assert.equal(versionLess('1.1.92-wxcvm.1', '1.1.92-wxcvm.2'), true)
  assert.equal(versionLess('v1.1.92-wxcvm.1', 'v1.1.92-wxcvm.2'), true)
  assert.equal(versionLess('1.1.92-wxcvm.2', '1.1.92-wxcvm.1'), false)
  assert.equal(versionLess('1.1.92-wxcvm.9', '1.1.92-wxcvm.10'), true)
  assert.equal(versionLess('1.1.92-wxcvm.10', '1.1.92-wxcvm.9'), false)
  assert.equal(versionLess('1.1.92-wxcvm.10', '1.1.92-wxcvm.10'), false)
  assert.equal(versionLess('1.1.92-wxcvm.2', '1.1.92-wxcvm.2'), false)
  assert.equal(versionLess('1.1.92-wxcvm.2', '1.1.93'), true)
  assert.equal(versionLess('1.1.93', '1.1.92-wxcvm.3'), false)
  assert.equal(versionLess('1.1.92-wxcvm.2', '1.1.92'), true)
  assert.equal(versionLess('1.1.92', '1.1.92-wxcvm.2'), false)
})
