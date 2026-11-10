import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reviewArtexSarif } from '../lib/redteam/artex-report-review.js'

const sample = {
  version: '2.1.0',
  runs: [{
    tool: { driver: { name: 'ARTEX', rules: [] } },
    results: [
      {
        ruleId: 'ARTEX-01', level: 'error', kind: 'fail',
        message: { text: 'Observed access control issue', markdown: 'PRIVATE_RAW_TRAFFIC' },
        partialFingerprints: { artexFindingId: '15' },
        properties: { findingId: 15, taskId: 3, assetIds: [6, 2, 6], severity: 'critical', status: 'confirmed',
          trafficCount: 2, evidenceVersion: 6, reportEvidenceVersion: 4, reportStale: true },
      },
      {
        ruleId: 'ARTEX-02', level: 'note', kind: 'pass',
        message: { text: 'Previously fixed issue' },
        properties: { findingId: 16, taskId: null, severity: 'low', status: 'fixed',
          trafficCount: 0, evidenceVersion: 0, reportEvidenceVersion: 0, reportStale: false },
      },
      {
        ruleId: 'ARTEX-03', level: 'warning', kind: 'review',
        message: { text: 'Needs manual review' },
        properties: { findingId: 17, taskId: 4, assetIds: [11], severity: 'medium', status: 'pending' },
      },
    ],
  }],
}

test('ARTEX SARIF preserves finding, task, asset and triage lineage without inventing DSH verification', () => {
  const out = reviewArtexSarif(sample)
  assert.equal(out.source, 'ARTEX SARIF 2.1.0')
  assert.equal(out.read_only, true)
  assert.equal(out.artex_runs, 1)
  assert.equal(out.unique_findings, 3)
  assert.deepEqual({ ...out.status_counts }, { confirmed: 1, fixed: 1, pending: 1 })
  assert.deepEqual(out.items[0].asset_ids, [6, 2])
  assert.equal(out.items[0].task_id, 3)
  assert.equal(out.items[0].reported_status, 'confirmed')
  assert.equal(out.items[0].dsh_status, 'candidate')
  assert.equal(out.items[0].proof_included, false)
  assert.deepEqual(out.items[0].asset_ids, [6, 2], 'duplicate asset link must not inflate counts')
  assert.equal(out.items[0].traffic_count, 2)
  assert.equal(out.items[0].evidence_version, 6)
  assert.equal(out.items[0].report_evidence_version, 4)
  assert.equal(out.items[0].report_stale, true)
  assert.equal(out.items[1].traffic_count, 0)
  assert.equal(out.items[1].report_stale, false)
  assert.equal(out.items[2].traffic_count, null, 'old SARIF must not claim zero evidence')
  assert.equal(out.items[2].report_stale, null)
  assert.equal(out.source_assets_total, 3)
  assert.deepEqual(out.asset_groups.map((x) => x.asset_id), [2, 6, 11])
  assert.deepEqual(out.asset_groups[0].finding_ids, [15])
  assert.equal(out.asset_groups[0].traffic_references, 2)
  assert.equal(out.asset_groups[0].stale_reports, 1)
  assert.equal(out.unlinked_findings, 1)
  assert.equal(out.findings_without_evidence_metadata, 1)
  assert.deepEqual(out.review_queue.map((x) => x.finding_id), [15, 17, 16])
  assert.equal(out.review_queue_total, 3)
  assert.equal(out.review_queue_omitted, 0)
  assert.match(out.review_queue[0].review_reason, /过期/)
  assert.equal(out.review_queue[0].traffic_count, 2)
  assert.equal(out.independently_confirmed_by_dsh, 0)
  assert.equal(JSON.stringify(out).includes('PRIVATE_RAW_TRAFFIC'), false)
  assert.equal(out.items[1].reported_kind, 'pass')
  assert.equal(out.items[2].reported_status, 'pending')
})

test('duplicate rows and pagination do not undercount unique findings', () => {
  const copy = structuredClone(sample)
  copy.runs[0].results.push(structuredClone(copy.runs[0].results[0]))
  const result = reviewArtexSarif(copy, 1)
  assert.equal(result.unique_findings, 3)
  assert.equal(result.duplicates_skipped, 1)
  assert.equal(result.items.length, 1)
  assert.equal(result.omitted, 2)
})

test('reject malformed, foreign and ID-less reports rather than declaring zero findings', () => {
  assert.throws(() => reviewArtexSarif({}), /SARIF 2.1.0/)
  assert.throws(() => reviewArtexSarif({ version: '2.1.0', runs: [] }), /ARTEX/)
  assert.throws(() => reviewArtexSarif({ version: '2.1.0',
    runs: [{ tool: { driver: { name: 'Other' } }, results: [] }] }), /ARTEX/)
  const missing = structuredClone(sample)
  delete missing.runs[0].results[0].properties.findingId
  assert.throws(() => reviewArtexSarif(missing), /findingId/)
  const broken = structuredClone(sample)
  delete broken.runs[0].results
  assert.throws(() => reviewArtexSarif(broken), /missing results/)
  assert.throws(() => reviewArtexSarif(sample, 0), /limit/)
})

test('large source asset groups keep exact counts while listing bounded references', () => {
  const many = structuredClone(sample)
  many.runs[0].results = Array.from({ length: 25 }, (_unused, index) => ({
    properties: { findingId: index + 1, assetIds: [9], trafficCount: 1, reportStale: false },
    message: { text: 'f-' + index },
  }))
  const output = reviewArtexSarif(many, 1)
  assert.equal(output.unique_findings, 25)
  assert.equal(output.asset_groups[0].finding_count, 25)
  assert.equal(output.asset_groups[0].finding_ids.length, 20)
  assert.equal(output.asset_groups[0].finding_ids_omitted, 5)
  assert.equal(output.asset_groups[0].traffic_references, 25)
  assert.equal(output.omitted, 24)
  assert.equal(output.review_queue.length, 20)
  assert.equal(output.review_queue_omitted, 5)
  assert.equal(output.review_queue_total, 25)
})

test('ARTEX report review route and embedded resource tab are both connected', () => {
  const server = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const rt = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const embedded = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(server, /path: "\/dsh-purge\/artex\/report-preview"/)
  assert.match(server, /reviewArtexSarif\(body\.sarif\)/)
  assert.match(rt, /\/dsh-purge\/artex\/report-preview/)
  assert.match(rt, /ARTEX SARIF 报告/)
  assert.match(rt, /按 ARTEX 资产 ID 查看关联漏洞/)
  assert.match(rt, /report\.asset_groups/)
  assert.match(rt, /report\.review_queue/)
  assert.match(rt, /复制核查交接清单/)
  assert.match(embedded, /ARTEX SARIF 报告/)
  assert.match(embedded, /按 ARTEX 资产 ID 查看关联漏洞/)
  assert.match(embedded, /复制核查交接清单/)
})
