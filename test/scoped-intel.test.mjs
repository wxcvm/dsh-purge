import test from 'node:test'
import assert from 'node:assert/strict'
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
test('explicit import preserves prior state and avoids overwriting prior ports', async () => {
  const s = store()
  let bundle
  s.db = () => ({ prepare: sql => sql.includes('FROM asset')
    ? { get: () => ({ id: 7, state: 'live' }) }
    : { all: () => [{ port: 443, proto: 'tcp' }] } })
  s.importBundle = (id, value) => { bundle = value; return { counts: { assets: 1 } } }
  const r = await runScopedIntelLookup(s, { target: ip, confirmExternal: true,
    commit: true, sources: ['internetdb', 'shodan'] }, {
    shodanKey: 'private-test-key',
    fetch: async url => url.host === 'api.shodan.io'
      ? reply({ ip_str: ip, data: [{ port: 443, transport: 'tcp' }, { port: 22, transport: 'tcp' }] })
      : reply({ ip, ports: [80, 443] }),
  })
  assert.equal(r.ok, true)
  assert.equal(bundle.assets[0].state, 'live')
  assert.deepEqual(bundle.assets[0].ports.map(p => p.port), [22])
  assert.equal(bundle.assets[0].ports[0].provenance, 'passive')
  assert.equal(JSON.stringify(bundle).includes('private-test-key'), false)
})
