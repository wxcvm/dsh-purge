import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore, dispatch } from '../lib/redteam/store-core.js'
import { normalizeIntelHost, runScopedIntelLookup } from '../lib/redteam/scoped-intel.js'

const ip = '192.0.2.10'
const store = (scope = [ip]) => ({
  listEngagements: () => [{ id: 'lab', scope }],
  activeEngagementId: () => 'lab',
})
const reply = body => ({ ok: true, json: async () => body })

test('InternetDB is passive and deduplicates ports without assuming transport', () => {
  const result = normalizeIntelHost('internetdb', {
    ip, ports: [443, 443, 0, 65536, '80'], hostnames: ['lab.example', 'lab.example'],
    vulns: ['CVE-2020-0000'],
  }, ip)
  assert.deepEqual(result.ports.map(p => [p.port, p.proto]), [[443, 'unknown']])
  assert.deepEqual(result.hostnames, ['lab.example'])
  assert.equal(result.provenance, 'passive')
  assert.equal(result.vulns, undefined)
})
test('scope and disclosure are checked before any request', async () => {
  let called = 0
  const fetch = async () => { called++; return reply({ ip, ports: [] }) }
  for (const [s, req] of [
    [store([]), { target: ip, confirmExternal: true }],
    [store(), { target: '192.0.2.11', confirmExternal: true }],
    [store(), { target: ip }],
    [store(), { target: '192.0.2.0/24', confirmExternal: true }],
  ]) await assert.rejects(runScopedIntelLookup(s, req, { fetch }))
  assert.equal(called, 0)
})
test('preview is keyless, uses fixed provider, rejects redirects, never writes', async () => {
  const r = await runScopedIntelLookup(store(), { target: ip, confirmExternal: true }, {
    fetch: async (url, opts) => {
      assert.equal(url.href, 'https://internetdb.shodan.io/' + ip)
      assert.equal(opts.redirect, 'error')
      return reply({ ip, ports: [80] })
    },
  })
  assert.equal(r.ok, true)
  assert.equal(r.imported, null)
  assert.equal(r.ports[0].port, 80)
})
test('provider mismatch fails closed; errors never expose credentials', async () => {
  const r = await runScopedIntelLookup(store(), {
    target: ip, confirmExternal: true, sources: ['internetdb', 'shodan'],
  }, { shodanKey: 'private-test-key', fetch: async url => {
    if (url.host === 'api.shodan.io') throw new Error(url.href)
    return reply({ ip: '192.0.2.11', ports: [443] })
  } })
  assert.equal(r.ok, false)
  assert.equal(r.errors.length, 2)
  assert.equal(JSON.stringify(r).includes('private-test-key'), false)
})
test('saved observations retain unknown transport, deduplicate and never change live ports', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'scoped-intel-'))
  const s = new RedteamStore(root)
  t.after(() => { for (const db of s.handles.values()) db.close(); rmSync(root, { recursive: true, force: true }) })
  const { id } = s.openEngagement('lab', [ip])
  s.importBundle(id, { assets: [{ ip, state: 'live', ports: [{ port: 443, proto: 'tcp', state: 'open' }] }] })
  const options = {
    shodanKey: 'private-test-key',
    fetch: async url => url.host === 'api.shodan.io'
      ? reply({ ip_str: ip, data: [{ port: 443, transport: 'tcp' }, { port: 22, transport: 'tcp' }] })
      : reply({ ip, ports: [80, 443] }),
  }
  const req = { engagement: id, target: ip, confirmExternal: true, commit: true, sources: ['internetdb', 'shodan'] }
  const r = await runScopedIntelLookup(s, req, options)
  assert.equal(r.imported.saved, 2)
  const db = s.db(id)
  assert.equal(db.prepare('SELECT state FROM asset WHERE ip=?').get(ip).state, 'live')
  assert.deepEqual(db.prepare('SELECT port FROM port').all().map(p => p.port), [443])
  const repeat = await runScopedIntelLookup(s, req, options)
  assert.equal(repeat.imported.saved, 0)
  const history = dispatch(s, { op: 'scopedIntelHistory', engagement: id, target: ip })
  assert.equal(history.items.length, 2)
  assert.equal(history.items.find(x => x.source === 'internetdb').data.ports[0].proto, 'unknown')
  assert.equal(JSON.stringify(history).includes('private-test-key'), false)
  assert.equal(dispatch(s, { op: 'scopedIntelHistory', engagement: id, target: '192.0.2.11' }).ok, false)
})
