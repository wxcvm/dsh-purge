import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'

test('host findings reuse asset observations, validate same-asset evidence and never mark completion', t => {
  const home = mkdtempSync(join(tmpdir(), 'purge-linked-host-findings-'))
  let store = new RedteamStore(home)
  t.after(() => { store.close(); rmSync(home, { recursive: true, force: true }) })
  const engagement = store.openEngagement('host-findings-fixture', ['10.42.0.0/24'], { bindCurrent: false }).id
  const other = store.openEngagement('host-findings-other', ['10.52.0.0/24'], { bindCurrent: false }).id
  store.importBundle(engagement, { scan: { tool: 'fixture', argv: [] }, assets: [
    { ip: '10.42.0.5', provenance: 'passive', tool: 'fixture', state: 'live' },
    { ip: '10.42.0.6', provenance: 'passive', tool: 'fixture', state: 'live' },
  ] })
  store.importBundle(other, { scan: { tool: 'fixture', argv: [] }, assets: [
    { ip: '10.52.0.5', provenance: 'passive', tool: 'fixture', state: 'live' },
  ] })
  const id = store.listAssets(engagement, { ip: '10.42.0.5' }).items[0].id
  const otherId = store.listAssets(engagement, { ip: '10.42.0.6' }).items[0].id
  const db = store.db(engagement)
  const ownEvidence = Number(db.prepare('INSERT INTO http_evidence(asset_id, label) VALUES (?, ?)')
    .run(id, 'Sanitized HTTP fixture').lastInsertRowid)
  const otherEvidence = Number(db.prepare('INSERT INTO http_evidence(asset_id, label) VALUES (?, ?)')
    .run(otherId, 'Different asset').lastInsertRowid)
  const vulnId = Number(db.prepare('INSERT INTO vuln(asset_id, title, status) VALUES (?,?,?)')
    .run(id, 'Example candidate', 'candidate').lastInsertRowid)
  const linkedByVuln = Number(db.prepare('INSERT INTO http_evidence(vuln_id,label) VALUES (?,?)')
    .run(vulnId, 'Link through vuln asset id').lastInsertRowid)
  const accessId = Number(db.prepare('INSERT INTO access_session(asset_id,host) VALUES (?,?)')
    .run(id, '10.42.0.5').lastInsertRowid)
  const stepsId = Number(db.prepare('INSERT INTO attack_step(asset_id,title) VALUES (?,?)')
    .run(id, 'Synthetic chain').lastInsertRowid)
  assert.equal(store.listHostFindings(engagement, id).total, 0)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM observation WHERE attr = 'host_finding'").get().n, 0)
  const first = store.recordHostFinding(engagement, { asset_id: id, kind: 'web',
    title: 'Sanitized response', detail: 'Only review metadata',
    evidence_kind: 'http_evidence', evidence_id: ownEvidence, recorded_by: 'assess' })
  assert.equal(first.evidence_linked, true)
  assert.equal(first.evidence_ref, 'http_evidence:' + ownEvidence)
  const second = store.recordHostFinding(engagement, { asset_id: id, kind: 'config',
    title: 'Manual config observation', recorded_by: 'assess' })
  assert.equal(second.evidence_linked, false)
  const third = store.recordHostFinding(engagement, { asset_id: id, kind: 'share',
    title: 'Related HTTP response', evidence_kind: 'http_evidence', evidence_id: linkedByVuln })
  assert.equal(third.evidence_linked, true)
  for (const [kind, evidenceId] of [['vuln', vulnId], ['access_session', accessId],
    ['attack_step', stepsId]]) {
    assert.equal(store.recordHostFinding(engagement, { asset_id: id, kind: 'file',
      title: 'Reference ' + kind, evidence_kind: kind, evidence_id: evidenceId }).evidence_linked, true)
  }
  const list = store.listHostFindings(engagement, id, { limit: 2 })
  assert.equal(list.total, 6)
  assert.equal(list.partial, true)
  assert.equal(list.items.length, 2)
  assert.equal(store.getAsset(engagement, id).host_findings.total, 6,
    'asset detail shows linked host findings without new tables')
  assert.equal(store.coverageChecklist(engagement, id, 'internal').ready_to_close, false)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM asset_checklist').get().n, 0)
  assert.equal(store.getAsset(engagement, id).test_status, 'untested')
  assert.throws(() => store.recordHostFinding(engagement, { asset_id: id, kind: 'web',
    title: 'Wrong asset link', evidence_kind: 'http_evidence', evidence_id: otherEvidence }),
    /evidence not found for this asset/)
  assert.throws(() => store.recordHostFinding(engagement, { asset_id: otherId, kind: 'web',
    title: 'Wrong asset link', evidence_kind: 'http_evidence', evidence_id: ownEvidence }),
    /evidence not found for this asset/)
  assert.throws(() => store.recordHostFinding(engagement, { asset_id: id, kind: 'web',
    title: 'Missing evidence', evidence_kind: 'http_evidence', evidence_id: 999999 }),
    /evidence not found for this asset/)
  assert.throws(() => store.recordHostFinding(engagement, { asset_id: id, kind: 'web',
    title: 'Wrong kind', evidence_kind: 'file', evidence_id: ownEvidence }), /invalid evidence_kind/)
  assert.throws(() => store.recordHostFinding(engagement, { asset_id: id, kind: 'web',
    title: 'Missing id', evidence_kind: 'http_evidence' }), /invalid evidence_id/)
  assert.throws(() => store.recordHostFinding(engagement, { asset_id: id, kind: 'unknown',
    title: 'Wrong kind' }), /invalid host finding kind/)
  assert.throws(() => store.recordHostFinding(engagement, { asset_id: id, kind: 'file',
    title: ' ' }), /host finding title required/)
  assert.equal(store.listHostFindings(engagement, otherId).total, 0)
  assert.equal(store.listHostFindings(other, 1).total, 0)
  assert.equal(store.listHostFindings(engagement, id).total, 6,
    'rejected records must not be written')
  store.close()
  store = new RedteamStore(home)
  assert.equal(store.listHostFindings(engagement, id).total, 6, 'persists after restart')
  assert.equal(store.listHostFindings(other, 1).total, 0, 'engagements remain isolated')
})
