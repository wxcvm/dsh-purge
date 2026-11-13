/** Failure-triggered local references, never a repair, command or validation result. */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { unifiedKnowledgeRequest } from './knowledge-unified.js'
import { listLocalSkills } from './skill-catalog.js'
import { taskProgressTarget } from './task-progress.js'
import { redactCredentialText } from './report-shareable.js'

const categories = {
  transient: ['超时', 'timeout'], environment: ['依赖', 'dependency'],
  method: ['适用条件', 'method'], evidence: ['证据', 'evidence'],
}
const products = ['SQLite', 'PostgreSQL', 'MySQL', 'Docker', 'Node.js', 'Python', 'OpenSSH', 'nginx', 'Apache', 'Redis', 'Windows', 'Linux']
const sources = ['personal', 'redteam', 'aboutsecurity', 'artex']
const text = value => redactCredentialText(String(value || '')).replace(/[\r\n\t]/g, ' ').slice(0, 160)

export function failureQueries(failure, productText = '') {
  const terms = categories[failure?.kind]
  if (!terms) return []
  // Emit only controlled diagnostic terms, not arbitrary error messages, hostnames or credentials.
  const code = String(failure.reason || '').match(/\b(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOENT|EACCES|ENOSPC|SQLITE_BUSY)\b/i)?.[1]?.toUpperCase()
  const product = products.find(value => String(productText).toLowerCase().includes(value.toLowerCase()))
  const queries = []
  if (code) queries.push({ term: code, weight: 5, basis: 'error-code' })
  queries.push({ term: terms[0], weight: 3, basis: 'failure-kind' })
  if (product) queries.push({ term: product, weight: 1, basis: 'recorded-product' })
  else queries.push({ term: terms[1], weight: 3, basis: 'failure-kind' })
  if (queries.length < 3) queries.push({ term: terms[1], weight: 3, basis: 'failure-kind' })
  return queries.slice(0, 3)
}

export function rankFailureReferences(results) {
  const ranked = new Map()
  for (const { query, groups } of results) {
    for (const group of groups.filter(group => group.available === true)) for (const item of group.items || []) {
      const source = group.source, id = String(item.id)
      if (!sources.includes(source) || !id || id === 'undefined') continue
      const key = JSON.stringify([source, id])
      let row = ranked.get(key)
      if (!row) {
        row = { reference: { source, id }, title: text(item.title), category: text(item.category), score: 0, matched_queries: [] }
        ranked.set(key, row)
      }
      if (!row.matched_queries.includes(query.term)) {
        row.score += query.weight
        row.matched_queries.push(query.term)
      }
    }
  }
  return [...ranked.values()].sort((a, b) => b.score - a.score
    || sources.indexOf(a.reference.source) - sources.indexOf(b.reference.source)
    || a.reference.id.localeCompare(b.reference.id, 'en', { numeric: true }))
}

export function searchFailureQueries(root, queries, options = {}) {
  const available = sources.filter(source => source !== 'personal' || existsSync(join(root, 'knowledge', 'personal.db')))
  let skillRows
  const settings = { ...options, sources: available,
    skills: () => (skillRows ??= (options.skills || listLocalSkills)({ home: options.home })) }
  const results = [], coverage = []
  for (const query of queries) {
    try {
      const result = (options.search || unifiedKnowledgeRequest)(root, { op: 'knowledgeUnifiedSearch', query: query.term }, settings)
      results.push({ query, groups: result.groups || [] })
      for (const group of result.groups || []) coverage.push({ query: query.term, source: group.source,
        status: group.available ? 'available' : group.error ? 'unavailable' : 'missing',
        returned: group.returned ?? (group.items || []).length, total: group.total ?? null,
        hasMore: group.hasMore ?? null })
    } catch { coverage.push({ query: query.term, source: 'all', status: 'unavailable', total: null, returned: 0, hasMore: null }) }
  }
  if (!available.includes('personal')) coverage.push({ source: 'personal', status: 'missing', total: null, returned: 0, hasMore: null })
  const ranked = rankFailureReferences(results)
  return { items: ranked.slice(0, 3), returned: Math.min(ranked.length, 3),
    candidates_returned: ranked.length, hasMore: ranked.length > 3, coverage }
}

export function failureKnowledge(store, engagement, taskKey, options = {}) {
  const base = { status: 'not-requested', verification_scope: 'historical-reference', items: [], returned: 0,
    note: '资料仅供排查与选择方法；命中、采纳或反馈不代表修复成功，不自动执行或解除重试限制。' }
  try {
    const db = store.db(engagement)
    const failure = options.attemptId
      ? db.prepare('SELECT * FROM task_failure WHERE task_key=? AND attempt_id=?').get(taskKey, options.attemptId)
      : db.prepare('SELECT * FROM task_failure WHERE task_key=? ORDER BY rowid DESC LIMIT 1').get(taskKey)
    if (!failure) return base
    const target = taskProgressTarget(taskKey)
    let assetId = target?.kind === 'asset' ? target.id : target?.kind === 'vuln'
      ? db.prepare('SELECT asset_id FROM vuln WHERE id=?').get(target.id)?.asset_id : null
    const asset = assetId == null ? null : store.getAsset(engagement, assetId)
    const productText = [...(asset?.ports || []).map(row => row.product), ...(asset?.fingerprints || []).map(row => row.product)].filter(Boolean).join(' ')
    const queries = failureQueries(failure, productText)
    const root = store.root
    if (!root || !queries.length) return { ...base, status: 'unavailable' }
    const result = searchFailureQueries(root, queries, options)
    return { ...base, ...result, status: result.returned ? 'references-found'
      : result.coverage.some(row => row.status === 'unavailable') ? 'partial-unavailable' : 'no-match',
    failure: { attempt_id: failure.attempt_id, kind: failure.kind },
    trigger: 'latest-recorded-failure', queries,
    query_digest: createHash('sha256').update(JSON.stringify([taskKey, failure.attempt_id, queries])).digest('hex'),
    next: '用 redteam_knowledge_get(source,id) 按需读取原文；采用前核对版本、适用条件与当前证据。' }
  } catch { return { ...base, status: 'unavailable' } }
}

export function recordKnowledgeFeedback(runs, args, options = {}) {
  runs.requireOwner()
  const attempt = runs.attempt(args.attempt_id)
  if (attempt.owner !== runs.owner) throw new Error('feedback belongs to a different root session')
  if (!['adopted', 'helpful', 'not-helpful', 'inconclusive'].includes(args.feedback)) throw new Error('invalid knowledge feedback')
  const hints = failureKnowledge(runs.store, runs.engagement, attempt.task_key, { ...options, attemptId: attempt.id })
  if (!hints.items.some(row => row.reference.source === args.reference_source && row.reference.id === args.reference_id)) {
    throw new Error('reference is not in current failure hints; retrieve again if knowledge changed')
  }
  runs.db.prepare(`INSERT INTO task_knowledge_feedback VALUES(?,?,?,?,?,?)
    ON CONFLICT(attempt_id,reference_source,reference_id) DO UPDATE SET
    feedback=excluded.feedback,query_digest=excluded.query_digest,updated_at=excluded.updated_at`)
    .run(attempt.id, args.reference_source, args.reference_id, args.feedback, hints.query_digest, new Date().toISOString())
  return { attempt_id: attempt.id, reference: { source: args.reference_source, id: args.reference_id },
    feedback: args.feedback, verification_scope: 'self-reported-usefulness' }
}
