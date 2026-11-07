/**
 * 只读得分对账。漏洞、得分与待测资产都来自同一个演练库。
 * 目标：避免把“发现了组件”错当“拿到权限”，也避免不同漏洞共用一条得分标记。
 */
export function isUntestedLiveAsset(asset) {
  return !!asset && asset.state === 'live'
    && (!asset.test_status || asset.test_status === 'untested')
}

export function reviewScoring(vulns = [], board = {}, rules = [], defaultPoints = {}, missingByCode = {}) {
  const points = Array.isArray(board.items) ? board.items : []
  const pointByCode = new Map(points.map((p) => [String(p.code), p]))
  const confirmed = (Array.isArray(vulns) ? vulns : [])
    .filter((v) => v.status === 'confirmed' || v.status === 'exploited')
  const rows = confirmed.map((v) => {
    const gained = String(v.gained || '').trim()
    const evidence = String(v.evidence || '').trim()
    const hasEvidence = !!evidence || (Array.isArray(v.http_evidence)
      && v.http_evidence.some((e) => !!(e.request || e.response || e.note)))
    const linked = points.flatMap((p) =>
      (Array.isArray(p.hits) ? p.hits : [])
        .filter((h) => v.id != null && h.vuln_id != null && Number(h.vuln_id) === Number(v.id))
        .map((h) => ({ hit: h, point: p })))
    const linkedCounted = linked.some(({ hit, point }) =>
      point.enabled !== false && !hit.capped && !hit.self_created)
    const matched = gained
      ? rules.filter((rule) => rule.re.test(gained))
      : []
    const suggest = matched.map((rule) => {
      const point = pointByCode.get(rule.code)
      const hits = point && Array.isArray(point.hits) ? point.hits : []
      const ownHits = hits.filter((h) =>
        v.id != null && h.vuln_id != null && Number(h.vuln_id) === Number(v.id))
      return {
        code: rule.code,
        points: point ? Number(point.points) || 0 : defaultPoints[rule.code] || 0,
        available: !!point && point.enabled !== false,
        recorded: ownHits.length > 0,
        counted: !!point && point.enabled !== false
          && ownHits.some((h) => !h.capped && !h.self_created),
        elsewhere_recorded: hits.some((h) => h.vuln_id == null
          || Number(h.vuln_id) !== Number(v.id)),
        missing: missingByCode[rule.code] || '补充可复核的目标、结果和证据，再核对计分档位',
      }
    })
    const status = linkedCounted ? 'counted'
      : linked.length ? 'recorded-not-counted'
      : !gained ? 'no-outcome'
      : matched.length === 0 ? 'unmapped-outcome'
      : !hasEvidence ? 'missing-evidence'
      : 'review-ready'
    const note = status === 'no-outcome'
      ? '已确认漏洞不等于取得权限；补写实际成果，不从标题或组件名推断得分'
      : status === 'missing-evidence'
        ? '已有成果声明但缺少证据；先补实际结果，不自动写分'
        : status === 'recorded-not-counted'
          ? '已有关联命中，但它可能被去重、封顶、禁用或标记为自建账号；查看已有命中原因'
          : status === 'unmapped-outcome'
            ? '成果描述未匹配任何计分项；先读 redteam_score_list 核对真实 code'
            : status === 'review-ready'
              ? '成果与证据字段已存在；仍需人工或规则复核授权、真实性和档位'
              : '已找到本漏洞关联的有效计分记录'
    return {
      vuln_id: v.id,
      title: String(v.title || '').slice(0, 80),
      severity: v.severity,
      gained: gained.slice(0, 120),
      evidence_present: hasEvidence,
      linked_hits: linked.length,
      status,
      suggest,
      note,
    }
  })
  return {
    confirmed: rows.length,
    counted: rows.filter((row) => row.status === 'counted').length,
    review_ready: rows.filter((row) => row.status === 'review-ready').length,
    needs_evidence: rows.filter((row) => row.status === 'missing-evidence').length,
    needs_outcome: rows.filter((row) => row.status === 'no-outcome').length,
    recorded_not_counted: rows.filter((row) => row.status === 'recorded-not-counted').length,
    suggestions: rows.filter((row) => row.suggest.length > 0),
    followup: rows.filter((row) => row.status !== 'counted'),
  }
}
