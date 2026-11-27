import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatch, RedteamStore } from '../lib/redteam/store-core.js'

test('asset freshness separates recency, provenance and stored test status', t => {
  const home = mkdtempSync(join(tmpdir(), 'purge-asset-freshness-'))
  const store = new RedteamStore(home)
  t.after(() => {
    store.close()
    rmSync(home, { recursive: true, force: true })
  })
  const { id } = store.openEngagement('asset-freshness-fixture', [], { bindCurrent: false })
  store.importBundle(id, {
    scan: { tool: 'freshness-fixture', argv: [] },
    assets: [
      {
        ip: '192.0.2.31', state: 'live', provenance: 'active', tool: 'nmap',
        primary_name: 'fresh.example.test',
        names: [{ name: 'fresh.example.test', kind: 'domain', provenance: 'passive', tool: 'ct' }],
        ports: [{ port: 443, proto: 'tcp', state: 'open', service: 'https',
          product: 'nginx', provenance: 'active', tool: 'nmap' }],
      },
      {
        ip: '192.0.2.32', state: 'unknown', provenance: 'passive', tool: 'ct',
        primary_name: 'stale.example.test',
      },
      {
        ip: '192.0.2.33', state: 'unknown', provenance: 'passive', tool: 'ct',
      },
      {
        ip: '192.0.2.34', state: 'unknown', provenance: 'passive', tool: 'ct',
        primary_name: 'aging.example.test',
      },
      {
        ip: '192.0.2.35', state: 'unknown', provenance: 'passive', tool: 'ct',
      },
    ],
  })
  const db = store.db(id)
  const stale = db.prepare("SELECT id FROM asset WHERE ip = '192.0.2.32'").get()
  const unknown = db.prepare("SELECT id FROM asset WHERE ip = '192.0.2.33'").get()
  const aging = db.prepare("SELECT id FROM asset WHERE ip = '192.0.2.34'").get()
  const invalid = db.prepare("SELECT id FROM asset WHERE ip = '192.0.2.35'").get()
  const staleAt = new Date(Date.now() - 45 * 86400000).toISOString()
  const agingAt = new Date(Date.now() - 10 * 86400000).toISOString()
  db.prepare('UPDATE asset SET last_seen = ? WHERE id = ?').run(staleAt, stale.id)
  db.prepare("UPDATE observation SET collected_at = ? WHERE entity_kind = 'asset' AND entity_id = ?")
    .run(staleAt, stale.id)
  db.prepare('UPDATE asset SET last_seen = ? WHERE id = ?').run(agingAt, aging.id)
  db.prepare("UPDATE observation SET collected_at = ? WHERE entity_kind = 'asset' AND entity_id = ?")
    .run(agingAt, aging.id)
  db.prepare('UPDATE asset SET last_seen = NULL WHERE id = ?').run(unknown.id)
  db.prepare('UPDATE asset SET last_seen = ? WHERE id = ?').run('not-a-timestamp', invalid.id)
  db.prepare("UPDATE asset SET test_status = 'tested' WHERE ip = '192.0.2.31'").run()

  const report = store.assetFreshness(id, { limit: 2, offset: 0 })
  const byIp = Object.fromEntries(report.items.map(item => [item.ip, item]))
  assert.equal(report.total, 5)
  assert.equal(report.summary.total, 5)
  assert.deepEqual(report.summary.freshness, { fresh: 1, aging: 1, stale: 1, unknown: 2 })
  assert.equal(byIp['192.0.2.31'].freshness, 'fresh')
  assert.equal(byIp['192.0.2.31'].source, 'mixed')
  assert.equal(byIp['192.0.2.31'].verification_status, 'tested')
  assert.equal(byIp['192.0.2.32'], undefined)
  const all = store.assetFreshness(id, { limit: 20 }).items
  const allByIp = Object.fromEntries(all.map(item => [item.ip, item]))
  assert.equal(allByIp['192.0.2.32'].freshness, 'stale')
  assert.equal(allByIp['192.0.2.32'].source, 'passive')
  assert.equal(allByIp['192.0.2.33'].freshness, 'unknown')
  assert.equal(allByIp['192.0.2.33'].source, 'unknown')
  assert.equal(allByIp['192.0.2.35'].freshness, 'unknown')
  assert.equal(allByIp['192.0.2.35'].timestamp_anomaly, 'invalid_timestamp')
  assert.equal(allByIp['192.0.2.34'].freshness, 'aging')
  assert.equal(report.semantics.verification.includes('不代表资产此刻仍在线'), true)
  const api = dispatch(store, { op: 'assetFreshness', engagement: id, limit: 1 })
  assert.equal(api.ok, true)
  assert.equal(api.total, 5)
  assert.equal(api.items.length, 1)
  const staleOnly = store.assetFreshness(id, { freshness: 'stale', limit: 20 })
  assert.equal(staleOnly.total, 1)
  assert.equal(staleOnly.all_total, 5)
  assert.equal(staleOnly.items[0].ip, '192.0.2.32')
  const passiveOnly = store.assetFreshness(id, { source: 'passive', limit: 20 })
  assert.equal(passiveOnly.total, 3)
  assert.equal(passiveOnly.summary.total, 5)
  const testedOnly = store.assetFreshness(id, { verification_status: 'tested', limit: 20 })
  assert.equal(testedOnly.total, 1)
  assert.equal(testedOnly.items[0].ip, '192.0.2.31')
  const filteredApi = dispatch(store, { op: 'assetFreshness', engagement: id, freshness: 'aging', limit: 20 })
  assert.equal(filteredApi.total, 1)
  assert.equal(filteredApi.items[0].ip, '192.0.2.34')
})
