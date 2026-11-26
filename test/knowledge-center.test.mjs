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

test('exact text re-import skips in the same transaction and preserves local favorites and history', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-knowledge-dedup-'))
  try {
    const call = (op, args = {}) => knowledgeRequest(root, { op, ...args })
    const note = { title: '交接', body: '备注\n', category: '导入文档', source: '交接.md' }
    const first = call('knowledgeImport', { documents: [note, note], skipExactDuplicate: true })
    assert.deepEqual(first, { ok: true, imported: 1, ids: [1], skipped: 1 })
    const item = call('knowledgeGet', { id: first.ids[0] }).item
    call('knowledgeSave', { ...item, favorite: true })
    const { documents, history } = call('knowledgeExport').backup
    assert.equal(documents[0].favorite, 1)
    assert.equal(history.length, 1)
    const duplicate = call('knowledgeImport', { documents: [{ ...note, source: ' 交接.md ' }], skipExactDuplicate: true })
    assert.deepEqual(duplicate, { ok: true, imported: 0, ids: [], skipped: 1 })
    const after = call('knowledgeExport').backup
    assert.deepEqual(after.documents, documents)
    assert.deepEqual(after.history, history)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('same title does not hide a content, source, category or tag difference', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-knowledge-distinct-'))
  try {
    const note = { title: '会议纪要', body: '正文', category: '资料', tags: '团队', source: '会议.txt' }
    const variants = [note, { ...note, title: '项目纪要' }, { ...note, body: '正文\n' },
      { ...note, category: '项目' }, { ...note, tags: '归档' }, { ...note, source: '会议.md' }]
    const result = knowledgeRequest(root, { op: 'knowledgeImport', documents: variants, skipExactDuplicate: true })
    assert.equal(result.imported, variants.length)
    assert.equal(result.skipped, 0)
    assert.equal(knowledgeRequest(root, { op: 'knowledgeList' }).total, variants.length)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('regular imports keep the original response and backup history is never deduplicated', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-knowledge-backup-'))
  try {
    const call = (op, args = {}) => knowledgeRequest(root, { op, ...args })
    const note = { title: '部署指南', body: '最新版', source: '部署.md' }
    assert.deepEqual(call('knowledgeImport', { documents: [note, note] }), { ok: true, imported: 2, ids: [1, 2] })
    const savedAt = '2026-10-15T00:00:00.000Z'
    const restore = call('knowledgeImport', {
      // Also safeguard an importer setting the text option on a backup row.
      skipExactDuplicate: true,
      documents: [{ ...note, history: [] }, { ...note, history: [{ ...note, body: '旧版', saved_at: savedAt }] }],
    })
    assert.deepEqual(restore, { ok: true, imported: 2, ids: [3, 4], skipped: 0 })
    const history = call('knowledgeHistory', { id: 4 }).items
    assert.equal(history.length, 1)
    assert.equal(history[0].saved_at, savedAt)
    assert.equal(call('knowledgeHistoryGet', { id: 4, revision_id: history[0].revision_id }).item.body, '旧版')
    assert.equal(call('knowledgeList').total, 4)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('preview never writes; confirmation keeps individual outcomes, provenance and history', async () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-knowledge-files-'))
  try {
    const call = (op, args = {}) => knowledgeRequest(root, { op, ...args })
    const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
    for (const label of ['导入预览', '确认导入', '取消导入', '导入结果']) assert.ok(source.includes(label))
    const start = source.indexOf('const importFiles = files =>')
    const end = source.indexOf('const exportBackup =', start)
    assert.ok(start >= 0 && end > start)
    const seen = []
    let batch, refreshes = 0
    const scope = {
      run: fn => fn(),
      confirmCredentials: async row => row.title !== '取消',
      request: async req => { seen.push(req); return knowledgeRequest(root, req) },
      setCredentialAudit() {}, setNotice() {},
      setImportBatch(value) { batch = value }, getImportBatch: () => batch,
      async refresh() { refreshes++ },
    }
    const { importFiles, confirm } = new Function(...Object.keys(scope), source.slice(start, end)
      .replace('importBatch.entries', 'getImportBatch().entries')
      + '\nreturn { importFiles, confirm: confirmImport }')(...Object.values(scope))
    const file = (name, content) => ({ name, async text() { return content } })
    const backup = (documents, history) => JSON.stringify({ format: 'purge-knowledge-v1', documents, history })
    const archived = { id: 17, title: '会议', body: '正文', category: '导入文档', source: '会议.MD', favorite: true }
    const history = { document_id: 17, title: '会议', body: '旧版', source: '旧笔记.md', saved_at: '2026-11-19T00:00:00.000Z' }
    const files = [file('会议.MD', '正文'), file('会议.MD', '正文'), file('取消.TXT', '不写入'),
      file('备份.json', backup([archived, { id: 18, title: '正文无效', body: 1 }], [history])),
      file('未对应.json', backup([archived], [{ ...history, document_id: 99 }])),
      file('重号.json', backup([archived, archived], [history])),
      file('invalid.csv', 'a,b')]
    await importFiles(files)
    assert.equal(batch.done, false)
    assert.deepEqual(batch.entries.map(e => e.status), ['ready', 'ready', 'ready', 'ready', 'ready', 'failed', 'failed', 'failed'])
    assert.equal(batch.entries[3].revisions, 1)
    assert.match(batch.entries[5].message, /找不到对应/)
    assert.match(batch.entries[6].message, /重复/)
    assert.equal(seen.length, 0)
    assert.equal(call('knowledgeList').total, 0)
    await confirm()
    assert.deepEqual(seen.map(r => r.skipExactDuplicate), [true, true, undefined, undefined])
    assert.equal(batch.done, true)
    assert.deepEqual(batch.entries.map(e => e.status), ['imported', 'skipped', 'cancelled', 'imported', 'failed', 'failed', 'failed', 'failed'])
    assert.ok(batch.entries.every(e => !('payload' in e)))
    assert.equal(refreshes, 1)
    assert.equal(call('knowledgeList').total, 2)
    const id = batch.entries[3].id
    assert.equal(call('knowledgeGet', { id }).item.favorite, 1)
    const [rev] = call('knowledgeHistory', { id }).items
    assert.equal(rev.saved_at, history.saved_at)
    const restored = call('knowledgeRestore', { id, revision_id: rev.revision_id }).item
    assert.equal(restored.body, '旧版')
    assert.equal(restored.source, history.source)
    assert.equal(call('knowledgeHistory', { id }).items.length, 2)
  } finally { rmSync(root, { recursive: true, force: true }) }
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
