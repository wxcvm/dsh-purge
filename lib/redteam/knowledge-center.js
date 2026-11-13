import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { inspectKnowledgeCredentials } from './knowledge-credentials.js'

const fields = 'id,title,body,category,tags,source,favorite,created_at,updated_at'
const summary = 'id,title,category,tags,source,favorite,created_at,updated_at'
const clean = (value) => String(value ?? '').trim()

/** Personal documents are global to the local Purge data root, not a target. */
export function openKnowledgeDb(root) {
  const dir = join(root, 'knowledge')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(join(dir, 'personal.db'))
  try {
    db.exec(`PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS documents_recent ON documents(favorite DESC, updated_at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS document_history (
        revision_id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL,
        title TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL, tags TEXT NOT NULL,
        source TEXT NOT NULL, favorite INTEGER NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, saved_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_document ON document_history(document_id,revision_id DESC);
      CREATE TRIGGER IF NOT EXISTS knowledge_history_update BEFORE UPDATE OF title,body,category,tags,source,favorite ON documents
      WHEN OLD.title IS NOT NEW.title OR OLD.body IS NOT NEW.body OR OLD.category IS NOT NEW.category
        OR OLD.tags IS NOT NEW.tags OR OLD.source IS NOT NEW.source OR OLD.favorite IS NOT NEW.favorite
      BEGIN
        INSERT INTO document_history(document_id,title,body,category,tags,source,favorite,created_at,updated_at,saved_at)
        VALUES(OLD.id,OLD.title,OLD.body,OLD.category,OLD.tags,OLD.source,OLD.favorite,OLD.created_at,OLD.updated_at,NEW.updated_at);
      END;
      CREATE TRIGGER IF NOT EXISTS knowledge_history_delete AFTER DELETE ON documents
      BEGIN DELETE FROM document_history WHERE document_id=OLD.id; END;`)
    return db
  } catch (error) { db.close(); throw error }
}

export function knowledgeRequest(root, request, options = {}) {
  if (request.op === 'knowledgeInspect') return { ok: true, ...inspectKnowledgeCredentials(request.document) }
  const db = openKnowledgeDb(root)
  try {
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
      // Internal callers request only the metadata rows they will actually use.
      const limit = Number.isSafeInteger(options.listLimit) && options.listLimit > 0
        ? Math.min(options.listLimit, 50) : 50
      const items = db.prepare('SELECT ' + summary + ' FROM documents' + where + ' ORDER BY favorite DESC, updated_at DESC, id DESC LIMIT ? OFFSET ?').all(...args, limit, offset)
      const categories = options.includeCategories === false ? []
        : db.prepare("SELECT DISTINCT category FROM documents WHERE category<>'' ORDER BY category").all().map(r => r.category)
      return { ok: true, items, total, categories }
    }
    if (request.op === 'knowledgeGet') return { ok: true, item: get() }
    if (request.op === 'knowledgeInspectStored') return { ok: true, ...inspectKnowledgeCredentials(get()) }
    if (request.op === 'knowledgeCredentialAudit') {
      const documents = db.prepare('SELECT ' + fields + ' FROM documents').all()
      const history = db.prepare('SELECT * FROM document_history').all()
      const flagged = documents.filter(row => inspectKnowledgeCredentials(row).flagged).map(row => row.id)
      const historical = history.filter(row => inspectKnowledgeCredentials(row).flagged)
      return { ok: true, documents: documents.length, flagged_documents: flagged.length,
        document_ids: flagged, flagged_revisions: historical.length,
        history_document_ids: [...new Set(historical.map(row => row.document_id))] }
    }
    if (request.op === 'knowledgeHistory') {
      get()
      const items = db.prepare('SELECT revision_id,title,category,updated_at,saved_at FROM document_history WHERE document_id=? ORDER BY revision_id DESC').all(id)
      return { ok: true, items }
    }
    if (request.op === 'knowledgeHistoryGet' || request.op === 'knowledgeRestore') {
      get()
      const old = db.prepare('SELECT * FROM document_history WHERE document_id=? AND revision_id=?').get(id, Number(request.revision_id))
      if (!old) throw new Error('历史版本不存在')
      if (request.op === 'knowledgeHistoryGet') return { ok: true, item: old }
      db.prepare('UPDATE documents SET title=?,body=?,category=?,tags=?,source=?,favorite=?,updated_at=? WHERE id=?')
        .run(old.title,old.body,old.category,old.tags,old.source,old.favorite,new Date().toISOString(),id)
      return { ok: true, item: get() }
    }
    if (request.op === 'knowledgeExport') {
      const documents = db.prepare('SELECT ' + fields + ' FROM documents ORDER BY id').all()
      const history = db.prepare('SELECT * FROM document_history ORDER BY revision_id').all()
      return { ok: true, backup: { format: 'purge-knowledge-v1', exported_at: new Date().toISOString(), documents, history } }
    }
    if (request.op === 'knowledgeImport') {
      const records = request.documents
      if (!Array.isArray(records) || !records.length) throw new Error('没有可导入的文档')
      const validate = row => {
        if (!row || typeof row.title !== 'string' || !row.title.trim() || typeof row.body !== 'string') throw new Error('导入文档标题或正文无效')
        if (row.history != null && !Array.isArray(row.history)) throw new Error('历史版本格式无效')
        for (const old of row.history || []) {
          if (!old || typeof old.title !== 'string' || !old.title.trim() || typeof old.body !== 'string') throw new Error('历史版本内容无效')
        }
      }
      records.forEach(validate)
      const now = new Date().toISOString()
      const values = row => [clean(row.title),row.body,clean(row.category),clean(row.tags),clean(row.source),row.favorite === true || row.favorite === 1 ? 1 : 0]
      const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : now
      db.exec('BEGIN IMMEDIATE')
      try {
        const insert = db.prepare('INSERT INTO documents(title,body,category,tags,source,favorite,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        const revision = db.prepare('INSERT INTO document_history(document_id,title,body,category,tags,source,favorite,created_at,updated_at,saved_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        const ids = []
        for (const row of records) {
          const newId = Number(insert.run(...values(row),stamp(row.created_at),stamp(row.updated_at)).lastInsertRowid)
          ids.push(newId)
          for (const old of row.history || []) revision.run(newId,...values(old),stamp(old.created_at),stamp(old.updated_at),stamp(old.saved_at))
        }
        db.exec('COMMIT')
        return { ok: true, imported: ids.length, ids }
      } catch (error) { db.exec('ROLLBACK'); throw error }
    }
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
