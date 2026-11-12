import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAdminProbeArgs, parseArgs, checkAdminRoute } from '../scripts/vps-admin-check.mjs'

test('direct management probe keeps existing SSH config independent', () => {
  const args = buildAdminProbeArgs('lab')
  assert.equal(args.includes('-J'), false)
  assert.deepEqual(args.slice(-3), ['--', 'lab', 'true'])
  assert.ok(args.includes('StrictHostKeyChecking=yes'))
  assert.ok(args.includes('ClearAllForwardings=yes'))
})

test('two ordered jump hosts form an explicit administration route', () => {
  const args = buildAdminProbeArgs('lab', ['entry', 'bastion'])
  assert.deepEqual(args.slice(-5), ['-J', 'entry,bastion', '--', 'lab', 'true'])
  assert.deepEqual(parseArgs(['lab', 'entry,bastion']), { target: 'lab', jumps: ['entry', 'bastion'] })
})

test('rejects option injection, malformed aliases and repeated nodes', () => {
  for (const input of ['-oProxyCommand=x', 'host;cmd', 'host user', 'user@host', 'a,b', '']) {
    assert.throws(() => buildAdminProbeArgs(input))
    assert.throws(() => buildAdminProbeArgs('lab', [input]))
  }
  assert.throws(() => buildAdminProbeArgs('lab', ['LAB']))
  assert.throws(() => buildAdminProbeArgs('lab', ['a', 'a']))
  assert.throws(() => buildAdminProbeArgs('lab', ['a','b','c','d','e']))
  assert.throws(() => parseArgs(['lab', 'a,']))
})

test('probe executes only fixed command, reports failure without fallback', async () => {
  const result = await checkAdminRoute('lab', ['entry'], (exe, args, opts, done) => {
    assert.equal(exe, 'ssh')
    assert.deepEqual(args.slice(-3), ['--', 'lab', 'true'])
    assert.equal(opts.timeout, 35000)
    done(Object.assign(new Error('connection failed'), { code: 255 }))
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'ssh-failed')
  assert.deepEqual(result.jumps, ['entry'])
})

test('successful probe returns selected route', async () => {
  const result = await checkAdminRoute('lab', ['entry'], (_exe, _args, _opts, done) => done(null))
  assert.equal(result.ok, true)
  assert.equal(result.error, null)
})
