import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  artexKnowledgePath, artexKnowledgeStatus, searchArtexKnowledge, getArtexKnowledge,
} from '../lib/artex-knowledge.js'
import { dispatch } from '../lib/redteam/store-core.js'

function knowledgeFixture(t, fts = true) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-purge-artkb-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const path = join(home, 'knowledge.db')
  const db = new DatabaseSync(path)
  db.exec("CREATE TABLE poc (id INTEGER PRIMARY KEY, title TEXT, category TEXT, kind TEXT, tags TEXT, verified INTEGER, description TEXT, usage TEXT, content TEXT)")
  db.prepare('INSERT INTO poc VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    101, 'Test component diagnostics', 'methodology', 'markdown', 'sample,component', 1,
    'Example notes', 'Read first', 'Local read-only sample body'
  )
  if (fts) {
    db.exec("CREATE VIRTUAL TABLE poc_fts USING fts5(poc_id UNINDEXED, title, content)")
    db.prepare('INSERT INTO poc_fts VALUES (?, ?, ?)').run(
      101, 'Test component diagnostics', 'Local read-only sample body')
  }
  db.close()
  return { path, env: { ARTEX_KB_DIR: home } }
}

test('ARTEX knowledge source is discovered from the exact configured directory', (t) => {
  const { path, env } = knowledgeFixture(t)
  assert.equal(artexKnowledgePath(env), path)
  assert.equal(artexKnowledgeStatus({ env }).count, 1)
  assert.equal(artexKnowledgeStatus({ env }).fts, true)
  assert.equal(artexKnowledgeStatus({ env }).read_only, true)
  const absent = artexKnowledgeStatus({ env: { ARTEX_KB_DIR: join(tmpdir(), 'missing-artkb') } })
  assert.equal(absent.available, false)
})

test('read-only FTS search and full entry lookup use the ARTEX poc schema', (t) => {
  const { env } = knowledgeFixture(t)
  const response = searchArtexKnowledge({ query: 'component diagnostics', limit: 5 }, { env })
  assert.equal(response.ok, true)
  assert.equal(response.degraded, false)
  assert.deepEqual(response.items.map(item => item.id), [101])
  assert.equal(response.items[0].verified, true)
  assert.equal(response.items[0].snippet, 'Local read-only sample body')
  const detail = getArtexKnowledge({ id: 101 }, { env })
  assert.equal(detail.item.content, 'Local read-only sample body')
  assert.equal(detail.item.usage, 'Read first')
  assert.equal(getArtexKnowledge({ id: 999 }, { env }).item, null)
  assert.equal(artexKnowledgeStatus({ env }).count, 1, 'search does not modify rows')
  assert.throws(() => getArtexKnowledge({ id: '../knowledge.db' }, { env }), /ID/)
})

test('missing FTS index falls back to literal text matching without changing the database', (t) => {
  const { env } = knowledgeFixture(t, false)
  const response = searchArtexKnowledge({ query: 'Example notes' }, { env })
  assert.equal(response.degraded, true)
  assert.equal(response.items[0].id, 101)
  assert.equal(artexKnowledgeStatus({ env }).fts, false)
})

test('knowledge bridge operations do not require selecting a DSH engagement', (t) => {
  const { env } = knowledgeFixture(t)
  const saved = process.env.ARTEX_KB_DIR
  process.env.ARTEX_KB_DIR = env.ARTEX_KB_DIR
  t.after(() => {
    if (saved === undefined) delete process.env.ARTEX_KB_DIR
    else process.env.ARTEX_KB_DIR = saved
  })
  const store = { activeEngagementId: () => null }
  assert.equal(dispatch(store, { op: 'artexKnowledgeStatus' }).count, 1)
  assert.equal(dispatch(store, { op: 'artexKnowledgeSearch', query: 'component' }).items[0].id, 101)
  assert.equal(dispatch(store, { op: 'artexKnowledgeGet', id: 101 }).item.title, 'Test component diagnostics')
})

test('Purge source and embedded runtime expose the same local knowledge UI', () => {
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /ARTEX 本地知识库 · 只读检索/)
    assert.match(source, /op: 'artexKnowledgeStatus'/)
    assert.match(source, /op: 'artexKnowledgeSearch'/)
    assert.match(source, /op: 'artexKnowledgeGet'/)
    assert.match(source, /kbDetail\.content/)
  }
})
