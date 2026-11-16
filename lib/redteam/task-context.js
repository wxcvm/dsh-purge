/**
 * One-call read-only context for a next_action focus target.
 * Only summarize locally recorded data: no scan, credential disclosure or score mutation.
 */
import { compactVuln } from './query-options.js'
import { redactCredentialText } from './report-shareable.js'
import { matchCveCandidates } from './cve-knowledge.js'
import { searchLocalSkills } from './skill-catalog.js'
import { searchArtexKnowledge } from '../artex-knowledge.js'

function parseTaskTarget(target) {
  const match = typeof target === 'string'
    ? target.trim().match(/^(?:[^:\r\n]{1,100}:)?(asset|vuln)\s*#([1-9]\d*)$/i)
    : null
  if (!match) throw new TypeError('target must be focus.target (asset #ID or vuln #ID) or its focus.task_key')
  const id = Number(match[2])
  if (!Number.isSafeInteger(id)) throw new TypeError('task record ID must be a positive safe integer')
  return { kind: match[1].toLowerCase(), id }
}

function assetBrief(asset) {
  if (!asset) return null
  const openPorts = Array.isArray(asset.ports) ? asset.ports.filter((port) => port.state === 'open') : []
  const notes = String(asset.test_notes || '').split('\n').filter(Boolean)
  const fingerprints = Array.isArray(asset.fingerprints) ? asset.fingerprints : []
  const recentNotes = notes.slice(-3)
  return {
    id: asset.id, ip: asset.ip, name: asset.primary_name || null,
    state: asset.state, test_status: asset.test_status || 'untested',
    // Persisted progress is not a live host/session observation.
    test_status_source: asset.test_status ? 'stored-record' : 'default',
    runtime_activity: 'not-observed',
    test_updated_at: asset.test_updated_at || null,
    test_surface: String(asset.test_surface || '').slice(0, 240),
    recent_test_notes: recentNotes.map((note) => note.slice(0, 240)),
    summary_coverage: {
      test_notes_total: notes.length,
      test_notes_omitted: Math.max(0, notes.length - recentNotes.length),
      test_notes_text_truncated: recentNotes.some(note => note.length > 240),
      test_surface_truncated: String(asset.test_surface || '').length > 240,
      open_ports_omitted: Math.max(0, (Number(asset.open_ports) || openPorts.length) - Math.min(openPorts.length, 20)),
      fingerprints_omitted: Math.max(0, fingerprints.length - 10),
    },
    blocked_count: Number(asset.blocked_count) || 0,
    segment: asset.segment_cidr || null, scope: asset.scope || null,
    open_ports_total: Number(asset.open_ports) || openPorts.length,
    open_ports: openPorts.slice(0, 20).map((port) => ({
      port: port.port, proto: port.proto, service: port.service || null, product: port.product || null,
    })),
    fingerprints: fingerprints.slice(0, 10)
      .map((fp) => [fp.vendor, fp.product, fp.version].filter(Boolean).join(' ')),
  }
}

function taskObservationText(asset) {
  const values = [asset?.test_surface, asset?.test_notes]
  for (const port of asset?.ports || []) {
    if (port.state !== 'open') continue
    values.push(port.service, port.product, port.banner, port.title)
  }
  for (const fingerprint of asset?.fingerprints || []) {
    values.push(fingerprint.category, fingerprint.vendor, fingerprint.product,
      fingerprint.name, fingerprint.evidence)
  }
  // Do not use hostnames or URL hosts as product/business evidence.
  return values.filter(Boolean).join(' ').toLowerCase()
}

function taskSkillSignals(asset) {
  const text = taskObservationText(asset)
  const api = /(?:^|[^a-z0-9])(?:api|rest|graphql|openapi|swagger|websocket|json)(?=$|[^a-z0-9])/i.test(text)
    || /接口|接口文档|接口调用/.test(text)
  const auth = /(?:^|[^a-z0-9])(?:auth|authentication|authorization|login|oauth|oidc|jwt|sso|session|identity|token|permission|role|mfa|2fa|credential)(?=$|[^a-z0-9])/i.test(text)
    || /认证|授权|登录|身份|权限|角色|会话|令牌|验证码|单点登录/.test(text)
  const business = /(?:^|[^a-z0-9])(?:tenant|member|order|payment|billing|wallet|coupon|refund|withdraw|invoice|callback|webhook|checkout|commission|ledger|balance|recharge|payout|settlement|subscription|cart|promotion|reward|transaction|customer|support|ticket|export|report)(?=$|[^a-z0-9])/i.test(text)
    || /订单|支付|账单|钱包|优惠券|退款|提现|发票|回调|租户|会员|佣金|账本|余额|充值|结算|订阅|购物车|促销|奖励|交易|客户|客服|工单|导出|报表|财务|银行卡|积分|代理|分销|账户/.test(text)
  return { api, auth, business }
}

function relatedSkillsForTask(asset, product) {
  const signals = taskSkillSignals(asset)
  const queries = []
  if (product) queries.push({ query: product, limit: 3 })
  if (signals.api) queries.push({ query: 'api', limit: 2 })
  if (signals.auth) queries.push({ query: 'auth', limit: 2 })
  if (signals.business) queries.push({ query: 'business-security-controls', limit: 1 })
  const unique = new Map()
  for (const { query, limit } of queries) {
    for (const skill of searchLocalSkills(query, { limit }).items) {
      if (!unique.has(skill.key)) unique.set(skill.key, skill)
    }
  }
  return [...unique.values()].slice(0, 5)
}

/** Small, read-only hints from public CVE metadata and already installed skills. */
function taskHints(asset, cve = '') {
  const knowledge = matchCveCandidates({ asset, cve, limit: 30 }).items
    .filter(row => row.version_applicability?.status !== 'not_affected').slice(0, 3)
  const product = (asset?.ports || []).find((p) => p.state === 'open' && p.product)?.product
    || (asset?.fingerprints || []).find((p) => p.product)?.product
  const relatedSkills = relatedSkillsForTask(asset, product)

  // Keep untrusted knowledge bodies out of task cards; agents can explicitly
  // read an interesting result using redteam_artex_knowledge_get(id).
  const query = String(cve || product || '').trim()
  let artexKnowledge = { status: query ? 'not-installed' : 'no-keyword', query: query || null,
    source: 'local-artex-knowledge', verification_scope: 'historical-reference', items: [] }
  if (query) {
    try {
      const result = searchArtexKnowledge({ query, limit: 3 })
      artexKnowledge = {
        ...artexKnowledge, status: 'available',
        items: result.items.map(({ id, title, category, kind, verified }) =>
          ({ id, title, category, kind, verified })),
      }
    } catch (error) {
      artexKnowledge.status = error?.message === '未找到 ARTEX 本地知识库'
        ? 'not-installed' : 'unavailable'
    }
  }
  return {
    provenance: {
      records: 'local-engagement-store',
      knowledge: 'reference-only',
      current_target_validation: 'not-performed-by-context',
    },
    knowledge_candidates: knowledge,
    related_skills: relatedSkills,
    artex_knowledge: artexKnowledge,
  }
}

// Protect model-facing HTTP metadata, not the stored record or explicit evidence query.
// Preserve the existing summary size limits after replacing credential values.
function redactEvidenceSummary(result) {
  return {
    ...result,
    items: result.items.map(item => {
      const copy = { ...item }
      for (const [key, limit] of [['label', 120], ['url', 500], ['note', 240]]) {
        if (typeof copy[key] === 'string') copy[key] = redactCredentialText(copy[key]).slice(0, limit)
      }
      return copy
    }),
  }
}

/**
 * Compose existing exact-ID lookup APIs into a short, actionable context.
 * HTTP bodies remain available only through redteam_http_evidence_query(id=...).
 */
export function taskContext(store, engagement, target) {
  const { kind, id } = parseTaskTarget(target)
  const record = kind + ' #' + id
  if (kind === 'asset') {
    const asset = store.getAsset(engagement, id)
    if (!asset) return { ok: false, engagement, target: record, error: 'asset not found' }
    const hints = taskHints(asset)
    const linked = store.listVulns(engagement, { asset_id: id, withHttpEvidence: false, limit: 10 })
    const directEvidence = store.queryHttpEvidence(engagement, { asset_id: id, detail: 'summary', limit: 10 })
    return {
      ok: true, engagement, target: record, kind, asset: assetBrief(asset),
      ...hints,
      related_vulns: {
        total: linked.total, returned: linked.items.length, hasMore: linked.hasMore,
        nextOffset: linked.nextOffset, items: linked.items.map(compactVuln),
      },
      direct_http_evidence: redactEvidenceSummary(directEvidence),
      next: '用 redteam_vuln_query(id=...) 核对关联漏洞；用 redteam_http_evidence_query(vuln_id=...) 找漏洞证据；测试记录通过 redteam_asset_test 更新。',
      note: '仅是数据库事实摘要。scope 只表示地址内外网分类，不证明授权；证据存在不代表漏洞已确认。test_status 是已保存的进度，testing 不代表宿主当前仍在执行。direct_http_evidence 不包含仅通过 vuln_id 关联的证据。',
    }
  }
  const found = store.listVulns(engagement, { id, withHttpEvidence: false, limit: 1 })
  const vuln = found.items[0]
  if (!vuln) return { ok: false, engagement, target: record, error: 'vuln not found' }
  const asset = vuln.asset_id == null ? null : store.getAsset(engagement, vuln.asset_id)
  const hints = taskHints(asset, vuln.cve)
  const evidence = store.queryHttpEvidence(engagement, { vuln_id: id, detail: 'summary', limit: 10 })
  return {
    ok: true, engagement, target: record, kind, vulnerability: compactVuln(vuln),
    ...hints,
    linked_asset: assetBrief(asset),
    asset_link_status: vuln.asset_id == null ? 'unlinked' : asset ? 'linked' : 'missing',
    http_evidence: redactEvidenceSummary(evidence),
    next: '用 redteam_vuln_query(id=...) 查看完整漏洞记录；需要单条原始 HTTP 报文时按证据 id 调 redteam_http_evidence_query(id=...)。',
    note: '只读资料聚合，不执行探测、不变更漏洞状态或计分；存在候选/证据不等于已验证。关联资产的 test_status 是已保存的进度，不代表宿主当前运行状态。',
  }
}
