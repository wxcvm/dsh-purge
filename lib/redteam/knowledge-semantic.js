import { request as httpRequest } from 'node:http'
import { openKnowledgeDb } from './knowledge-center.js'

const DEFAULT_MODEL = 'text-embedding-nomic-embed-text-v1.5'
const CHUNK_SIZE = 900
const OVERLAP = 120
const BATCH = 8

function config(env = process.env) {
  const port = Number(env.PURGE_EMBEDDING_PORT || 1234)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PURGE_EMBEDDING_PORT 无效')
  const model = String(env.PURGE_EMBEDDING_MODEL || DEFAULT_MODEL).trim()
  if (!model) throw new Error('嵌入模型名称为空')
  return { port, model, key: JSON.stringify([port, model, 'chunks-v1']) }
}

function openIndex(root) {
  const db = openKnowledgeDb(root)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_chunks (
        document_id INTEGER NOT NULL, index_key TEXT NOT NULL, chunk_no INTEGER NOT NULL,
        start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, vector TEXT NOT NULL,
        PRIMARY KEY(document_id,index_key,chunk_no)
      );
      CREATE INDEX IF NOT EXISTS semantic_index_key ON semantic_chunks(index_key);
      CREATE TRIGGER IF NOT EXISTS semantic_invalidate_update AFTER UPDATE OF title,body ON documents
      WHEN OLD.title IS NOT NEW.title OR OLD.body IS NOT NEW.body
      BEGIN DELETE FROM semantic_chunks WHERE document_id=OLD.id; END;
      CREATE TRIGGER IF NOT EXISTS semantic_invalidate_delete AFTER DELETE ON documents
      BEGIN DELETE FROM semantic_chunks WHERE document_id=OLD.id; END;
    `)
    return db
  } catch (error) { db.close(); throw error }
}

function usingDb(root, fn) {
  const db = openIndex(root)
  try { return fn(db) } finally { db.close() }
}

function chunks(body) {
  const chars = Array.from(body)
  const result = []
  for (let start = 0; start < chars.length || !result.length; start += CHUNK_SIZE - OVERLAP) {
    const end = Math.min(start + CHUNK_SIZE, chars.length)
    result.push({ start, end, text: chars.slice(start, end).join('') })
    if (end === chars.length) break
  }
  return result
}

function normalize(vector) {
  if (!Array.isArray(vector) || !vector.length || vector.length > 16384 ||
      vector.some(x => typeof x !== 'number' || !Number.isFinite(x))) throw new Error('嵌入向量格式无效')
  const norm = Math.hypot(...vector)
  if (!Number.isFinite(norm) || norm === 0) throw new Error('嵌入向量范数无效')
  return vector.map(x => x / norm)
}

/** Direct loopback connection; no proxy, arbitrary URL or remote fallback. */
function localEmbeddings(input, cfg) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: cfg.model, input })
    const req = httpRequest({ hostname: '127.0.0.1', port: cfg.port, path: '/v1/embeddings', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      const parts = []
      let size = 0
      res.on('data', chunk => {
        size += chunk.length
        if (size > 16 * 1024 * 1024) { res.destroy(new Error('嵌入响应过大')); return }
        parts.push(chunk)
      })
      res.on('error', reject)
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw new Error('本地嵌入接口 HTTP ' + res.statusCode + '，请检查 LM Studio 模型与服务')
          const result = JSON.parse(Buffer.concat(parts).toString('utf8'))
          if (!Array.isArray(result.data) || result.data.length !== input.length) throw new Error('嵌入响应条目数量不匹配')
          const ordered = [...result.data].sort((a,b) => a.index-b.index)
          if (ordered.some((row,i) => row.index !== i)) throw new Error('嵌入响应索引无效')
          resolve(ordered.map(row => row.embedding))
        } catch (error) { reject(error) }
      })
    })
    req.setTimeout(30000, () => req.destroy(new Error('本地嵌入接口超时')))
    req.on('error', error => reject(new Error('本地嵌入服务不可用：' + error.message)))
    req.end(body)
  })
}

async function embedTexts(texts, cfg, options, query = false) {
  const prefix = cfg.model.toLowerCase().includes('nomic-embed-text') ? (query ? 'search_query: ' : 'search_document: ') : ''
  const result = []
  for (let i=0; i<texts.length; i+=BATCH) {
    const input = texts.slice(i,i+BATCH).map(text => prefix + text)
    const vectors = await (options.embed || localEmbeddings)(input, cfg)
    if (!Array.isArray(vectors) || vectors.length !== input.length) throw new Error('嵌入响应条目数量不匹配')
    for (const vector of vectors) {
      const normalized = normalize(vector)
      if (result.length && normalized.length !== result[0].length) throw new Error('嵌入维度不一致')
      result.push(normalized)
    }
  }
  return result
}

function status(root, cfg) {
  return usingDb(root, db => {
    const total = db.prepare('SELECT count(*) AS n FROM documents').get().n
    const indexed = db.prepare('SELECT count(DISTINCT document_id) AS n FROM semantic_chunks WHERE index_key=?').get(cfg.key).n
    const pending = db.prepare('SELECT id,title FROM documents d WHERE NOT EXISTS (SELECT 1 FROM semantic_chunks s WHERE s.document_id=d.id AND s.index_key=?) ORDER BY id LIMIT 20').all(cfg.key)
    return { ok: true, model: cfg.model, endpoint: 'http://127.0.0.1:' + cfg.port + '/v1/embeddings', total, indexed, pending }
  })
}

export async function semanticKnowledgeRequest(root, request, options = {}) {
  const cfg = config(options.env)
  if (request.op === 'knowledgeSemanticStatus') return status(root, cfg)
  if (request.op === 'knowledgeSemanticIndex') {
    const id = Number(request.id)
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('知识条目 ID 无效')
    const doc = usingDb(root, db => db.prepare('SELECT id,title,body FROM documents WHERE id=?').get(id))
    if (!doc) throw new Error('知识条目不存在')
    const parts = chunks(doc.body)
    const vectors = await embedTexts(parts.map(p => doc.title + '\n' + p.text), cfg, options)
    usingDb(root, db => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const current = db.prepare('SELECT title,body FROM documents WHERE id=?').get(id)
        if (!current || current.title !== doc.title || current.body !== doc.body) throw new Error('文档已变更，请重新建立索引')
        db.prepare('DELETE FROM semantic_chunks WHERE document_id=? AND index_key=?').run(id,cfg.key)
        const insert = db.prepare('INSERT INTO semantic_chunks VALUES (?,?,?,?,?,?)')
        parts.forEach((p,i) => insert.run(id,cfg.key,i,p.start,p.end,JSON.stringify(vectors[i])))
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
    })
    return { ...status(root,cfg), id, chunks: parts.length }
  }
  if (request.op !== 'knowledgeSemanticSearch') throw new Error('未知语义检索操作')
  const query = String(request.query || '').trim()
  if (!query) throw new Error('请输入语义检索关键词')
  const before = status(root,cfg)
  if (!before.indexed) return { ...before, items: [], note: '尚未建立当前模型的文档索引' }
  const [needle] = await embedTexts([query],cfg,options,true)
  return usingDb(root, db => {
    const rows = db.prepare('SELECT s.document_id,s.start_offset,s.end_offset,s.vector,d.title,d.category,d.source FROM semantic_chunks s JOIN documents d ON d.id=s.document_id WHERE s.index_key=?').all(cfg.key)
    const best = new Map()
    for (const row of rows) {
      const vector = JSON.parse(row.vector)
      if (vector.length !== needle.length) throw new Error('模型维度变化，请重新建立索引')
      const score = vector.reduce((sum,value,i) => sum + value*needle[i],0)
      if (!best.has(row.document_id) || best.get(row.document_id).score < score) best.set(row.document_id, {...row,score})
    }
    const items = [...best.values()].sort((a,b) => b.score-a.score || a.document_id-b.document_id).slice(0,10).map(row => {
      const doc = db.prepare('SELECT body FROM documents WHERE id=?').get(row.document_id)
      return { id: String(row.document_id), title: row.title, category: row.category, source: row.source,
        score: row.score, snippet: Array.from(doc.body).slice(row.start_offset, Math.min(row.end_offset,row.start_offset+320)).join(''),
        reference: { source: 'personal', id: String(row.document_id) } }
    })
    return { ok: true, model: cfg.model, indexed: best.size, items }
  })
}
