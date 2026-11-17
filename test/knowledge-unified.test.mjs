import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { knowledgeRequest } from '../lib/redteam/knowledge-center.js'
import { unifiedKnowledgeRequest } from '../lib/redteam/knowledge-unified.js'

test('unified results preserve source identity and isolate absent or broken sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-unified-'))
  try {
    const doc = knowledgeRequest(root, { op: 'knowledgeSave', title: 'SQLite notes', body: 'local text' }).item
    const options = {
      catalog: () => [{ title: 'SQLite advisory', product: 'SQLite', cve: ['CVE-2025-1234'], source_url: 'https://example.org' }],
      skills: () => [{ source: 'redteam', key: 'redteam:sqlite', name: 'sqlite', title: 'SQLite docs' }],
      readSkill: () => ({ content: 'reference', truncated: false }),
      artexStatus: () => { throw Error('database unavailable') },
    }
    const call = (op, args) => unifiedKnowledgeRequest(root, { op, ...args }, options)
    const r = call('knowledgeUnifiedSearch', { query: 'sqlite' })
    assert.equal(r.groups.length, 6)
    assert.deepEqual(r.groups.map(g => g.source), ['bundled','personal','cve','redteam','aboutsecurity','artex'])
    r.groups.shift() // existing source-specific assertions below
    assert.equal(r.groups[0].items[0].id, String(doc.id))
    assert.equal(r.groups[1].items[0].verified, false)
    assert.equal(r.groups[2].items[0].id, 'redteam:sqlite')
    assert.equal(r.groups[3].available, false)
    assert.match(r.groups[4].error, /database unavailable/)
    assert.equal(call('knowledgeUnifiedSearch', { query: 'sqlite', source: 'cve' }).groups.length, 1)
    assert.equal(call('knowledgeUnifiedGet', { source: 'personal', id: String(doc.id) }).item.body, 'local text')
    assert.match(call('knowledgeUnifiedGet', { source: 'cve', id: '0' }).item.body, /索引候选/)
    assert.equal(call('knowledgeUnifiedGet', { source: 'redteam', id: 'redteam:sqlite' }).item.body, 'reference')
    assert.throws(() => call('knowledgeUnifiedGet', { source: 'aboutsecurity', id: 'redteam:sqlite' }), /技能不存在/)
    assert.throws(() => call('knowledgeUnifiedSearch', { query: 'sqlite', source: 'unknown' }), /未知知识来源/)
    assert.deepEqual(call('knowledgeUnifiedSearch', { query: '' }).groups, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('ARTEX uses the existing adapter, keeps unknown totals and opens by source ID', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-unified-'))
  try {
    const opts = { artexStatus: () => ({ available: true }),
      artexSearch: ({ query, limit }) => { assert.equal(query, 'doc'); assert.equal(limit, 20); return { items: [{ id: 7, title: 'doc', category: 'test' }], degraded: true } },
      artexGet: ({ id }) => { assert.equal(id, 7); return { item: { id, title: 'doc', content: 'text' } } } }
    const r = unifiedKnowledgeRequest(root, { op: 'knowledgeUnifiedSearch', source: 'artex', query: 'doc' }, opts)
    assert.equal(r.groups[0].total, null)
    assert.equal(r.groups[0].items[0].id, '7')
    assert.equal(unifiedKnowledgeRequest(root, { op: 'knowledgeUnifiedGet', source: 'artex', id: '7' }, opts).item.body, 'text')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('unified search distinguishes missing, empty and unavailable ARTEX without searching unusable sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-unified-status-'))
  try {
    const doc = knowledgeRequest(root, { op: 'knowledgeSave', title: 'Reference notes', body: 'local text' }).item
    for (const [status, expected] of [
      [{ ok: true, available: false, state: 'missing', note: '未找到 knowledge.db' }, { available: false, total: null, note: '未找到 knowledge.db' }],
      [{ ok: true, available: true, state: 'empty', count: 0 }, { available: true, total: 0, note: 'ARTEX 知识库为空' }],
      [{ ok: false, available: false, state: 'unavailable', error: '无法读取知识库' }, { available: false, total: null, error: '无法读取知识库' }],
    ]) {
      const opts = { sources: ['personal', 'artex'], artexStatus: () => status,
        artexSearch: () => { throw Error('unexpected query') } }
      const result = unifiedKnowledgeRequest(root, { op: 'knowledgeUnifiedSearch', query: 'reference' }, opts)
      assert.equal(result.groups[0].items[0].id, String(doc.id))
      const group = result.groups[1]
      assert.equal(group.available, expected.available)
      assert.equal(group.total, expected.total)
      assert.deepEqual(group.items, [])
      assert.equal(group.error, expected.error)
      if (expected.note) assert.equal(group.note, expected.note)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('federated search reads the skill catalog once and reports bounded result coverage', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-unified-coverage-'))
  try {
    let reads = 0
    const options = { sources: ['personal', 'redteam', 'aboutsecurity', 'artex'],
      skills: () => { reads++; return Array.from({ length: 25 }, (_, i) => ({
        source: 'redteam', key: 'redteam:' + i, title: 'reference ' + i,
      })).concat([{ source: 'aboutsecurity', key: 'aboutsecurity:a', title: 'reference A' }]) },
      artexStatus: () => ({ available: true }),
      artexSearch: () => ({ items: [{ id: 1, title: 'reference' }], degraded: true }),
    }
    for (let i = 0; i < 23; i++) knowledgeRequest(root, { op: 'knowledgeSave', title: 'reference ' + i, body: 'body' })
    const result = unifiedKnowledgeRequest(root, { op: 'knowledgeUnifiedSearch', query: 'reference' }, options)
    assert.equal(reads, 1)
    assert.deepEqual(result.groups.map(g => [g.total, g.returned, g.hasMore]), [
      [23, 20, true], [25, 20, true], [1, 1, false], [null, 1, null],
    ])
    assert.equal(result.groups[0].items.some(x => Object.hasOwn(x, 'body')), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test('bundled knowledge is readable offline before creating a personal database', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-bundled-'))
  try {
    const call = args => unifiedKnowledgeRequest(root, args)
    const result = call({ op:'knowledgeUnifiedSearch', source:'bundled', query:'' }).groups[0]
    assert.equal(result.total, 206)
    assert.equal(result.items.length, 20)
    assert.equal(new Set(result.items.map(item => item.id)).size, 20)
    assert.ok(result.items.every(item => !Object.hasOwn(item, 'body')))
    const article = call({op:'knowledgeUnifiedGet',source:'bundled',id:'stream-sse'}).item
    assert.equal(article.origin,'bundled')
    assert.match(article.body,/首个非空文本/)
    const matched = call({op:'knowledgeUnifiedSearch',source:'bundled',query:'Provider'}).groups[0]
    assert.ok(matched.items.some(item=>item.id==='provider-adapters'))
    assert.equal(call({op:'knowledgeUnifiedSearch',source:'bundled',query:'',category:'Purge 使用'}).groups[0].total,3)
    assert.throws(()=>call({op:'knowledgeUnifiedGet',source:'bundled',id:'unknown'}),/不存在/)
    assert.equal(knowledgeRequest(root,{op:'knowledgeList'}).total,0)
    assert.equal(call({op:'knowledgeUnifiedSearch',source:'bundled',query:''}).groups[0].total,206)
  } finally { rmSync(root,{recursive:true,force:true}) }
})


test('bundled pagination and related references are stable', () => {
  const call = args => unifiedKnowledgeRequest('/unused', args)
  const first = call({op:'knowledgeUnifiedSearch',source:'bundled',query:''}).groups[0]
  const second = call({op:'knowledgeUnifiedSearch',source:'bundled',query:'',offset:20}).groups[0]
  assert.equal(first.hasMore,true); assert.equal(second.hasMore,true)
  assert.equal(second.items.length,20); assert.equal(second.offset,20)
  const pages = []
  for (let offset=0; offset<first.total; offset+=20) pages.push(call({op:'knowledgeUnifiedSearch',source:'bundled',query:'',offset}).groups[0])
  assert.equal(pages.at(-1).hasMore,false)
  assert.equal(pages.at(-1).items.length,6)
  assert.equal(new Set(pages.flatMap(page=>page.items.map(row=>row.id))).size,206)
  assert.ok(first.categories.includes('AI 运行时'))
  const article = call({op:'knowledgeUnifiedGet',source:'bundled',id:'stream-sse'}).item
  assert.ok(article.related.length>0)
  assert.ok(article.related.every(row=>row.id!==article.id && row.category===article.category))
})


test('bundled multi-term search matches across title, tags and body and ranks relevant titles', () => {
  const call = query => unifiedKnowledgeRequest('/unused', {op:'knowledgeUnifiedSearch', source:'bundled', query}).groups[0]
  const results = call('Provider 协议')
  assert.equal(results.items[0].id,'provider-adapters')
  assert.ok(results.items.some(row=>row.id==='purge-diagnostics'))
  assert.equal(call('Provider non-existent-phrase-abc').total,0)
  assert.deepEqual(call('Provider 协议').items.map(row=>row.id),results.items.map(row=>row.id))
});


test('runtime reference articles include practical troubleshooting and preserve stable IDs', () => {
  const get = id => unifiedKnowledgeRequest('/unused', {op:'knowledgeUnifiedGet',source:'bundled',id}).item
  for (const id of ['stream-sse','provider-adapters','tool-call-contract','stream-events','purge-diagnostics']) {
    const article = get(id)
    assert.equal(article.id,id)
    assert.ok(article.body.length > 400)
    assert.match(article.body,/验收/)
  }
  assert.match(get('stream-sse').body,/UTF-8/)
  assert.match(get('tool-call-contract').body,/不是两次执行/)
  assert.match(get('stream-events').body,/实收为 2/)
})

test('Fujiang CVE variants resolve consistently across bundled and CVE sources with distinct advisory links', () => {
  const search = (source, query) => unifiedKnowledgeRequest('/unused', {
    op: 'knowledgeUnifiedSearch', source, query,
  }).groups[0]
  const get = (source, id) => unifiedKnowledgeRequest('/unused', {
    op: 'knowledgeUnifiedGet', source, id,
  }).item
  const bundled = search('bundled', 'CVE-2021-43798').items
    .find(row => row.id === 'fujiang:cloud-container:cve-2021-43798-grafana-file-read')
  assert.ok(bundled)
  for (const query of ['CVE-2021-43798', 'cve 2021 43798', 'CVE_2021_43798',
    'ＣＶＥ－２０２１－４３７９８', 'CVE–2021–43798']) {
    const match = search('cve', query).items.find(row =>
      row.description.includes('CVE-2021-43798'))
    assert.ok(match, query)
    assert.equal(match.verified, false)
    assert.ok(match.advisory_url?.startsWith('https://'), query)
    assert.equal(match.advisory_url, bundled.advisory_url)
    assert.notEqual(match.source_url, match.advisory_url)
    assert.equal(Object.hasOwn(match, 'body'), false)
    const detail = get('cve', match.id)
    assert.equal(detail.advisory_url, match.advisory_url)
    assert.ok(detail.body.includes('核对公告：' + match.advisory_url))
    assert.equal(detail.verified, false)
  }
  for (const query of ['CVE-2021-41773 CVE-2021-42013',
    'CVE_2021_41773、ＣＶＥ－２０２１－４２０１３']) {
    const rows = search('cve', query).items
    assert.equal(rows.length, 1, query)
    assert.ok(rows[0].description.includes('CVE-2021-41773'))
    assert.ok(rows[0].description.includes('CVE-2021-42013'))
    assert.equal(rows[0].verified, false)
  }
  assert.equal(search('cve', 'CVE-2021-41773 CVE-2021-43798').total, 0)
  assert.equal(search('cve', 'CVE-2021-437980').total, 0)
  assert.equal(search('cve', 'non-existent-cve-query').total, 0)
})

test('CVE lookup does not mistake a shorter identifier for a longer one', () => {
  const options = { catalog: () => [
    { title: 'short', cve: ['CVE-2024-12345'], source_url: 'https://example.test/a' },
    { title: 'long', cve: ['CVE-2024-123456'], source_url: 'https://example.test/b' },
    { title: 'incidental mention CVE-2024-12345', cve: ['CVE-2024-98765'] },
  ] }
  const search = query => unifiedKnowledgeRequest('/unused',
    { op: 'knowledgeUnifiedSearch', source: 'cve', query }, options).groups[0]
  assert.deepEqual(search('CVE-2024-12345').items.map(row => row.id), ['0'])
  assert.deepEqual(search('CVE_2024_12345').items.map(row => row.id), ['0'])
  assert.deepEqual(search('CVE-2024-123456').items.map(row => row.id), ['1'])
  assert.deepEqual(search('CVE-2024-12345 CVE-2024-98765').items.map(row => row.id), [])
  assert.deepEqual(search('CVE-2024-12345、CVE-2024-123456').items.map(row => row.id), [])
})
