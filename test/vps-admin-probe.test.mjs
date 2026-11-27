import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authorizeAdminProbe, probeSavedAdminRoute } from '../lib/redteam/vps-admin-probe.js'

const env = { DSH_PURGE_LOCAL_SSH_CHECK: '1', DSH_PURGE_BRIDGE_TOKEN: 'test-token' }
const request = (options = {}) => ({
  headers: { host: 'localhost:1234', 'x-dsh-purge-token': 'test-token', ...options.headers },
  socket: {
    remoteAddress: options.remote || '127.0.0.1',
    server: { address: () => ({ address: options.bound || '127.0.0.1', port: 1234 }) },
  },
})

test('local SSH bridge is opt-in, bound to loopback and authenticated', () => {
  assert.equal(authorizeAdminProbe(request(), env).ok, true)
  assert.equal(authorizeAdminProbe(request(), {}).status, 403)
  assert.equal(authorizeAdminProbe(request(), { DSH_PURGE_LOCAL_SSH_CHECK: '1' }).status, 403)
  assert.equal(authorizeAdminProbe(request({ headers: { 'x-dsh-purge-token': '' } }), env).status, 401)
  assert.equal(authorizeAdminProbe(request({ headers: { 'x-dsh-purge-token': 'wrong' } }), env).status, 401)
  for (const req of [
    request({ remote: '192.0.2.10' }),
    request({ bound: '0.0.0.0' }),
    request({ bound: '::' }),
    request({ headers: { host: 'example.com' } }),
    request({ headers: { 'x-forwarded-for': '192.0.2.10' } }),
    request({ headers: { 'x-forwarded-host': 'example.com' } }),
    request({ headers: { 'x-real-ip': '192.0.2.10' } }),
    { headers: request().headers, socket: { remoteAddress: '127.0.0.1' } },
  ]) assert.equal(authorizeAdminProbe(req, env).status, 403)
})

test('probe reads saved route only and prevents overlapping checks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-local-admin-'))
  try {
    assert.equal((await probeSavedAdminRoute(root)).ok, false)
    writeFileSync(join(root, 'config.json'), JSON.stringify({ vpsAdminRoute: { target: 'lab', jumps: ['entry'] } }))
    let finish
    const pending = probeSavedAdminRoute(root, { runner: (exe, args, _opts, done) => {
      assert.equal(exe, 'ssh')
      assert.deepEqual(args.slice(-5), ['-J', 'entry', '--', 'lab', 'true'])
      finish = done
    } })
    assert.equal((await probeSavedAdminRoute(root)).ok, false)
    finish(null)
    const result = await pending
    assert.equal(result.ok, true)
    assert.equal(result.target, 'lab')
    assert.ok(result.checkedAt)
    const failed = await probeSavedAdminRoute(root, { runner: (_exe, _args, _opts, done) => done(new Error('failed')) })
    assert.equal(failed.ok, false)
    assert.equal(failed.error, 'ssh-failed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
