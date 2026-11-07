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

/**
 * 给能力一般的指挥模型一张唯一的“下一步任务卡”。只组织现有建议，
 * 不执行任务、不验证授权、不写分。执行后应重新读取真实库状态。
 */
export function nextTaskCard(actions = [], state = {}) {
  const ranked = (Array.isArray(actions) ? actions : [])
    .map((action, index) => ({ action, index }))
    .sort((a, b) => (Number.isFinite(Number(a.action.priority)) ? Number(a.action.priority) : 99)
      - (Number.isFinite(Number(b.action.priority)) ? Number(b.action.priority) : 99) || a.index - b.index)
  const selected = ranked[0] && ranked[0].action
  if (!selected) return {
    status: 'idle',
    instruction: '没有可信的待办项：先核对任务范围与当前记录，不凭空创建攻击任务。',
  }
  return {
    status: 'ready',
    task_key: String(selected.action || '') + ':' + String(selected.target || ''),
    title: String(selected.action || '核对当前任务'),
    target: String(selected.target || ''),
    priority: selected.priority,
    reason: String(selected.why || ''),
    first_tool: String(selected.tool || ''),
    expected: String(selected.expected || '记录可复核的实际结果'),
    before: {
      score_points: Number(state.score_points) || 0,
      counted_hits: Number(state.score_hits) || 0,
      recorded_hits: Number(state.recorded_hits) || 0,
      assets: Number(state.assets) || 0,
      confirmed: Number(state.confirmed) || 0,
    },
    workflow: [
      '先核对目标是否属于自有或明确授权范围，以及该目标此前的测试记录。',
      '只处理这一件任务；输出真实结果、失败原因与对应的库记录 ID。',
      '任务结束后重读得分和资产状态，只把实际变化算作进展。',
    ],
    done_when: '已有可核对的结果与对应的记录；分数只有在计分面板实际增加时才算新增。',
    if_blocked: '写清缺失资源、失败原因或缺少证据；没有条件变化时不重复同一动作，改为其他可行任务或请求用户决定。',
  }
}
