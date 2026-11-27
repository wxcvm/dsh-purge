import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore, dispatch } from '../lib/redteam/store-core.js'
import { mergeSubdomainEvidence, runScopedSubdomains } from '../lib/redteam/scoped-subdomain-intel.js'

const domain = 'example.test', scope = ['*.example.test']
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'subdomain-intel-'))
  const store = new RedteamStore(root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const { id } = store.openEngagement('lab', scope)
  store.db(id).prepare('INSERT INTO ct_intel_snapshot(name,value,collected_at) VALUES(?,?,?)')
    .run(domain, JSON.stringify({ names: [{ name: 'a.example.test', source: 'crt.sh' }] }), '2026-01-01')
  return { store, id }
}
test('merges normalized scoped candidates and retains both sources', () => {
  const r = mergeSubdomainEvidence(domain, scope, [{ name: 'a.example.test' }],
    'A.example.test\nb.example.test\n*.example.test\nother.test\nhttps://c.example.test\n')
  assert.deepEqual(r.names, [{ name: 'a.example.test', sources: ['crt.sh', 'subfinder'] },
    { name: 'b.example.test', sources: ['subfinder'] }])
})
test('offline CT merge does not invoke external tool', async t => {
  const { store, id } = fixture(t)
  const r = await runScopedSubdomains(store, { engagement: id, target: domain }, {
    resolveTool: () => { throw Error('unexpected tool') },
  })
  assert.equal(r.ok, true)
  assert.equal(r.toolStatus, 'not-requested')
  assert.equal(r.imported, null)
  assert.equal(r.names.length, 1)
})
test('subfinder is explicitly opted in and uses bounded argv without shell', async t => {
  const { store, id } = fixture(t)
  let calls = 0
  const options = { resolveTool: () => ({ path: '/fixture/subfinder' }),
    execFileFn: (path, args, opts, cb) => {
      calls++
      assert.equal(path, '/fixture/subfinder')
      assert.deepEqual(args, ['-d', domain, '-silent', '-timeout', '10', '-max-time', '1', '-rl', '10', '-mr', '100', '-duc'])
      assert.equal(opts.shell, false)
      cb(null, 'a.example.test\nb.example.test\n')
    } }
  const req = { engagement: id, target: domain, useSubfinder: true }
  await assert.rejects(runScopedSubdomains(store, req, options))
  await assert.rejects(runScopedSubdomains(store, { ...req, target: 'other.test', confirmExternal: true }, options))
  assert.equal(calls, 0)
  const r = await runScopedSubdomains(store, { ...req, confirmExternal: true, commit: true }, options)
  assert.equal(r.imported.saved, true)
  assert.equal(r.names.length, 2)
  const repeat = await runScopedSubdomains(store, { ...req, confirmExternal: true, commit: true }, options)
  assert.equal(repeat.imported.saved, false)
  const history = dispatch(store, { op: 'scopedSubdomainHistory', engagement: id, target: domain })
  assert.equal(history.items.length, 1)
  assert.equal(store.db(id).prepare('SELECT COUNT(*) AS n FROM asset').get().n, 0)
})
test('missing tool retains saved CT evidence without pretending execution', async t => {
  const { store, id } = fixture(t)
  const r = await runScopedSubdomains(store, { engagement: id, target: domain, useSubfinder: true, confirmExternal: true }, { resolveTool: () => ({ path: null }) })
  assert.equal(r.ok, true)
  assert.equal(r.toolStatus, 'tool-missing')
  assert.equal(r.names.length, 1)
})


test('Amass uses only passive enum mode, writes to a private temporary file and merges provenance', async t => {
  const { store, id } = fixture(t)
  let calls = 0
  const r = await runScopedSubdomains(store, {
    engagement: id, target: domain, useAmass: true, confirmExternal: true, commit: true,
  }, {
    resolveTool: toolId => {
      assert.equal(toolId, 'amass')
      return { path: '/fixture/amass' }
    },
    execFileFn: (path, args, options, done) => {
      calls++
      assert.equal(path, '/fixture/amass')
      assert.equal(options.shell, false)
      assert.deepEqual(args.slice(0, 6), ['enum', '-passive', '-d', domain, '-timeout', '1'])
      assert.equal(args[6], '-o')
      assert.ok(args[7].endsWith('amass.txt'))
      writeFileSync(args[7], 'a.example.test\nb.example.test\noutside.test\n')
      done(null, '', '')
    },
  })
  assert.equal(calls, 1)
  assert.equal(r.ok, true)
  assert.equal(r.amassStatus, 'completed')
  assert.deepEqual(r.names, [
    { name: 'a.example.test', sources: ['amass', 'crt.sh'] },
    { name: 'b.example.test', sources: ['amass'] },
  ])
  assert.equal(r.toolRuns[0].toolId, 'amass')
  assert.equal(r.toolRuns[0].attempted, true)
  assert.match(r.toolRuns[0].argv[1], /-passive/)
  const inventory = dispatch(store, { op: 'scopedIntelInventory', engagement: id, target: domain })
  assert.ok(inventory.names.some(item => item.name === 'b.example.test' && item.evidence.some(e => e.source === 'amass')))
})
