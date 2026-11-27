/**
 * One-call read-only context for a next_action focus target.
 * Only summarize locally recorded data: no scan, credential disclosure or score mutation.
 */
import { compactVuln } from './query-options.js'
import { redactCredentialText } from './report-shareable.js'
import { matchCveCandidates } from './cve-knowledge.js'
import { bundledKnowledge } from './knowledge-bundled.js'
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

function taskObservationText(asset, focusText = '') {
  const values = [focusText, asset?.test_surface, asset?.test_notes]
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

function taskSkillSignals(asset, focusText = '') {
  const text = taskObservationText(asset, focusText)
  const api = /(?:^|[^a-z0-9])(?:api|rest|graphql|openapi|swagger|websocket|json)(?=$|[^a-z0-9])/i.test(text)
    || /接口|接口文档|接口调用/.test(text)
  const auth = /(?:^|[^a-z0-9])(?:auth|authentication|authorization|login|oauth|oidc|jwt|sso|session|identity|token|permission|role|mfa|2fa|credential)(?=$|[^a-z0-9])/i.test(text)
    || /认证|授权|登录|身份|权限|角色|会话|令牌|验证码|单点登录/.test(text)
  const business = /(?:^|[^a-z0-9])(?:tenant|member|order|payment|billing|wallet|coupon|refund|withdraw|invoice|callback|webhook|checkout|commission|ledger|balance|recharge|payout|settlement|subscription|cart|promotion|reward|transaction|customer|support|ticket|export|report)(?=$|[^a-z0-9])/i.test(text)
    || /订单|支付|账单|钱包|优惠券|退款|提现|发票|回调|租户|会员|佣金|账本|余额|充值|结算|订阅|购物车|促销|奖励|交易|客户|客服|工单|导出|报表|财务|银行卡|积分|代理|分销|账户/.test(text)
    || (api && auth)
  return { api, auth, business }
}

function relatedSkillsForTask(asset, product, focusText = '') {
  const signals = taskSkillSignals(asset, focusText)
  const queries = []
  // Keep the most task-specific controls first; the total remains bounded.
  if (signals.business) queries.push({ query: 'business-security-controls', limit: 1 })
  if (signals.api) queries.push({ query: 'api-attack', limit: 1 })
  if (signals.auth) queries.push({ query: 'auth-attack', limit: 1 })
  if (product) queries.push({ query: product, limit: 2 })
  const unique = new Map()
  for (const { query, limit } of queries) {
    for (const skill of searchLocalSkills(query, { limit }).items) {
      if (!unique.has(skill.key)) unique.set(skill.key, skill)
    }
  }
  return [...unique.values()].slice(0, 5)
}

// Stable references use the same source/ID pair accepted by redteam_knowledge_get.
const bundledBySourceRef = new Map(bundledKnowledge.filter(row => row.source_ref).map(row => [row.source_ref, row]))
const bundledById = new Map(bundledKnowledge.map(row => [row.id, row]))
const businessKnowledgeSignals = [
  [/支付回调|支付通知|payment[ -]?(?:callback|webhook)/i, 'payment-notify-forgery'],
  [/租户隔离|多租户|multi[ -]?tenant|cross[ -]?tenant|tenant[ -]isolation/i, 'multi-tenant-cross-site'],
  [/对象级(?:授权|权限)|\b(?:bola|idor)\b/i, 'api-idor-bola'],
  [/订单状态|order[ -]status|order[ -]state/i, 'order-status-tamper'],
  [/接口重放|api[ -]replay|replay[ -]attack|幂等/i, 'api-replay-nonce-missing'],
  [/密码重置|找回密码|password[ -]reset/i, 'password-reset-token-abuse'],
  [/\bjwt\b|令牌签名/i, 'jwt-none-and-weak-key'],
  [/文件上传|file[ -]upload/i, 'upload-getshell'],
  [/\bcors\b|跨域凭据/i, 'cors-misconfig-credential'],
  [/回调\s*url|callback[ -]url/i, 'callback-url-ssrf'],
  [/提现审核|withdrawal[ -]approval/i, 'withdraw-approval-idor'],
  [/余额并发|钱包并发|balance[ -](?:race|concurrency)/i, 'race-condition-balance'],
  [/短信验证码|sms[ -](?:code|otp)/i, 'sms-code-reuse-and-bruteforce'],
  [/\bcsrf\b|跨站请求伪造/i, 'csrf-transfer'],
  [/业务查询.*sql|报表.*sql\s*注入/i, 'sql-injection-business-api'],
]

function bundledReferencesForTask(asset, focusText, candidates, explicitCve = '') {
  const selected = new Map()
  const add = (row, reason, extra = {}) => {
    if (!row || selected.has(row.id)) return
    selected.set(row.id, {
      id: row.id, title: row.title, category: row.category,
      source_ref: row.source_ref, source_url: row.source_url || '',
      ...(row.advisory_url ? { advisory_url: row.advisory_url } : {}),
      verified: false, reference: { source: 'bundled', id: row.id },
      match_reason: reason, ...extra,
    })
  }
  for (const candidate of candidates) {
    const sourceRef = String(candidate.source_url || '').match(/\/(plugin\/knowledge\/[^?#]+\.md)$/)?.[1]
    add(bundledBySourceRef.get(sourceRef), explicitCve ? 'exact-cve' : 'asset-product-candidate', {
      cve: candidate.cve, version_applicability: candidate.version_applicability,
    })
  }
  // Reuse the actual task observations, never a hostname or URL as evidence.
  // These specific business signals provide references even without a CVE match.
  const text = taskObservationText(asset, focusText)
  for (const [pattern, name] of businessKnowledgeSignals) {
    if (pattern.test(text)) add(bundledById.get('fujiang:gray-market:' + name), 'business-context')
  }
  return {
    source: 'bundled', verification_scope: 'reference-only',
    items: [...selected.values()].slice(0, 5),
    note: '按 reference.source 与 reference.id 调用 redteam_knowledge_get 读取正文；资料命中不代表当前目标已验证。',
  }
}

/** Small, read-only hints from public CVE metadata and already installed skills. */
function normalizeCandidateProduct(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function supersededKevCandidate(candidate, candidates) {
  if (candidate.advisory_status !== 'cisa-kev') return false
  const cves = new Set(Array.isArray(candidate.cve) ? candidate.cve : [])
  const product = normalizeCandidateProduct(candidate.product)
  if (!cves.size || !product) return false
  return candidates.some(other => {
    if (other === candidate || !other.version_constraints ||
        other.version_applicability?.status !== 'not_affected') return false
    if (!(other.cve || []).some(id => cves.has(id))) return false
    const reviewedProduct = normalizeCandidateProduct(other.product)
    return !!reviewedProduct && (product === reviewedProduct ||
      product.includes(reviewedProduct) || reviewedProduct.includes(product))
  })
}

function taskHints(asset, cve = '', focusText = '') {
  const matched = matchCveCandidates({ asset, cve, limit: 30 }).items
  // KEV membership has no affected-version boundary. If a same-product vendor
  // advisory explicitly marks the observed version fixed, do not re-add that
  // CVE as an unknown KEV candidate. Keep the vendor reference available.
  const eligible = matched.filter(row => !supersededKevCandidate(row, matched))
  const knowledge = eligible.filter(row => row.version_applicability?.status !== 'not_affected').slice(0, 3)
  const explicitCve = String(cve || '').trim()
  // An explicit stored CVE can still be read as a reference when its observed
  // version is outside the affected range; it is not a recommended candidate.
  const bundledReferences = bundledReferencesForTask(asset, focusText,
    explicitCve ? eligible.slice(0, 3) : knowledge, explicitCve)
  const product = (asset?.ports || []).find((p) => p.state === 'open' && p.product)?.product
    || (asset?.fingerprints || []).find((p) => p.product)?.product
  const relatedSkills = relatedSkillsForTask(asset, product, focusText)

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
    bundled_knowledge: bundledReferences,
    related_skills: relatedSkills,
    artex_knowledge: artexKnowledge,
  }
}

function operationExperienceContext(store,taskTypes) {
  if (typeof store.searchExperiences!=='function') return {total:0,items:[],status:'unavailable',note:'当前存储接口未提供经验检索；不影响已有任务上下文。'}
  try { return {...store.searchExperiences({task_types:taskTypes,limit:6}),note:'跨靶标历史正/负经验。validated 为已核验；candidate 仅为待核验线索，必须结合当前环境与证据重新判断，不自动执行。'} }
  catch { return {total:0,items:[],status:'unavailable',note:'经验库暂不可用；不影响已有任务上下文。'} }
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
      operation_experiences: operationExperienceContext(store,['asset-test','scan:nmap','scan:httpx','agent-task']),
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
  const hints = taskHints(asset, vuln.cve, vuln.title)
  const evidence = store.queryHttpEvidence(engagement, { vuln_id: id, detail: 'summary', limit: 10 })
  return {
    ok: true, engagement, target: record, kind, vulnerability: compactVuln(vuln),
    ...hints,
    operation_experiences: operationExperienceContext(store,['scan:nmap','scan:httpx','asset-test','agent-task','exploit-chain','internal-campaign']),
    linked_asset: assetBrief(asset),
    asset_link_status: vuln.asset_id == null ? 'unlinked' : asset ? 'linked' : 'missing',
    http_evidence: redactEvidenceSummary(evidence),
    next: '用 redteam_vuln_query(id=...) 查看完整漏洞记录；需要单条原始 HTTP 报文时按证据 id 调 redteam_http_evidence_query(id=...)。',
    note: '只读资料聚合，不执行探测、不变更漏洞状态或计分；存在候选/证据不等于已验证。关联资产的 test_status 是已保存的进度，不代表宿主当前运行状态。',
  }
}
