import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore, dispatch } from '../lib/redteam/store-core.js'
import { parseCtNames, runScopedCtLookup } from '../lib/redteam/scoped-ct-intel.js'

const domain = 'example.test'
const scope = ['*.example.test']
const rows = [{ id: 12, name_value: 'a.example.test\n*.example.test\nother.test\nnotexample.test\nEXAMPLE.TEST', not_after: '2027-01-01' },
  { id: 13, name_value: 'A.example.test\nb.example.test\nhttps://c.example.test' }]
const response = value => new Response(JSON.stringify(value))

test('CT parser filters SANs, wildcard patterns and duplicates', () => {
  const r = parseCtNames(rows, domain, scope)
  assert.deepEqual(r.names.map(n => n.name), ['a.example.test', 'b.example.test'])
  assert.equal(r.names[0].certificate_id, 12)
  assert.equal(r.truncated, false)
})
test('CT parser caps names and reports truncation', () => {
  const r = parseCtNames([{ name_value: Array.from({ length: 1001 }, (_, i) => 'h' + i + '.example.test').join('\n') }], domain, scope)
  assert.equal(r.names.length, 1000)
  assert.equal(r.truncated, true)
})
test('exact domain grant and missing consent prevent any CT request', async () => {
  let calls = 0
  const store = scope => ({ listEngagements: () => [{ id: 'lab', scope }], activeEngagementId: () => 'lab' })
  const options = { fetch: async () => { calls++; return response(rows) } }
  await assert.rejects(runScopedCtLookup(store([domain]), { target: domain, confirmExternal: true }, options))
  await assert.rejects(runScopedCtLookup(store(scope), { target: domain }, options))
  await assert.rejects(runScopedCtLookup(store(scope), { target: 'other.test', confirmExternal: true }, options))
  assert.equal(calls, 0)
})
test('preview and saved snapshots never create assets, ports or scope entries', async t => {
  const root = mkdtempSync(join(tmpdir(), 'scoped-ct-'))
  const store = new RedteamStore(root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const { id } = store.openEngagement('lab', scope)
  const options = { fetch: async (url, config) => {
    assert.equal(url.origin, 'https://crt.sh')
    assert.equal(url.searchParams.get('q'), '%.example.test')
    assert.equal(config.redirect, 'error')
    return response(rows)
  } }
  const req = { engagement: id, target: domain, confirmExternal: true }
  const preview = await runScopedCtLookup(store, req, options)
  assert.equal(preview.ok, true)
  assert.equal(preview.imported, null)
  const saved = await runScopedCtLookup(store, { ...req, commit: true }, options)
  assert.equal(saved.imported.saved, true)
  const repeat = await runScopedCtLookup(store, { ...req, commit: true }, options)
  assert.equal(repeat.imported.saved, false)
  const history = dispatch(store, { op: 'scopedCtHistory', engagement: id, target: domain })
  assert.equal(history.items.length, 1)
  assert.equal(history.items[0].names.length, 2)
  assert.equal(store.db(id).prepare('SELECT COUNT(*) AS n FROM asset').get().n, 0)
  assert.equal(store.db(id).prepare('SELECT COUNT(*) AS n FROM port').get().n, 0)
  assert.deepEqual(store.listEngagements().find(e => e.id === id).scope, scope)
})
test('invalid provider response fails without creating evidence', async () => {
  const store = { listEngagements: () => [{ id: 'lab', scope }], activeEngagementId: () => 'lab' }
  const req = { target: domain, confirmExternal: true, commit: true }
  for (const fetch of [async () => new Response('<html>busy</html>'), async () => new Response('', { status: 429 }), async () => response({ unexpected: true })]) {
    const r = await runScopedCtLookup(store, req, { fetch })
    assert.equal(r.ok, false)
  }
})
