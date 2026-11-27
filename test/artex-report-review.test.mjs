import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
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
          assetRefs: [{ id: 6, type: 'service', domain: 'api.example.test', port: 443 },
            { id: 2, type: 'ip', ip: '192.0.2.1' }],
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
  assert.deepEqual(out.match_asset_groups.map((x) => x.asset_id), [6, 2, 11])
  assert.equal(out.match_asset_groups_omitted, 0)
  assert.equal(out.asset_groups[0].ip, '192.0.2.1')
  assert.equal(out.asset_groups[1].domain, 'api.example.test')
  assert.equal(out.asset_groups[1].port, 443)
  assert.equal(out.asset_groups[2].domain, null, 'old ARTEX exports retain unmappable numeric IDs')
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
  assert.equal(out.review_queue[0].evidence_version, 6)
  assert.equal(out.review_queue[0].report_evidence_version, 4)
  assert.equal(out.review_queue[1].evidence_version, null, 'old exports still have unknown versions')
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

test('high-priority findings get matching slots beyond the first 50 asset IDs', () => {
  const many = structuredClone(sample)
  many.runs[0].results = Array.from({ length: 60 }, (_unused, index) => ({
    properties: { findingId: index + 1, assetIds: [index + 1], severity: 'low', status: 'fixed' },
    message: { text: 'resolved-' + index },
  }))
  many.runs[0].results.push({
    properties: { findingId: 500, assetIds: [500], severity: 'critical', status: 'pending',
      assetRefs: [{ id: 500, type: 'ip', ip: '192.0.2.55' }] },
    message: { text: 'urgent asset' },
  })
  const out = reviewArtexSarif(many)
  assert.equal(out.source_assets_total, 61)
  assert.equal(out.asset_groups.length, 50)
  assert.equal(out.asset_groups[0].asset_id, 1)
  assert.equal(out.asset_groups.some((x) => x.asset_id === 500), false)
  assert.equal(out.review_queue[0].finding_id, 500)
  assert.equal(out.match_asset_groups[0].asset_id, 500)
  assert.equal(out.match_asset_groups[0].ip, '192.0.2.55')
  assert.equal(out.match_asset_groups.length, 50)
  assert.equal(out.match_asset_groups_omitted, 11)
  assert.equal(out.review_queue_omitted, 41)
})

