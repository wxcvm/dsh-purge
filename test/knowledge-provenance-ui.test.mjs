import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { knowledgeRequest } from '../lib/redteam/knowledge-center.js'
import { unifiedKnowledgeRequest } from '../lib/redteam/knowledge-unified.js'

function renderFrom(file) {
  const client = readFileSync(new URL('../' + file, import.meta.url), 'utf8')
  const start = client.indexOf('function PersonalKnowledgeProvenance(')
  const end = client.indexOf('function UnifiedKnowledgeTab(', start)
  assert.ok(start >= 0 && end > start)
  assert.match(client, /detail\.origin === 'personal' \? h\(PersonalKnowledgeProvenance, \{ item: detail \}\)/)
  assert.match(client, /revision \? h\('div', null, h\('h4', null, revision\.title\), h\(PersonalKnowledgeProvenance, \{ item: revision \}\)/)
  const h = (tag, props, ...children) => ({ tag, props, children })
  return new Function('h', client.slice(start, end) + '\nreturn PersonalKnowledgeProvenance')(h)
}

function part(tree, idx) { return tree.children[idx].children }

test('opened personal details and old revisions show their own recorded source and local time', t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-personal-provenance-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const call = (op, args = {}) => knowledgeRequest(root, { op, ...args })
  const initial = call('knowledgeImport', { documents: [{
    title: 'Reference notes', body: 'Text', source: 'offline-manual.md',
    updated_at: '2025-07-01T13:05:00Z',
  }] })
  const id = initial.ids[0]
  const current = call('knowledgeSave', { id, title: 'Reference notes', source: 'https://example.org/manual', body: 'Updated text' }).item
  const revision_id = call('knowledgeHistory', { id }).items[0].revision_id
  const revision = call('knowledgeHistoryGet', { id, revision_id }).item
  const detail = unifiedKnowledgeRequest(root, { op: 'knowledgeUnifiedGet', source: 'personal', id: String(id) }).item
  const summary = unifiedKnowledgeRequest(root, { op: 'knowledgeUnifiedSearch', source: 'personal' }).groups[0].items[0]
  assert.equal(summary.source, undefined, 'search result list does not expose recorded citations')
  for (const file of ['lib/redteam/client.js', 'client.js']) {
    const render = renderFrom(file)
    const opened = render({ item: detail })
    assert.equal(part(opened, 0)[0], '记录来源（未自动核验）：')
    assert.deepEqual(part(opened, 0)[1], {
      tag: 'a',
      props: { href: 'https://example.org/manual', target: '_blank', rel: 'noopener noreferrer' },
      children: ['https://example.org/manual'],
    })
    assert.equal(part(opened, 1)[1].tag, 'time')
    assert.equal(part(opened, 1)[1].props.dateTime, current.updated_at)
    const history = render({ item: revision })
    assert.equal(part(history, 0)[1], 'offline-manual.md')
    assert.equal(part(history, 1)[0], '本地修改时间：')
    assert.equal(part(history, 1)[1].props.dateTime, '2025-07-01T13:05:00.000Z')
  }
})

test('free-text, malformed, local, and credentialed personal citations are not navigable', () => {
  for (const file of ['lib/redteam/client.js', 'client.js']) {
    const render = renderFrom(file)
    for (const source of ['manual and notes', 'C:\\notes\\manual.md', 'file:///tmp/manual.md',
      '//example.org/manual', 'javascript:alert(1)', 'data:text/plain,manual',
      'https://', 'https://docs.example/a manual', 'https://name:pass@example.org/manual']) {
      const tree = render({ item: { source, updated_at: 'not a date' } })
      assert.equal(part(tree, 0)[1], source)
      assert.equal(part(tree, 1)[1], '未知')
    }
    assert.equal(part(render({ item: {} }), 0)[1], '未填写')
  }
})
