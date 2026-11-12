import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore, dispatch } from '../lib/redteam/store-core.js'
import { normalizeDnsName, runScopedDnsLookup } from '../lib/redteam/scoped-dns-intel.js'

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
