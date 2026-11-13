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
    assert.equal(r.groups.length, 5)
    assert.deepEqual(r.groups.map(g => g.source), ['personal','cve','redteam','aboutsecurity','artex'])
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
