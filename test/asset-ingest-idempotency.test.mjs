import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'

test('repeated imports refresh service and fingerprint evidence without duplicating source records', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'purge-asset-ingest-'))
  const store = new RedteamStore(home)
  t.after(() => {
    store.close()
    rmSync(home, { recursive: true, force: true })
  })
  const engagement = store.openEngagement('asset-ingest-fixture',
    ['192.0.2.0/24'], { bindCurrent: false }).id
  const asset = {
    ip: '192.0.2.44', state: 'live', provenance: 'passive', tool: 'fixture-a',
    ports: [{
      port: 443, proto: 'tcp', state: 'open', service: 'https',
      product: 'nginx', version: '1.24', cpe: 'cpe:/a:nginx:nginx:1.24',
      fingerprints: [{
        category: 'web', vendor: 'nginx', product: 'nginx', version: '1.24',
        evidence: 'Server header: nginx', confidence: 0.7,
      }],
    }],
  }
  const first = store.importBundle(engagement, {
    scan: { tool: 'fixture-a', argv: [] }, assets: [asset],
  })
  assert.equal(first.counts.services_added, 1)
  assert.equal(first.counts.fingerprints_added, 1)
  assert.equal(first.counts.services_refreshed, 0)
  assert.equal(first.counts.fingerprints_refreshed, 0)

  const db = store.db(engagement)
  const serviceBefore = db.prepare('SELECT * FROM service').get()
  const fingerprintBefore = db.prepare('SELECT * FROM fingerprint').get()
  db.prepare("UPDATE service SET last_seen = '2000-01-01T00:00:00.000Z' WHERE id = ?")
    .run(serviceBefore.id)
  db.prepare("UPDATE fingerprint SET last_seen = '2000-01-01T00:00:00.000Z' WHERE id = ?")
    .run(fingerprintBefore.id)

  const repeated = structuredClone(asset)
  repeated.ports[0].fingerprints[0].confidence = 0.9
  const second = store.importBundle(engagement, {
    scan: { tool: 'fixture-a', argv: [] }, assets: [repeated],
  })
  assert.equal(second.counts.services, 1)
  assert.equal(second.counts.services_added, 0)
  assert.equal(second.counts.services_refreshed, 1)
  assert.equal(second.counts.fingerprints, 1)
  assert.equal(second.counts.fingerprints_added, 0)
  assert.equal(second.counts.fingerprints_refreshed, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service').get().n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fingerprint').get().n, 1)

  const serviceAfter = db.prepare('SELECT * FROM service').get()
  const fingerprintAfter = db.prepare('SELECT * FROM fingerprint').get()
  assert.equal(serviceAfter.first_seen, serviceBefore.first_seen)
  assert.notEqual(serviceAfter.last_seen, '2000-01-01T00:00:00.000Z')
  assert.equal(fingerprintAfter.first_seen, fingerprintBefore.first_seen)
  assert.notEqual(fingerprintAfter.last_seen, '2000-01-01T00:00:00.000Z')
  assert.equal(fingerprintAfter.confidence, 0.9)

  const otherSource = structuredClone(asset)
  otherSource.tool = 'fixture-b'
  const third = store.importBundle(engagement, {
    scan: { tool: 'fixture-b', argv: [] }, assets: [otherSource],
  })
  assert.equal(third.counts.services_added, 1)
  assert.equal(third.counts.fingerprints_added, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service').get().n, 2)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fingerprint').get().n, 2)
})

test('scan run and imported assets roll back together when bundle ingestion fails', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'purge-asset-ingest-rollback-'))
  const store = new RedteamStore(home)
  t.after(() => {
    store.close()
    rmSync(home, { recursive: true, force: true })
  })
  const engagement = store.openEngagement('asset-ingest-rollback',
    ['192.0.2.0/24'], { bindCurrent: false }).id
  const db = store.db(engagement)
  const runsBefore = db.prepare('SELECT COUNT(*) AS n FROM scan_run').get().n
  const assetsBefore = db.prepare('SELECT COUNT(*) AS n FROM asset').get().n
  assert.throws(() => store.importBundle(engagement, {
    scan: { tool: 'rollback-fixture', argv: [] },
    assets: [{ ip: '192.0.2.45', state: 'live', provenance: 'passive', tool: 'rollback-fixture' }],
    edges: [{ src_kind: 'asset', src_id: '1', dst_kind: 'asset', dst_id: '2' }],
  }))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scan_run').get().n, runsBefore)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM asset').get().n, assetsBefore)
})