test('ARTEX handoff shows source host, port, matching reasons and limited candidates', () => {
  const source = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('    function formatArtexReviewAssets(')
  const end = source.indexOf('    function ArtexTab(props)', start)
  assert.ok(start >= 0 && end > start)
  const format = runInNewContext(source.slice(start, end) + '\nformatArtexReviewAssets')
  const report = {
    asset_groups: [{ asset_id: 1, ip: '192.0.2.1' }],
    match_asset_groups: [
      { asset_id: 500, domain: 'api.example.test', port: 443 },
      { asset_id: 2, ip: '192.0.2.2' },
    ],
  }
  const many = Array.from({ length: 7 }, (_unused, i) => ({
    dsh_asset_id: i + 10, primary_name: 'web-' + i + '.test', ip: '198.51.100.' + (i + 1),
    matched_by: 'domain', port_match: true,
  }))
  const matches = {
    review_links: [{ finding_id: 15, links: [
      { source_asset_id: 500, status: 'ambiguous', dsh_asset_id: null },
      { source_asset_id: 2, status: 'matched', dsh_asset_id: 41 },
      { source_asset_id: 3, status: 'not_compared', dsh_asset_id: null },
    ] }],
    items: [
      { source_asset_id: 500, status: 'ambiguous', candidates: many, candidates_truncated: true },
      { source_asset_id: 2, status: 'matched', candidates: [
        { dsh_asset_id: 41, primary_name: 'service.example.test', ip: '192.0.2.2',
          matched_by: 'ip+domain', port_match: false },
      ] },
    ],
  }
  const line = format({ finding_id: 15, asset_ids: [500, 2, 3] }, report, matches)
  assert.match(line, /ARTEX #500 api\.example\.test · 端口 443 → 多个资产候选/)
  assert.match(line, /DSH #10 web-0\.test \/ 198\.51\.100\.1 \[域名\/别名一致、开放端口一致\]/)
  assert.match(line, /DSH #41 service\.example\.test \/ 192\.0\.2\.2 \[IP 一致、域名\/别名一致\]/)
  assert.match(line, /另有 2 个候选未列出/)
  assert.match(line, /匹配候选有截断/)
  assert.match(line, /ARTEX #3 → 本次未比对/)
  assert.doesNotMatch(line, /DSH #15/)
  assert.match(format({ finding_id: 16, asset_ids: [500] }, report, matches), /匹配结果暂缺/)
  assert.match(format({ finding_id: 17, asset_ids: [] }, report, matches), /ARTEX 未关联资产/)
  assert.match(format({ finding_id: 15, asset_ids: [500] }, report, null), /尚未比对当前靶标/)
  assert.ok(!line.includes('PRIVATE_RAW_TRAFFIC'))
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
  assert.match(rt, /matchArtexAssets/)
  assert.match(rt, /与当前 DSH 靶标匹配/)
  assert.match(rt, /report\.review_queue/)
  assert.match(rt, /review_queue: report\.review_queue/)
  assert.match(rt, /report\.match_asset_groups \|\| report\.asset_groups/)
  assert.match(rt, /refs: sourceRefs/)
  assert.match(rt, /reviewAssetLabel/)
  assert.match(rt, /formatArtexReviewAssets/)
  assert.match(rt, /assetMatches\._report === report/)
  assert.match(rt, /复制核查交接清单/)
  assert.match(embedded, /ARTEX SARIF 报告/)
  assert.match(embedded, /按 ARTEX 资产 ID 查看关联漏洞/)
  assert.match(embedded, /与当前 DSH 靶标匹配/)
  assert.match(embedded, /复制核查交接清单/)
  assert.match(embedded, /reviewAssetLabel/)
  assert.match(embedded, /formatArtexReviewAssets/)
  assert.match(embedded, /refs: sourceRefs/)
})


test('ARTEX report availability and all native triage states remain distinct', () => {
  const statuses = ['resolved', 'risk_accepted', 'ignored', 'duplicate', 'in_progress', 'confirmed', 'pending'];
  const input = structuredClone(sample);
  input.runs[0].results = statuses.map((status, i) => ({ properties: {
    findingId: i + 1, status, severity: 'high', reportAvailable: i === 0 ? true : i === 1 ? false : undefined,
  }}));
  const out = reviewArtexSarif(input);
  assert.deepEqual(out.report_availability, { available: 1, absent: 1, unknown: 5 });
  assert.deepEqual(out.items.slice(0, 3).map(x => x.report_available), [true, false, null]);
  assert.deepEqual(out.review_queue.map(x => x.reported_status), ['in_progress', 'pending', 'confirmed', 'resolved', 'risk_accepted', 'ignored', 'duplicate']);
  assert.equal(out.review_queue[3].report_available, true);
  assert.equal(out.independently_confirmed_by_dsh, 0);
});

test('an ARTEX report distinguishes declared source IDs and refuses mixed-source merges', () => {
  const a = '0123456789abcdef0123456789abcdef'
  const b = 'fedcba9876543210fedcba9876543210'
  const file = structuredClone(sample)
  assert.equal(reviewArtexSarif(file).source_id, null)
  file.runs[0].properties = { artexSourceId: a.toUpperCase() }
  assert.equal(reviewArtexSarif(file).source_id, a)
  const other = structuredClone(file.runs[0])
  other.properties.artexSourceId = b
  file.runs.push(other)
  assert.throws(() => reviewArtexSarif(file), /不同或未声明/)
  delete file.runs[1].properties
  assert.throws(() => reviewArtexSarif(file), /不同或未声明/)
  file.runs.pop()
  file.runs[0].properties.artexSourceId = 'not-an-id'
  assert.throws(() => reviewArtexSarif(file), /来源标识无效/)
})
