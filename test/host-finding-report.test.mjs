import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'
import { writeReportBundle } from '../lib/redteam/report-export.js'

test('unverified host findings are indexed in raw/shareable exports without claiming points or leaking content', t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-host-finding-report-'))
  const store = new RedteamStore(root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const engagement = store.openEngagement('report-host-fixture', ['10.45.0.0/24'], { bindCurrent: false }).id
  const other = store.openEngagement('report-other-fixture', ['10.46.0.0/24'], { bindCurrent: false }).id
  store.importBundle(engagement, { scan: { tool: 'fixture', argv: [] },
    assets: [{ ip: '10.45.0.5', provenance: 'passive', tool: 'fixture', state: 'live' }] })
  const assetId = store.listAssets(engagement, { ip: '10.45.0.5' }).items[0].id
  const secret = 'UNIQUE_SENSITIVE_HOST_FINDING_DETAIL_123'
  const request = 'Authorization: Bearer ' + secret
  const eId = store.addHttpEvidence(engagement, { asset_id: assetId, request,
    response: 'Set-Cookie: sid=' + secret, label: 'synthetic body' }).id
  const linked = store.recordHostFinding(engagement, { asset_id: assetId, kind: 'web',
    title: 'Authorization: Bearer ' + secret, detail: 'password=' + secret,
    evidence_kind: 'http_evidence', evidence_id: eId })
  const unlinked = store.recordHostFinding(engagement, { asset_id: assetId, kind: 'config',
    title: 'Plain text note ' + secret, detail: secret })
  const report = store.scoreReport(engagement, { shotRef: 'relative' })
  assert.equal(report.summary.points, 0, 'manual finding cannot create score points')
  assert.equal(report.items.length, 0, 'manual finding cannot create scored entries')
  assert.match(report.markdown, /## 6\. Unverified host findings \(not scored\)/)
  assert.match(report.markdown, /2 manually recorded finding\(s\)/)
  assert.ok(report.markdown.includes('#' + linked.id))
  assert.ok(report.markdown.includes('#' + unlinked.id))
  assert.ok(report.markdown.includes('http_evidence:' + eId))
  assert.ok(report.markdown.includes('reference recorded; unverified'))
  assert.ok(report.markdown.includes('manual claim; unlinked'))
  for (const forbidden of [secret, request, 'synthetic body', 'Plain text note',
    'Set-Cookie:', 'Authorization:', 'password=']) {
    assert.equal(report.markdown.includes(forbidden), false, 'report must omit sensitive content: ' + forbidden)
  }
  const raw = writeReportBundle({ root, engagement, outDir: root, report })
  const safe = writeReportBundle({ root, engagement, outDir: root, report, shareable: true })
  const rawText = readFileSync(raw.reportFile, 'utf8')
  const shareable = readFileSync(safe.reportFile, 'utf8')
  assert.equal(rawText, report.markdown)
  assert.match(shareable, /## 6\. Unverified host findings \(not scored\)/)
  assert.ok(shareable.includes('http_evidence:' + eId))
  assert.equal(shareable.includes('10.45.0.5'), false, 'sharing copy masks asset IPs')
  assert.match(shareable, /IP-\d+/)
  assert.equal(shareable.includes(secret), false)
  assert.equal(raw.manifest.summary.points, 0)
  assert.equal(safe.manifest.summary.points, 0)
  assert.equal(store.coverageChecklist(engagement, assetId, 'internal').ready_to_close, false)
  assert.equal(store.getAsset(engagement, assetId).test_status, 'untested')
  assert.equal(store.scoreReport(other).markdown.includes('## 6. Unverified host findings'), false,
    'another engagement must not include these observations')
})

test('report index is capped to newest 100 and never prints untrusted observation metadata', t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-host-finding-index-limit-'))
  const store = new RedteamStore(root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const engagement = store.openEngagement('host-index-limit', ['10.47.0.0/24'], { bindCurrent: false }).id
  store.importBundle(engagement, { scan: { tool: 'fixture', argv: [] },
    assets: [{ ip: '10.47.0.5', provenance: 'passive', tool: 'fixture', state: 'live' }] })
  const id = store.listAssets(engagement, { ip: '10.47.0.5' }).items[0].id
  const db = store.db(engagement)
  for (let i = 0; i < 101; i++) {
    db.prepare("INSERT INTO observation(entity_kind, entity_id, attr, value, raw_ref) VALUES('asset',?,'host_finding',?,?)")
      .run(id, i === 0 ? '{not-json' : JSON.stringify({ kind: 'web', title: 'TOP_SECRET_' + i }),
        i === 0 ? 'other_kind:123' : null)
  }
  const markdown = store.scoreReport(engagement).markdown
  assert.match(markdown, /101 manually recorded finding\(s\)/)
  assert.match(markdown, /Showing newest 100 entries/)
  assert.equal(markdown.includes('TOP_SECRET_100'), false)
  assert.equal(markdown.includes('other_kind:123'), false)
  assert.equal(markdown.includes('| #1 |'), false, 'oldest entry should be omitted')
  assert.ok(markdown.includes('| #101 |'), 'newest entry should be present')
})
