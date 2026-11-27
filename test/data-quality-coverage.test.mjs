/**
 * 数据质量的两个新计数（旧实现看不见的两类交付缺件）：
 *   · unlinkedHttpEvidence      —— 证据在，但没挂到任何漏洞，报告里对不上结论；
 *   · confirmedWithoutHttpEvidence —— 漏洞已确认，却一条原始请求都没有，不可复现。
 * 旧实现只数"悬空外键"，因此这两种情况会一路绿灯。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RedteamStore } from '../lib/redteam/store-core.js'

function storeInTemp(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dq-'))
  const store = new RedteamStore(root)
  t.after(() => {
    try { store.close() } catch { /* 已关闭 */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })
  return store
}

test('孤儿证据与"确认但无原始请求"都会让质量检查亮灯', t => {
  const store = storeInTemp(t)
  const { id } = store.openEngagement('QualityFixture', [])
  store.addVuln(id, { title: 'confirmed 但没有原始请求', severity: 'high', status: 'confirmed', evidence: '只有一句结论' })
  store.addHttpEvidence(id, { label: '没挂漏洞的证据', method: 'GET', url: 'http://192.0.2.1/a', request: 'GET /a', response: '200' })

  const report = store.dataQuality(id)
  assert.equal(report.counts.confirmedWithoutHttpEvidence, 1)
  assert.equal(report.counts.unlinkedHttpEvidence, 1)
  assert.equal(report.status, 'attention')
  assert.ok(report.issues.some((item) => item.code === 'confirmedWithoutHttpEvidence'))
  assert.ok(report.issues.some((item) => item.code === 'unlinkedHttpEvidence'))
})

