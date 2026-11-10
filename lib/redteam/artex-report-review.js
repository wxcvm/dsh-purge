/**
 * Preview ARTEX's SARIF 2.1.0 findings as cross-tool handoff data.
 * Read-only: never alters DSH engagements, findings, evidence, or scores.
 * Mirrors the fields produced by wxcvm/ARTEX/report/sarif.go.
 */
function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function short(value, max = 260) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

const severityRank = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3, info: 4 })

// Ordering only guides a human/agent review; it never assigns a DSH verdict.
function reviewRank(finding) {
  if (finding.report_stale === true) return 0
  if (['pending', 'new', 'unverified', 'needs_review'].includes(finding.reported_status)) return 1
  if (finding.reported_status === 'confirmed') return 2
  if (['fixed', 'false_positive', 'accepted_risk'].includes(finding.reported_status)) return 4
  return 3
}

function reviewReason(finding) {
  if (finding.report_stale === true) return 'ARTEX 详细报告可能过期，优先核对证据版本'
  if (reviewRank(finding) === 1) return 'ARTEX 尚未确认，需在 DSH 独立核实'
  if (finding.reported_status === 'confirmed') return 'ARTEX 已确认，但 DSH 尚未独立核实'
  if (reviewRank(finding) === 4) return 'ARTEX 历史处理状态，按需复核'
  return 'ARTEX 来源状态待核对'
}

