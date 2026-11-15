import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { knowledgeRequest } from '../lib/redteam/knowledge-center.js'

test('personal knowledge persists, searches Chinese text, filters and edits independently of targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-knowledge-'))
  try {
    const call = (op, args = {}) => knowledgeRequest(root, { op, ...args })
    assert.equal(call('knowledgeList').total, 0)
    const a = call('knowledgeSave', { title: '部署笔记', body: '本地配置 中文全文', category: '文档', tags: 'SQLite', source: 'https://example.org', favorite: true }).item
    call('knowledgeSave', { title: 'other', body: 'plain' })
    assert.equal(call('knowledgeList', { query: '中文' }).items[0].id, a.id)
    assert.equal(call('knowledgeList', { query: 'sqlite', favorite: true, category: '文档' }).total, 1)
    assert.equal(call('knowledgeList', { query: "' OR 1=1 --" }).total, 0)
    assert.equal(call('knowledgeList').items[0].body, undefined)
    assert.equal(call('knowledgeGet', { id: a.id }).item.body, '本地配置 中文全文')
    assert.equal(call('knowledgeSave', { ...a, title: '修改', favorite: false }).item.id, a.id)
    assert.equal(call('knowledgeList', { favorite: true }).total, 0)
    assert.throws(() => call('knowledgeSave', { title: ' ' }), /标题/)
    assert.throws(() => call('knowledgeSave', { id: 999, title: 'x' }), /不存在/)
    call('knowledgeDelete', { id: a.id })
    assert.throws(() => call('knowledgeGet', { id: a.id }), /不存在/)
    assert.equal(call('knowledgeList').total, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('knowledge page and authorized bridge are wired into generated client', () => {
  const src = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const generated = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const ui = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  for (const text of [src, generated]) {
    assert.ok(text.includes("['knowledge-center', '技能与知识库']"))
    assert.ok(text.includes("else if (st.tab === 'knowledge-center' || st.tab === 'skills') body = h(LibraryTab,"))
    assert.ok(text.includes("page('knowledge', h(KnowledgeCenterTab, { embeddedLibrary: true }))"))
    assert.ok(text.includes("h(UnifiedKnowledgeTab, { initialSource: 'bundled' })"))
  }
  const auth = ui.indexOf('const bridgeAuth = authorizeBridgeRequest(req)')
  const route = ui.indexOf("['knowledgeList', 'knowledgeGet', 'knowledgeSave', 'knowledgeDelete',")
  assert.ok(auth >= 0 && route > auth)
  for (const op of ['knowledgeHistory', 'knowledgeHistoryGet', 'knowledgeRestore', 'knowledgeExport', 'knowledgeImport']) {
    assert.ok(ui.slice(route, ui.indexOf('sendJson(res, 200, knowledgeRequest', route)).includes("'" + op + "'"), op)
  }
})

test('internal knowledge list limits preserve totals, ranking and the default UI page', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-knowledge-page-'))
  try {
    for (let i = 0; i < 55; i++) knowledgeRequest(root, { op: 'knowledgeSave', title: 'reference ' + i, body: 'body', category: 'docs', favorite: i === 0 })
    const request = { op: 'knowledgeList', query: 'reference' }
    const full = knowledgeRequest(root, request)
    const small = knowledgeRequest(root, request, { listLimit: 3, includeCategories: false })
    assert.equal(full.total, 55)
    assert.equal(full.items.length, 50)
    assert.deepEqual(full.categories, ['docs'])
    assert.equal(small.total, 55)
    assert.deepEqual(small.items, full.items.slice(0, 3))
    assert.deepEqual(small.categories, [])
    assert.deepEqual(knowledgeRequest(root, { ...request, offset: 3 }, { listLimit: 3 }).items, full.items.slice(3, 6))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
