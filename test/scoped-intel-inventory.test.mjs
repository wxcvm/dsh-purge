import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore, dispatch } from '../lib/redteam/store-core.js'
import { buildScopedIntelInventory } from '../lib/redteam/scoped-intel-inventory.js'

test('offline inventory joins scoped names and IP evidence without mutating facts', t => {
  const root = mkdtempSync(join(tmpdir(), 'intel-inventory-'))
  const store = new RedteamStore(root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const domain = 'example.test', ip = '192.0.2.10', outside = '198.51.100.10'
  const { id } = store.openEngagement('lab', ['*.example.test', ip])
  const db = store.db(id)
  const snapshot = (table, name, data) => db.prepare('INSERT INTO ' + table + '(name,value,collected_at) VALUES(?,?,?)')
    .run(name, JSON.stringify(data), '2026-01-01')
  snapshot('ct_intel_snapshot', domain, { names: [{ name: 'a.example.test' }, { name: 'outside.test' }] })
  snapshot('subdomain_intel_snapshot', domain, { names: [{ name: 'a.example.test', sources: ['crt.sh','subfinder'] }] })
  snapshot('dns_intel_snapshot', 'a.example.test', { records: [{ type: 'A', value: ip, ttl: 60 }, { type: 'A', value: outside }, { type: 'CNAME', value: 'other.test' }] })
  snapshot('dns_intel_snapshot', 'b.example.test', { records: [{ type: 'A', value: ip }] })
  store.savePassiveIntel(id, ip, [{ ip, source: 'internetdb', ports: [{ port: 443, proto: 'unknown' }] },
    { ip, source: 'shodan', ports: [{ port: 443, proto: 'tcp' }] }])
  const before = store.stats(id)
  const result = dispatch(store, { op: 'scopedIntelInventory', engagement: id, target: domain })
  assert.equal(result.ok, true)
  assert.equal(result.schema, 'purge.asset-intel.v1')
  assert.deepEqual(result.names.map(n => n.name), ['a.example.test','b.example.test'])
  assert.deepEqual(result.names[0].evidence.map(e => e.source), ['crt.sh','subfinder','dns'])
  assert.equal(result.edges.length, 2)
  assert.equal(result.ips.length, 1)
  assert.equal(result.ips[0].passive_ports.length, 2)
  assert.equal(result.excluded.dns_outside_scope, 2)
  assert.equal(JSON.stringify(result).includes(outside), false)
  assert.equal(JSON.stringify(result).includes('other.test'), false)
  assert.deepEqual(store.stats(id), before)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM port').get().n, 0)
  assert.throws(() => buildScopedIntelInventory(store, { engagement: id, target: 'outside.test' }))
})

test('exact hostname scope does not enumerate descendants or include unregistered IP', t => {
  const root = mkdtempSync(join(tmpdir(), 'intel-exact-'))
  const store = new RedteamStore(root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const { id } = store.openEngagement('exact', ['example.test'])
  store.db(id).prepare('INSERT INTO dns_intel_snapshot(name,value,collected_at) VALUES(?,?,?)')
    .run('example.test', JSON.stringify({ records: [{ type: 'A', value: '192.0.2.1' }] }), '2026-01-01')
  const r = buildScopedIntelInventory(store, { engagement: id, target: 'example.test' })
  assert.deepEqual(r.names.map(n => n.name), ['example.test'])
  assert.equal(r.ips.length, 0)
  assert.equal(r.excluded.dns_outside_scope, 1)
})
