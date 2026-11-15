import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const expected = JSON.parse(readFileSync(new URL('./fixtures/tool-surface.json', import.meta.url), 'utf8'))

test('reviewed tool names match source declarations and actual registrations', async (t) => {
  const source = readFileSync(new URL('../lib/redteam/tools.js', import.meta.url), 'utf8')
  const declared = [...source.matchAll(/name:\s*'(redteam_[a-z0-9_]+)'/g)].map(match => match[1]).sort()
  assert.deepEqual(declared, expected)
  const docs = readFileSync(new URL('../docs/drill-tools-reference.md', import.meta.url), 'utf8')
  for (const name of expected) {
    assert.ok(docs.includes('`' + name + '`'), `missing documentation for ${name}`)
  }

  const home = mkdtempSync(join(tmpdir(), 'purge-tool-surface-'))
  const previousHome = process.env.DSH_HOME
  const previousKBDir = process.env.ARTEX_KB_DIR
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousKBDir === undefined) delete process.env.ARTEX_KB_DIR
    else process.env.ARTEX_KB_DIR = previousKBDir
    rmSync(home, { recursive: true, force: true })
  })
  const moduleDir = join(home, 'node_modules', '@deepseek-ai', 'dsh-tools')
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{}')
  writeFileSync(join(moduleDir, 'package.json'), '{"name":"@deepseek-ai/dsh-tools","main":"index.js"}')
  writeFileSync(join(moduleDir, 'index.js'), 'exports.defineTool = spec => spec\n')
  process.env.DSH_HOME = home
  const knowledgeDir = join(home, 'artkb')
  mkdirSync(knowledgeDir, { recursive: true })
  const kb = new DatabaseSync(join(knowledgeDir, 'knowledge.db'))
  kb.exec(`
    CREATE TABLE poc (
      id INTEGER PRIMARY KEY, title TEXT, category TEXT, kind TEXT, tags TEXT,
      verified INTEGER, description TEXT, usage TEXT, content TEXT
    );
    INSERT INTO poc VALUES (
      17, 'Example system audit', 'methodology', 'markdown', 'example', 1,
      'Reference note', 'Read locally', 'No commands were executed'
    );
  `)
  kb.close()
  process.env.ARTEX_KB_DIR = knowledgeDir

  const { apply } = await import('../lib/redteam/tools.js')
  const registered = new Map()
  const ctx = {
    redteam: { root: home, listEngagements: () => [], dataQuality: id => ({ missing_evidence: 2, target: id }) },
    tools: { register(tool) {
      assert.ok(!registered.has(tool.name), `duplicate tool registration: ${tool.name}`)
      registered.set(tool.name, tool)
    } },
    on: () => () => {},
    effect: attach => { const dispose = attach(); t.after(() => dispose?.()) },
  }
  apply(ctx)
  assert.deepEqual([...registered.keys()].sort(), expected)
  const quality = registered.get('redteam_data_quality')
  const read = JSON.parse(await quality.execute({ engagement: 'fixture' }, {}))
  assert.deepEqual(read, {
    ok: true, engagement: 'fixture', quality: { missing_evidence: 2, target: 'fixture' },
  })
  const noTarget = JSON.parse(await quality.execute({}, {}))
  assert.equal(noTarget.ok, false)

  const { knowledgeRequest } = await import('../lib/redteam/knowledge-center.js')
  const saved = knowledgeRequest(home, { op: 'knowledgeSave', title: 'Example personal note', body: 'LOCAL_REFERENCE_BODY' }).item
  const unifiedSearch = registered.get('redteam_knowledge_search')
  const unifiedGet = registered.get('redteam_knowledge_get')
  const results = JSON.parse(await unifiedSearch.execute({ query: 'Example', source: 'personal' }))
  assert.equal(results.ok, true)
  assert.deepEqual(results.groups[0].items[0].reference, { source: 'personal', id: String(saved.id) })
  assert.equal(JSON.stringify(results).includes('LOCAL_REFERENCE_BODY'), false)
  const local = JSON.parse(await unifiedGet.execute({ source: 'personal', id: String(saved.id), max_chars: 5 }))
  assert.equal(local.ok, true)
  assert.equal(local.item.body, 'LOCAL')
  assert.equal(local.item.truncated, true)
  const full = JSON.parse(await unifiedGet.execute({ source: 'personal', id: String(saved.id) }))
  assert.equal(full.item.body, 'LOCAL_REFERENCE_BODY')
  assert.equal(full.item.truncated, false)
  assert.equal(JSON.parse(await unifiedSearch.execute({ query: '' })).ok, false)
  const bundledFirst = JSON.parse(await unifiedSearch.execute({ source: 'bundled' }))
  const bundledNext = JSON.parse(await unifiedSearch.execute({ source: 'bundled', offset: 20 }))
  assert.equal(bundledFirst.ok, true)
  assert.equal(bundledFirst.groups[0].hasMore, true)
  assert.equal(bundledNext.groups[0].offset, 20)
  assert.ok(bundledNext.groups[0].items.length > 0)
  const filtered = JSON.parse(await unifiedSearch.execute({ source: 'bundled', category: 'AI 运行时' }))
  assert.ok(filtered.groups[0].items.length > 0)
  assert.ok(filtered.groups[0].items.every(item => item.category === 'AI 运行时'))
  const reference = filtered.groups[0].items[0].reference
  const built = JSON.parse(await unifiedGet.execute(reference))
  assert.equal(built.ok, true); assert.equal(built.item.origin, 'bundled'); assert.ok(built.item.body.length > 0)

  const kbSearch = registered.get('redteam_artex_knowledge_search')
  const search = JSON.parse(await kbSearch.execute({ query: 'Example', limit: 3 }))
  assert.equal(search.ok, true)
  assert.equal(search.read_only, true)
  assert.deepEqual(search.items.map(item => item.id), [17])
  const kbGet = registered.get('redteam_artex_knowledge_get')
  const detail = JSON.parse(await kbGet.execute({ id: 17 }))
  assert.equal(detail.ok, true)
  assert.equal(detail.read_only, true)
  assert.equal(detail.item.content, 'No commands were executed')
  const missing = JSON.parse(await kbSearch.execute({ query: '' }))
  assert.equal(missing.ok, false, 'empty queries must return a visible tool error')
  const invalid = JSON.parse(await kbGet.execute({ id: -1 }))
  assert.equal(invalid.ok, false, 'invalid knowledge IDs must return a visible tool error')
})