test('资产质量预览识别同来源重复服务/指纹和孤儿记录，但绝不修改数据', t => {
  const store = storeInTemp(t)
  const { id } = store.openEngagement('AssetDedupPreview', ['192.0.2.0/24'])
  store.importBundle(id, {
    scan: { tool: 'fixture-a', argv: [] },
    assets: [{
      ip: '192.0.2.77', state: 'live', provenance: 'passive', tool: 'fixture-a',
      ports: [{
        port: 443, proto: 'tcp', state: 'open', service: 'https',
        product: 'nginx', version: '1.24', cpe: 'cpe:/a:nginx:nginx:1.24',
        fingerprints: [{
          category: 'web', vendor: 'nginx', product: 'nginx', version: '1.24',
          evidence: 'private-fixture-evidence-marker', confidence: 0.7,
          provenance: 'passive', tool: 'fixture-a',
        }],
      }],
    }],
  })
  const db = store.db(id)
  const port = db.prepare('SELECT * FROM port').get()
  const service = db.prepare('SELECT * FROM service').get()
  const fingerprint = db.prepare('SELECT * FROM fingerprint').get()
  db.prepare(`INSERT INTO service(port_id, name, product, version, cpe, provenance, tool, first_seen, last_seen)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(port.id, service.name, service.product, service.version,
      service.cpe, service.provenance, service.tool, service.first_seen, service.last_seen)
  db.prepare(`INSERT INTO fingerprint(asset_id, port_id, category, vendor, product, version, evidence,
    confidence, provenance, tool, first_seen, last_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(fingerprint.asset_id, fingerprint.port_id, fingerprint.category, fingerprint.vendor,
      fingerprint.product, fingerprint.version, fingerprint.evidence, 0.9, fingerprint.provenance,
      fingerprint.tool, fingerprint.first_seen, fingerprint.last_seen)
  db.prepare(`INSERT INTO port(asset_id, proto, port, state) VALUES(999999, 'tcp', 8080, 'open')`).run()
  db.prepare(`INSERT INTO service(port_id, name, product) VALUES(999999, 'orphan-service', 'orphan')`).run()
  db.prepare(`INSERT INTO fingerprint(asset_id, port_id, category, product)
    VALUES(999999, 999999, 'orphan', 'orphan')`).run()
  db.prepare(`INSERT INTO asset_name(asset_id, name, kind) VALUES(999999, 'orphan.example.test', 'domain')`).run()

  const before = {
    assets: db.prepare('SELECT COUNT(*) AS n FROM asset').get().n,
    ports: db.prepare('SELECT COUNT(*) AS n FROM port').get().n,
    services: db.prepare('SELECT COUNT(*) AS n FROM service').get().n,
    fingerprints: db.prepare('SELECT COUNT(*) AS n FROM fingerprint').get().n,
    names: db.prepare('SELECT COUNT(*) AS n FROM asset_name').get().n,
  }
  const report = store.dataQuality(id)
  assert.equal(report.counts.duplicateServiceGroups, 1)
  assert.equal(report.counts.duplicateServiceRows, 1)
  assert.equal(report.counts.duplicateFingerprintGroups, 1)
  assert.equal(report.counts.duplicateFingerprintRows, 1)
  assert.equal(report.counts.orphanPorts, 1)
  assert.equal(report.counts.orphanServices, 1)
  assert.equal(report.counts.orphanFingerprints, 1)
  assert.equal(report.counts.orphanAssetNames, 1)
  assert.equal(report.preview.duplicateServices[0].record_count, 2)
  assert.equal(report.preview.duplicateServices[0].excess_rows, 1)
  assert.equal(report.preview.duplicateServices[0].canonical_candidate_id, service.id)
  assert.equal(report.preview.duplicateFingerprints[0].strongest_confidence, 0.9)
  assert.equal(report.preview.orphanRecords.ports.length, 1)
  assert.equal(report.preview.orphanRecords.services.length, 1)
  assert.equal(report.preview.orphanRecords.fingerprints.length, 1)
  assert.equal(report.preview.orphanRecords.assetNames.length, 1)
  assert.deepEqual(report.mutation, { performed: false, cleanupAvailable: false })
  assert.equal(JSON.stringify(report).includes('private-fixture-evidence-marker'), false)
  assert.deepEqual({
    assets: db.prepare('SELECT COUNT(*) AS n FROM asset').get().n,
    ports: db.prepare('SELECT COUNT(*) AS n FROM port').get().n,
    services: db.prepare('SELECT COUNT(*) AS n FROM service').get().n,
    fingerprints: db.prepare('SELECT COUNT(*) AS n FROM fingerprint').get().n,
    names: db.prepare('SELECT COUNT(*) AS n FROM asset_name').get().n,
  }, before)
})

test('把证据挂回漏洞后计数归零、重新变绿', t => {
  const store = storeInTemp(t)
  const { id } = store.openEngagement('QualityFixed', [])
  const vuln = store.addVuln(id, { title: '补过证据的漏洞', severity: 'high', status: 'confirmed', evidence: '结论' })
  const evidence = store.addHttpEvidence(id, {
    vuln_id: vuln.id, label: '原始请求', method: 'GET', url: 'http://192.0.2.1/b',
    request: 'GET /b HTTP/1.1', response: 'HTTP/1.1 200 OK',
  })
  assert.ok(evidence.id > 0)

  const report = store.dataQuality(id)
  assert.equal(report.counts.confirmedWithoutHttpEvidence, 0)
  assert.equal(report.counts.unlinkedHttpEvidence, 0)
  assert.equal(report.status, 'no_issues_detected')
  assert.equal(report.validatesFindings, false)
  assert.equal(report.scope, 'stored-record-metadata')
})

test('an empty workspace has no metadata issues but does not validate findings', t => {
  const store = storeInTemp(t)
  const { id } = store.openEngagement('QualityEmpty', [])
  const report = store.dataQuality(id)
  assert.equal(report.status, 'no_issues_detected')
  assert.equal(report.validatesFindings, false)
  assert.equal(report.scope, 'stored-record-metadata')
  assert.equal(report.totals.vulnerabilities, 0)
  assert.deepEqual(report.issues, [])
  assert.deepEqual(report.preview, { duplicateServices: [], duplicateFingerprints: [], orphanRecords: { ports: [], services: [], fingerprints: [], assetNames: [] } })
  assert.deepEqual(report.mutation, { performed: false, cleanupAvailable: false })
})
