/**
 * Read the ARTEX deployment's knowledge.db without copying it into Purge.
 * This adapter never opens ARTEX's HTTP API, starts a service or writes SQLite.
 */
import { DatabaseSync } from 'node:sqlite'
import { statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export function artexKnowledgeCandidates(env = process.env) {
  const explicit = String(env.ARTEX_KB_DIR || '').trim()
  if (explicit) return [resolve(explicit, 'knowledge.db')]
  const homes = [
    String(env.ARTEX_HOME || '').trim(),
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'ARTEX') : '',
  ].filter(Boolean)
  return [...new Set(homes.map(home => resolve(home, 'knowledge', 'knowledge.db')))]
}

function locateKnowledge(env) {
  let unusable = false
  for (const file of artexKnowledgeCandidates(env)) {
    try {
      if (statSync(file).isFile()) return { file, state: 'present' }
      unusable = true
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') unusable = true
    }
  }
  return { file: null, state: unusable ? 'unavailable' : 'missing' }
}

export function artexKnowledgePath(env = process.env) {
  return locateKnowledge(env).file
}

function withKnowledge(options, read, file = artexKnowledgePath(options.env || process.env)) {
  if (!file) return null
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'poc'").get()) {
      throw new Error('ARTEX 知识库缺少 poc 表')
    }
    // A table name alone does not establish that search and detail queries can run.
    db.prepare('SELECT id, title, category, kind, tags, verified, description, usage, content FROM poc LIMIT 0')
    return read(db)
  } finally {
    db.close()
  }
}

export function artexKnowledgeStatus(options = {}) {
  const { file, state } = locateKnowledge(options.env || process.env)
  const source = { source: 'local-artex-knowledge', read_only: true }
  if (state === 'missing') return {
    ...source, ok: true, available: false, state, count: 0, fts: false,
    note: '未找到 knowledge.db；可设置 ARTEX_KB_DIR 或 ARTEX_HOME 指向本机知识库目录。',
  }
  const unavailable = (error) => ({
    ...source, ok: false, available: false, state: 'unavailable', count: null, fts: null, error,
  })
  if (!file) return unavailable('ARTEX 知识库路径不可访问或不是普通文件。')
  try {
    return withKnowledge(options, (db) => {
      const count = db.prepare('SELECT count(*) AS total FROM poc').get().total
      return {
        ...source, ok: true, available: true, state: count === 0 ? 'empty' : 'ready', count,
        fts: !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'poc_fts'").get(),
      }
    }, file)
  } catch {
    return unavailable('无法读取 ARTEX 知识库；请检查文件权限、SQLite 格式及 poc 表结构。')
  }
}

function searchRows(db, sql, args) {
  return db.prepare(sql).all(...args).map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    kind: row.kind,
    tags: row.tags,
    verified: !!row.verified,
    snippet: row.snippet,
  }))
}

const searchColumns = "p.id, p.title, IFNULL(p.category,'') AS category, IFNULL(p.kind,'') AS kind, IFNULL(p.tags,'') AS tags, IFNULL(p.verified,0) AS verified, substr(IFNULL(p.content,''),1,240) AS snippet"

export function searchArtexKnowledge(request = {}, options = {}) {
  const q = typeof request.query === 'string' ? request.query.trim() : ''
  if (!q) throw new Error('请输入知识库搜索关键词')
  const limit = Number.isSafeInteger(request.limit) && request.limit > 0
    ? Math.min(request.limit, 30) : 10
  const result = withKnowledge(options, (db) => {
    const fts = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'poc_fts'").get()
    if (fts) {
      const terms = q.replace(/"/g, ' ').split(/\s+/).filter(Boolean)
      for (const op of [' AND ', ' OR ']) {
        const query = terms.map(term => '"' + term + '"').join(op)
        try {
          const found = searchRows(db,
            'SELECT ' + searchColumns + ' FROM poc_fts f JOIN poc p ON p.id = f.poc_id WHERE poc_fts MATCH ? ORDER BY rank LIMIT ?',
            [query, limit])
          if (found.length) return { ok: true, available: true, items: found, degraded: false, read_only: true }
        } catch { /* a malformed FTS query falls back to the ordinary index */ }
      }
    }
    const found = searchRows(db,
      'SELECT ' + searchColumns + ' FROM poc p WHERE instr(lower(p.title),lower(?)) > 0 OR instr(lower(IFNULL(p.description,\'\')),lower(?)) > 0 OR instr(lower(IFNULL(p.tags,\'\')),lower(?)) > 0 OR instr(lower(IFNULL(p.content,\'\')),lower(?)) > 0 ORDER BY p.id LIMIT ?',
      [q, q, q, q, limit])
    return { ok: true, available: true, items: found, degraded: true, read_only: true }
  })
  if (!result) throw new Error('未找到 ARTEX 本地知识库')
  return result
}

export function getArtexKnowledge(request = {}, options = {}) {
  const id = request.id
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('知识条目 ID 无效')
  const result = withKnowledge(options, (db) => {
    const item = db.prepare(
      "SELECT id, title, IFNULL(category,'') AS category, IFNULL(kind,'') AS kind, IFNULL(tags,'') AS tags, IFNULL(verified,0) AS verified, IFNULL(usage,'') AS usage, IFNULL(content,'') AS content FROM poc WHERE id = ?"
    ).get(id)
    return { ok: true, available: true,
      item: item ? { ...item, verified: !!item.verified } : null,
      read_only: true }
  })
  if (!result) throw new Error('未找到 ARTEX 本地知识库')
  return result
}
