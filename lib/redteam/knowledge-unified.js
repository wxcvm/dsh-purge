import { knowledgeRequest } from './knowledge-center.js'
import { listBundledKnowledge, getBundledKnowledge } from './knowledge-bundled.js'
import { loadCveCatalog } from './cve-knowledge.js'
import { listLocalSkills, readLocalSkill } from './skill-catalog.js'
import { artexKnowledgeStatus, searchArtexKnowledge, getArtexKnowledge } from '../artex-knowledge.js'

export const knowledgeSources = ['bundled', 'personal', 'cve', 'redteam', 'aboutsecurity', 'artex']
const limit = 20
const matches = (q, ...values) => values.flat(Infinity).filter(v => v != null).join(' ').toLowerCase().includes(q)
const cveItem = (row, index) => ({
  id: String(index), title: row.title || '', category: row.category || '',
  description: [row.product, ...(row.cve || [])].filter(Boolean).join(' · '),
  source_url: row.source_url || '', verified: false,
})
const skillItem = s => ({ id: s.key, title: s.title, category: s.source, description: s.description || s.name })
const artexItem = r => ({ id: String(r.id), title: r.title, category: r.category, description: r.tags || '', verified: r.verified })

/** Federated read-only search. Sources keep their own storage and ranking. */
export function unifiedKnowledgeRequest(root, request, options = {}) {
  const sources = options.sources || knowledgeSources
  const source = request.source || 'all'
  if (source !== 'all' && !sources.includes(source)) throw new Error('未知知识来源')
  const catalog = options.catalog || loadCveCatalog
  const skills = options.skills || listLocalSkills
  const artexStatus = options.artexStatus || artexKnowledgeStatus
  const artexSearch = options.artexSearch || searchArtexKnowledge
  const artexGet = options.artexGet || getArtexKnowledge
  if (request.op === 'knowledgeUnifiedGet') {
    const id = request.id
    if (source === 'bundled') return { ok: true, item: getBundledKnowledge(id) }
    if (source === 'personal') {
      const r = knowledgeRequest(root, { op: 'knowledgeGet', id })
      return { ok: true, item: { ...r.item, body: r.item.body, origin: source } }
    }
    if (source === 'cve') {
      const index = Number(id)
      const row = Number.isSafeInteger(index) && index >= 0 ? catalog()[index] : null
      if (!row) throw new Error('CVE 条目不存在')
      return { ok: true, item: { ...cveItem(row, index), origin: source,
        body: ['产品：' + (row.product || '未知'), 'CVE：' + (row.cve || []).join(', '), '等级：' + (row.severity || '未知'),
          '影响版本：' + JSON.stringify(row.versions || []), '参考来源：' + (row.source_url || '未知'), '索引候选，不代表目标已验证。'].join('\n') } }
    }
    if (source === 'redteam' || source === 'aboutsecurity') {
      const row = skills({ home: options.home }).find(s => s.source === source && s.key === id)
      if (!row) throw new Error('技能不存在')
      const detail = (options.readSkill || readLocalSkill)(id, { home: options.home, maxChars: 100000 })
      return { ok: true, item: { ...skillItem(row), origin: source, body: detail.content, truncated: detail.truncated } }
    }
    if (source === 'artex') {
      const r = artexGet({ id: Number(id) }, { env: options.env })
      if (!r.item) throw new Error('ARTEX 条目不存在')
      return { ok: true, item: { ...artexItem(r.item), origin: source, body: r.item.content, usage: r.item.usage } }
    }
    throw new Error('请选择知识来源')
  }
  if (request.op !== 'knowledgeUnifiedSearch') throw new Error('未知统一检索操作')
  const query = String(request.query || '').trim()
  if (!query && source !== 'bundled') return { ok: true, groups: [] }
  const q = query.toLowerCase()
  const groups = []
  // Both skill sources share one filesystem catalog per request, never a stale global cache.
  let skillRows
  const getSkills = () => (skillRows ??= skills({ home: options.home }))
  for (const origin of sources.filter(s => source === 'all' || s === source)) {
    try {
      let items = [], total = null, available = true, note = ''
      if (origin === 'bundled') {
        const rows = listBundledKnowledge(query, String(request.category || ''))
        total = rows.length
        items = rows.slice(0, limit)
        note = '随 Purge 安装 · 离线可读 · 不占用个人资料库'
      } else if (origin === 'personal') {
        const r = knowledgeRequest(root, { op: 'knowledgeList', query }, { listLimit: limit, includeCategories: false })
        items = r.items.map(row => ({ id: String(row.id), title: row.title, category: row.category, description: row.tags, favorite: !!row.favorite }))
        total = r.total
      } else if (origin === 'cve') {
        const rows = catalog().map((row, index) => ({ row, index })).filter(({ row }) =>
          matches(q, row.title, row.product, row.cve, row.keywords, row.category, row.severity))
        total = rows.length
        items = rows.slice(0, limit).map(({ row, index }) => cveItem(row, index))
      } else if (origin === 'redteam' || origin === 'aboutsecurity') {
        const rows = getSkills().filter(s => s.source === origin)
        available = origin !== 'aboutsecurity' || rows.length > 0
        if (!available) note = '未安装 AboutSecurity 技能库'
        const found = rows.filter(s => matches(q, s.title, s.name, s.key, s.description))
        total = found.length
        items = found.slice(0, limit).map(skillItem)
      } else if (origin === 'artex') {
        const status = artexStatus({ env: options.env })
        available = status.available
        if (status.ok === false || status.state === 'unavailable') {
          throw new Error(status.error || 'ARTEX 知识库不可用')
        }
        if (!available) note = status.note || '未找到 ARTEX 本地知识库'
        else if (status.state === 'empty') {
          total = 0
          note = 'ARTEX 知识库为空'
        } else {
          const r = artexSearch({ query, limit }, { env: options.env })
          items = r.items.map(artexItem)
          note = r.degraded ? '字面检索' : '全文索引检索'
        }
      }
      const page = items.slice(0, limit)
      groups.push({ source: origin, available, total, items: page, returned: page.length,
        hasMore: total == null ? null : total > page.length, note })
    } catch (error) {
      groups.push({ source: origin, available: false, total: null, items: [], returned: 0, hasMore: null,
        error: String(error.message || error) })
    }
  }
  return { ok: true, groups }
}
