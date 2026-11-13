import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const fields = 'id,title,body,category,tags,source,favorite,created_at,updated_at'
const summary = 'id,title,category,tags,source,favorite,created_at,updated_at'
const clean = (value) => String(value ?? '').trim()

/** Personal documents are global to the local Purge data root, not a target. */
export function knowledgeRequest(root, request) {
  const dir = join(root, 'knowledge')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(join(dir, 'personal.db'))
  try {
    db.exec(`PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS documents_recent ON documents(favorite DESC, updated_at DESC, id DESC);`)
    const id = Number(request.id)
    const get = () => {
      const row = db.prepare('SELECT ' + fields + ' FROM documents WHERE id=?').get(id)
      if (!row) throw new Error('知识条目不存在')
      return row
    }
    if (request.op === 'knowledgeList') {
      const q = clean(request.query).toLowerCase()
      const category = clean(request.category)
      const favorite = request.favorite === true ? 1 : 0
      const offset = Math.max(0, Math.floor(Number(request.offset) || 0))
      const where = " WHERE (?='' OR category=?) AND (?=0 OR favorite=1) AND (?='' OR instr(lower(title || ' ' || body || ' ' || category || ' ' || tags || ' ' || source),?)>0)"
      const args = [category, category, favorite, q, q]
      const total = db.prepare('SELECT count(*) AS n FROM documents' + where).get(...args).n
      const items = db.prepare('SELECT ' + summary + ' FROM documents' + where + ' ORDER BY favorite DESC, updated_at DESC, id DESC LIMIT 50 OFFSET ?').all(...args, offset)
      const categories = db.prepare("SELECT DISTINCT category FROM documents WHERE category<>'' ORDER BY category").all().map(r => r.category)
      return { ok: true, items, total, categories }
    }
    if (request.op === 'knowledgeGet') return { ok: true, item: get() }
    if (request.op === 'knowledgeSave') {
      const title = clean(request.title)
      if (!title) throw new Error('请输入标题')
      const now = new Date().toISOString()
      const values = [title, String(request.body ?? ''), clean(request.category), clean(request.tags), clean(request.source), request.favorite === true ? 1 : 0]
      let savedId
      if (request.id != null) {
        get()
        db.prepare('UPDATE documents SET title=?,body=?,category=?,tags=?,source=?,favorite=?,updated_at=? WHERE id=?').run(...values, now, id)
        savedId = id
      } else {
        savedId = Number(db.prepare('INSERT INTO documents(title,body,category,tags,source,favorite,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(...values, now, now).lastInsertRowid)
      }
      return { ok: true, item: db.prepare('SELECT ' + fields + ' FROM documents WHERE id=?').get(savedId) }
    }
    if (request.op === 'knowledgeDelete') {
      get()
      db.prepare('DELETE FROM documents WHERE id=?').run(id)
      return { ok: true }
    }
    throw new Error('未知知识库操作')
  } finally { db.close() }
}