export function reviewArtexSarif(input, limit = 50) {
  const doc = object(input)
  if (doc.version !== '2.1.0' || !Array.isArray(doc.runs)) {
    throw new Error('需要 ARTEX 导出的 SARIF 2.1.0 报告')
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error('limit must be an integer between 1 and 200')
  }
  const findings = []
  const seen = new Set()
  const statuses = Object.create(null)
  const assetsByID = new Map()
  let unlinkedFindings = 0
  let missingEvidenceMetadata = 0
  let runs = 0
  let duplicates = 0
  for (const run of doc.runs) {
    if (object(object(run).tool).driver?.name !== 'ARTEX') continue
    runs++
    if (!Array.isArray(run.results)) throw new Error('ARTEX SARIF run missing results[]')
    for (const item of run.results) {
      const result = object(item)
      const properties = object(result.properties)
      const id = properties.findingId
      if (!Number.isSafeInteger(id) || id < 1) throw new Error('ARTEX SARIF findingId 无效')
      if (seen.has(id)) { duplicates++; continue }
      seen.add(id)
      const taskId = properties.taskId
      const assets = Array.isArray(properties.assetIds)
        ? [...new Set(properties.assetIds.filter((x) => Number.isSafeInteger(x) && x > 0))]
        : []
      const linkedRefs = new Map()
      for (const rawRef of Array.isArray(properties.assetRefs) ? properties.assetRefs : []) {
        const ref = object(rawRef)
        if (assets.includes(ref.id) && !linkedRefs.has(ref.id)) linkedRefs.set(ref.id, {
          type: short(ref.type, 24) || null,
          ip: short(ref.ip, 128) || null,
          domain: short(ref.domain, 256) || null,
          port: Number.isSafeInteger(ref.port) && ref.port >= 1 && ref.port <= 65535 ? ref.port : null,
        })
      }
      const trafficCount = Number.isSafeInteger(properties.trafficCount) && properties.trafficCount >= 0
        ? properties.trafficCount : null
      const evidenceVersion = Number.isSafeInteger(properties.evidenceVersion) && properties.evidenceVersion >= 0
        ? properties.evidenceVersion : null
      const reportEvidenceVersion = Number.isSafeInteger(properties.reportEvidenceVersion) && properties.reportEvidenceVersion >= 0
        ? properties.reportEvidenceVersion : null
      const reportStale = typeof properties.reportStale === 'boolean' ? properties.reportStale : null
      if (trafficCount === null) missingEvidenceMetadata++
      if (!assets.length) unlinkedFindings++
      for (const assetID of assets) {
        let group = assetsByID.get(assetID)
        if (!group) {
          group = { asset_id: assetID, finding_count: 0, finding_ids: [],
            finding_ids_omitted: 0, traffic_references: 0, evidence_unknown: 0, stale_reports: 0,
            type: null, ip: null, domain: null, port: null }
          assetsByID.set(assetID, group)
        }
        const identity = linkedRefs.get(assetID)
        if (identity) {
          for (const field of ['type', 'ip', 'domain', 'port']) {
            if (group[field] === null && identity[field] !== null) group[field] = identity[field]
          }
        }
        group.finding_count++
        if (group.finding_ids.length < 20) group.finding_ids.push(id)
        else group.finding_ids_omitted++
        if (trafficCount === null) group.evidence_unknown++
        else group.traffic_references += trafficCount
        if (reportStale === true) group.stale_reports++
      }
      const status = short(properties.status, 64) || 'unknown'
      statuses[status] = (statuses[status] || 0) + 1
      findings.push({
        source: 'ARTEX SARIF',
        finding_id: id,
        task_id: Number.isSafeInteger(taskId) && taskId > 0 ? taskId : null,
        asset_ids: assets,
        traffic_count: trafficCount,
        evidence_version: evidenceVersion,
        report_evidence_version: reportEvidenceVersion,
        report_stale: reportStale,
        rule_id: short(result.ruleId, 100) || null,
        severity: short(properties.severity, 32) || 'unknown',
        reported_status: status,
        reported_kind: short(result.kind, 32) || null,
        summary: short(object(result.message).text, 280),
        // ARTEX's status is a report from another store, not a DSH finding verdict.
        dsh_status: 'candidate',
        proof_included: false,
        independent_review_required: true,
      })
    }
  }
  if (!runs) throw new Error('没有找到 ARTEX 的 SARIF run')
  const assetGroups = [...assetsByID.values()].sort((a, b) => a.asset_id - b.asset_id)
  const reviewQueue = [...findings]
    .sort((a, b) => reviewRank(a) - reviewRank(b)
      || (severityRank[a.severity.toLowerCase()] ?? 5) - (severityRank[b.severity.toLowerCase()] ?? 5)
      || a.finding_id - b.finding_id)
    .slice(0, 20)
    .map((finding) => ({
      finding_id: finding.finding_id,
      task_id: finding.task_id,
      asset_ids: finding.asset_ids,
      rule_id: finding.rule_id,
      severity: finding.severity,
      reported_status: finding.reported_status,
      traffic_count: finding.traffic_count,
      evidence_version: finding.evidence_version,
      report_evidence_version: finding.report_evidence_version,
      report_stale: finding.report_stale,
      summary: finding.summary,
      review_reason: reviewReason(finding),
    }))
  // Match the review queue's source assets first; retain the legacy ID-sorted overview.
  const matchGroups = []
  const matchSeen = new Set()
  for (const finding of reviewQueue) {
    for (const sourceID of finding.asset_ids) {
      const group = assetsByID.get(sourceID)
      if (!group || matchSeen.has(sourceID)) continue
      matchSeen.add(sourceID)
      matchGroups.push(group)
    }
  }
  for (const group of assetGroups) {
    if (!matchSeen.has(group.asset_id)) matchGroups.push(group)
  }
  return {
    ok: true,
    source: 'ARTEX SARIF 2.1.0',
    read_only: true,
    artex_runs: runs,
    unique_findings: findings.length,
    duplicates_skipped: duplicates,
    status_counts: statuses,
    review_queue: reviewQueue,
    review_queue_total: findings.length,
    review_queue_omitted: Math.max(0, findings.length - reviewQueue.length),
    source_assets_total: assetGroups.length,
    asset_groups: assetGroups.slice(0, 50),
    asset_groups_omitted: Math.max(0, assetGroups.length - 50),
    match_asset_groups: matchGroups.slice(0, 50),
    match_asset_groups_omitted: Math.max(0, matchGroups.length - 50),
    unlinked_findings: unlinkedFindings,
    findings_without_evidence_metadata: missingEvidenceMetadata,
    independently_confirmed_by_dsh: 0,
    items: findings.slice(0, limit),
    omitted: Math.max(0, findings.length - limit),
    note: '仅供跨项目核对：资产 ID 属于本次 ARTEX 导出，不是 DSH 资产 ID；流量数量及版本仅为证据引用元数据，不含原始请求或响应。未导入 DSH、未进行独立确认或计分。',
  }
}
