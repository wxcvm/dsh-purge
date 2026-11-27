/**
 * 武器库索引（AboutSecurity 离线仓库导入物）。
 *
 * payloads.json / dictionaries.json 由 scripts/import-armory.mjs 生成：
 * 只含索引（分类、文件名、路径、行数、用途、标签），文件本体保留在
 * 本地 AboutSecurity 仓库——本模块只读索引、给出路径，不复制内容。
 * 纯离线、零网络、零执行。
 */
import { readFileSync } from 'node:fs'

function loadJson(file) {
  return JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
}

let payloadCache
export function loadPayloadIndex() {
  payloadCache ??= loadJson('./armory/payloads.json')
  return payloadCache
}

let dictCache
export function loadDictionaryIndex() {
  dictCache ??= loadJson('./armory/dictionaries.json')
  return dictCache
}

const norm = (s) => String(s || '').toLowerCase()

/** 按关键词搜 payload：分类、文件名、描述、用法、标签全匹配。 */
export function searchPayloads(query, { limit = 20 } = {}) {
  const data = loadPayloadIndex()
  const terms = String(query || '').toLowerCase().split(/[\s,，]+/).filter(Boolean)
  const rows = []
  for (const group of data.groups || []) {
    for (const file of group.files || []) {
      const text = norm([group.category, file.name, file.description, file.usage, file.tags].join(' '))
      let score = 0
      for (const term of terms) {
        if (norm(file.name).includes(term)) score += 30
        else if (norm(group.category).includes(term)) score += 15
        else if (text.includes(term)) score += 8
      }
      if (terms.length === 0 || score > 0) rows.push({ score: terms.length ? score : 1, group: group.category, ...file })
    }
  }
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const take = Math.max(1, Math.min(50, Number(limit) || 20))
  return { total: rows.length, count: Math.min(rows.length, take), source: data.source, items: rows.slice(0, take) }
}

/** 按关键词搜字典：同上。 */
export function searchDictionaries(query, { limit = 20 } = {}) {
  const data = loadDictionaryIndex()
  const terms = String(query || '').toLowerCase().split(/[\s,，]+/).filter(Boolean)
  const rows = []
  for (const group of data.groups || []) {
    for (const file of group.files || []) {
      const text = norm([group.category, file.name, file.description, file.usage, file.tags].join(' '))
      let score = 0
      for (const term of terms) {
        if (norm(file.name).includes(term)) score += 30
        else if (norm(group.category).includes(term)) score += 15
        else if (text.includes(term)) score += 8
      }
      if (terms.length === 0 || score > 0) rows.push({ score: terms.length ? score : 1, group: group.category, ...file })
    }
  }
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const take = Math.max(1, Math.min(50, Number(limit) || 20))
  return { total: rows.length, count: Math.min(rows.length, take), source: data.source, items: rows.slice(0, take) }
}

/** 武器库总览：组数、文件数（面板/探针用）。 */
export function armoryStats() {
  const p = loadPayloadIndex()
  const d = loadDictionaryIndex()
  return {
    payload_groups: (p.groups || []).length,
    payload_files: (p.groups || []).reduce((n, g) => n + (g.files || []).length, 0),
    dictionary_groups: (d.groups || []).length,
    dictionary_files: (d.groups || []).reduce((n, g) => n + (g.files || []).length, 0),
    source: p.source,
  }
}
