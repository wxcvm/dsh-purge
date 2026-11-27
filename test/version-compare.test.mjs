import test from 'node:test'
import assert from 'node:assert/strict'
import { versionLess } from '../lib/redteam/version-compare.js'
import { hideListedVersion, latestStableVersion, safeUpdateRef, versionIsNewer } from '../lib/update.js'

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

test('build metadata does not hide stable tags or make valid tags unselectable', () => {
  const tag = 'v1.1.92-wxcvm.24+build-beta.1'
  const row = { ref: tag, id: tag, version: tag.slice(1), channel: 'stable' }
  assert.equal(hideListedVersion(row), false)
  assert.equal(latestStableVersion([row]), row.version)
  assert.equal(safeUpdateRef(tag), tag)
  assert.equal(safeUpdateRef('v1.1.92+build.2'), 'v1.1.92+build.2')
  assert.equal(hideListedVersion({ ref: 'v1.1.92-beta.1+build.2', channel: 'beta' }), true)
  for (const value of ['master+build.1', 'v1.1.92+', 'v1.1.92+build..1', 'v1.1.92+build/other', 'v1.1.92+build%2fother', 'v1.1.92+build 1']) {
    assert.equal(safeUpdateRef(value), '')
  }
})
