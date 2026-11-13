import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAdminProbeArgs, parseArgs, checkAdminRoute, readSavedAdminRoute } from '../scripts/vps-admin-check.mjs'

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
  assert.deepEqual(result.evidence, { scope: 'ssh_management', command: 'true', status: 'verified', application: 'not_tested', udp: 'not_tested', egress: 'not_tested' })
})

test('saved mode reads only validated management preferences, preserving hop order', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-admin-check-'))
  try {
    assert.throws(() => readSavedAdminRoute(root), /No saved Purge configuration/)
    writeFileSync(join(root, 'config.json'), JSON.stringify({
      vps: { ipv4: '192.0.2.10' }, env: { REDTEAM_VPS_KEY: 'not-returned' },
      vpsAdminRoute: { target: ' lab ', jumps: [' entry ', 'bastion'] },
    }))
    const route = parseArgs(['--saved'], () => readSavedAdminRoute(root))
    assert.deepEqual(route, { target: 'lab', jumps: ['entry', 'bastion'] })
    assert.throws(() => parseArgs(['--saved', 'entry']))
    for (const invalid of [
      { target: '', jumps: [] }, { target: 'lab', jumps: ['LAB'] },
      { target: 'lab', jumps: 'entry' }, { target: 'lab', jumps: [123] },
    ]) {
      writeFileSync(join(root, 'config.json'), JSON.stringify({ vpsAdminRoute: invalid }))
      assert.throws(() => readSavedAdminRoute(root))
    }
    writeFileSync(join(root, 'config.json'), '{bad json')
    assert.throws(() => readSavedAdminRoute(root), /Cannot read saved Purge configuration/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
