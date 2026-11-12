import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeAdminRoute, validateAdminRoute } from '../lib/redteam/vps-admin-config.js'
import { loadPlatformConfig, savePlatformConfig } from '../lib/redteam/platform-config.js'

test('empty route is optional and normalization preserves ordered aliases', () => {
  assert.deepEqual(normalizeAdminRoute(), { target: '', jumps: [] })
  assert.equal(validateAdminRoute({ target: '', jumps: [] }), null)
  assert.deepEqual(normalizeAdminRoute({ target: ' lab ', jumps: [' entry ', 'bastion'] }),
    { target: 'lab', jumps: ['entry', 'bastion'] })
  assert.equal(validateAdminRoute({ target: 'lab', jumps: ['entry', 'bastion'] }), null)
})

test('invalid, incomplete and duplicate routes cannot be saved', () => {
  for (const input of [
    null, [], { target: 'lab', jumps: 'entry' }, { target: '', jumps: ['entry'] },
    { target: 'lab', jumps: [''] }, { target: 'lab', jumps: ['LAB'] },
    { target: 'lab', jumps: ['a','b','c','d','e'] },
    { target: '-oProxyCommand=x', jumps: [] }, { target: 'lab', jumps: [1] },
  ]) assert.ok(validateAdminRoute(input))
})

test('saved management route is independent from existing VPS and partial updates', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-admin-route-'))
  try {
    const before = savePlatformConfig({ vps: { user: 'ubuntu', ipv4: '192.0.2.10', identityFile: '/keys/vps' } }, root)
    assert.deepEqual(before.vpsAdminRoute, { target: '', jumps: [] })
    const route = { target: 'lab', jumps: ['entry', 'bastion'] }
    const after = savePlatformConfig({ vpsAdminRoute: route }, root)
    assert.deepEqual(after.vps, before.vps)
    assert.deepEqual(after.env, before.env)
    assert.deepEqual(after.vpsAdminRoute, route)
    savePlatformConfig({ notes: 'unrelated change' }, root)
    assert.deepEqual(loadPlatformConfig(root).vpsAdminRoute, route)
    assert.throws(() => savePlatformConfig({ vpsAdminRoute: { target: 'lab', jumps: ['lab'] } }, root))
    assert.deepEqual(loadPlatformConfig(root).vpsAdminRoute, route)
    savePlatformConfig({ vpsAdminRoute: { target: '', jumps: [] } }, root)
    assert.deepEqual(loadPlatformConfig(root).vpsAdminRoute, { target: '', jumps: [] })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
