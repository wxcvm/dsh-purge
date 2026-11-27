import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore, dispatch } from '../lib/redteam/store-core.js'
import { normalizeDnsName, runScopedDnsLookup, runScopedDnsBatch } from '../lib/redteam/scoped-dns-intel.js'

const host = 'lab.example.test'
const resolver = {
  resolve4: async () => [{ address: '192.0.2.10', ttl: 60 }, { address: '192.0.2.10', ttl: 60 }],
  resolve6: async () => [{ address: '2001:db8::10', ttl: 120 }],
  resolveCname: async () => ['external.example.test.'],
}
test('normalizes hostname and rejects IP, URL and wildcard input', () => {
  assert.equal(normalizeDnsName('LAB.Example.Test.'), host)
  for (const input of ['192.0.2.10', '*.example.test', 'https://lab.example.test', 'a/b.example.test'])
    assert.throws(() => normalizeDnsName(input))
})
test('scope and consent prevent DNS queries before any resolver call', async () => {
  let calls = 0
  const store = { listEngagements: () => [{ id: 'lab', scope: [host] }], activeEngagementId: () => 'lab' }
  const options = { resolver: { resolve4: async () => { calls++; return [] }, resolve6: async () => { calls++; return [] }, resolveCname: async () => { calls++; return [] } } }
  await assert.rejects(runScopedDnsLookup(store, { target: host }, options))
  await assert.rejects(runScopedDnsLookup(store, { target: 'other.example.test', confirmExternal: true }, options))
  assert.equal(calls, 0)
})
test('DNS snapshots persist without adding resolved addresses to asset or port tables', async t => {
  const root = mkdtempSync(join(tmpdir(), 'scoped-dns-'))
  const store = new RedteamStore(root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const { id } = store.openEngagement('lab', [host])
  const req = { engagement: id, target: host, confirmExternal: true }
  const preview = await runScopedDnsLookup(store, req, { resolver })
  assert.equal(preview.records.length, 3)
  assert.equal(preview.imported, null)
  const saved = await runScopedDnsLookup(store, { ...req, commit: true }, { resolver })
  assert.equal(saved.imported.saved, true)
  const repeat = await runScopedDnsLookup(store, { ...req, commit: true }, { resolver })
  assert.equal(repeat.imported.saved, false)
  const history = dispatch(store, { op: 'scopedDnsHistory', engagement: id, target: host })
  assert.equal(history.items.length, 1)
  assert.equal(history.items[0].records.find(r => r.type === 'CNAME').value, 'external.example.test')
  assert.equal(store.db(id).prepare('SELECT COUNT(*) AS n FROM asset').get().n, 0)
  assert.equal(store.db(id).prepare('SELECT COUNT(*) AS n FROM port').get().n, 0)
})
test('partial DNS failure retains successful results', async () => {
  const store = { listEngagements: () => [{ id: 'lab', scope: [host] }], activeEngagementId: () => 'lab' }
  const r = await runScopedDnsLookup(store, { target: host, confirmExternal: true }, { resolver: {
    ...resolver, resolve6: async () => { throw Object.assign(new Error('internal info'), { code: 'ENODATA' }) },
  } })
  assert.equal(r.ok, true)
  assert.deepEqual(r.errors, [{ type: 'AAAA', code: 'ENODATA' }])
  assert.equal(r.records.length, 2)
})


function addSubdomainSnapshot(store, engagement) {
  store.db(engagement).prepare('INSERT INTO subdomain_intel_snapshot(name,value,collected_at) VALUES(?,?,?)')
    .run('example.test', JSON.stringify({ names: [
      { name: 'a.example.test', sources: ['subfinder'] },
      { name: 'b.example.test', sources: ['crt.sh'] },
    ] }), '2026-11-27T00:00:00.000Z')
}

test('dnsx batch resolves only saved in-scope names and stores DNS evidence without creating assets', async t => {
  const root = mkdtempSync(join(tmpdir(), 'scoped-dnsx-batch-'))
  const store = new RedteamStore(root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const { id } = store.openEngagement('lab', ['*.example.test'])
  addSubdomainSnapshot(store, id)
  let calls = 0
  const options = {
    root, interfaces: () => ({}), dnsServers: ['192.0.2.53'],
    resolveTool: toolId => {
      assert.equal(toolId, 'dnsx')
      return { path: '/fixture/dnsx' }
    },
    execFileFn: (path, args, runOptions, done) => {
      calls++
      assert.equal(path, '/fixture/dnsx')
      assert.equal(runOptions.shell, false)
      assert.equal(args[0], '-l')
      assert.ok(args[1].endsWith('hosts.txt'))
      assert.equal(args[2], '-r')
      assert.equal(args[3], '192.0.2.53')
      assert.deepEqual(args.slice(4), [
        '-silent', '-a', '-aaaa', '-cname', '-json', '-rl', '10',
        '-t', '5', '-timeout', '2', '-retry', '1', '-duc', '-auth=false',
      ])
      const input = readFileSync(args[1], 'utf8').trim().split(/\r?\n/)
      assert.deepEqual(input, ['a.example.test', 'b.example.test'])
      done(null, [
        JSON.stringify({ host: 'a.example.test', a: ['192.0.2.10'], aaaa: ['2001:db8::10'],
          cname: ['alias.example.test'], ttl: 60 }),
        JSON.stringify({ host: 'b.example.test', a: ['192.0.2.11'], cname: ['outside.test'], ttl: 30 }),
      ].join('\n') + '\n', '')
    },
  }
  await assert.rejects(runScopedDnsBatch(store, { engagement: id, target: 'example.test' }, options))
  assert.equal(calls, 0)
  const result = await runScopedDnsBatch(store, {
    engagement: id, target: 'example.test', confirmExternal: true, commit: true,
  }, options)
  assert.equal(calls, 1)
  assert.equal(result.ok, true)
  assert.equal(result.status, 'completed')
  assert.equal(result.names, 2)
  assert.equal(result.resolved, 2)
  assert.equal(result.records, 4)
  assert.equal(result.excludedCname, 1)
  assert.equal(result.imported.saved, 2)
  assert.equal(result.toolRun.toolId, 'dnsx')
  assert.equal(result.toolRun.attempted, true)
  assert.equal(result.toolRun.environmentId, 'local')
  assert.equal(store.db(id).prepare('SELECT COUNT(*) AS n FROM dns_intel_snapshot').get().n, 2)
  assert.equal(store.db(id).prepare('SELECT COUNT(*) AS n FROM asset').get().n, 0)
  assert.equal(store.db(id).prepare('SELECT COUNT(*) AS n FROM port').get().n, 0)
})

test('dnsx batch refuses TUN/fake-IP and unsupported environments before execution', async t => {
  const root = mkdtempSync(join(tmpdir(), 'scoped-dnsx-guard-'))
  const store = new RedteamStore(root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const { id } = store.openEngagement('lab', ['*.example.test'])
  addSubdomainSnapshot(store, id)
  let calls = 0
  const base = {
    root, resolveTool: () => ({ path: '/fixture/dnsx' }),
    execFileFn: () => { calls++; throw Error('dnsx must not execute') },
  }
  const tunneled = await runScopedDnsBatch(store, {
    engagement: id, target: 'example.test', confirmExternal: true,
  }, { ...base, interfaces: () => ({ FlClash: [{ address: '198.18.0.1', family: 'IPv4' }] }) })
  assert.equal(tunneled.status, 'tunnel-detected')
  assert.equal(tunneled.attempted, false)
  const remote = await runScopedDnsBatch(store, {
    engagement: id, target: 'example.test', confirmExternal: true, environmentId: 'wsl:Ubuntu-24.04',
  }, { ...base, interfaces: () => ({}) })
  assert.equal(remote.status, 'unsupported-environment')
  assert.equal(remote.attempted, false)
  assert.equal(calls, 0)
})
