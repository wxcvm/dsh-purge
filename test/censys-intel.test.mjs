import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore, dispatchAsync } from '../lib/redteam/store-core.js'
import { savePlatformConfig, loadPlatformConfig } from '../lib/redteam/platform-config.js'
import {
  CENSYS_API_BASE_URL, CENSYS_HOST_ACCEPT, censysConnectionGet, censysConnectionSave,
  censysConnectionTest, censysHostLookup, normalizeCensysOrganizationId,
} from '../lib/redteam/censys-intel.js'
import { normalizeIntelHost, runScopedIntelLookup } from '../lib/redteam/scoped-intel.js'

const ip = '192.0.2.10'
const org = '12345678-1234-4234-8234-123456789abc'
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'purge-censys-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root }
}
const hostPayload = {
  result: { resource: {
    ip,
    dns: { names: ['lab.example.test', 'lab.example.test'] },
    services: [
      { port: 443, transport_protocol: 'tcp', protocol: 'https',
        scan_time: '2026-11-24T00:00:00Z', software: [{ product: 'nginx', version: '1.27' }] },
      { port: 443, transport_protocol: 'tcp', protocol: 'https',
        scan_time: '2026-11-24T00:00:00Z', software: [{ product: 'nginx', version: '1.27' }] },
      { port: 53, transport_protocol: 'udp', protocol: 'dns' },
      { port: 70000, transport_protocol: 'tcp' },
    ],
  } },
}

test('organization IDs are optional but strictly UUID-validated', () => {
  assert.equal(normalizeCensysOrganizationId(''), '')
  assert.equal(normalizeCensysOrganizationId(org), org)
  assert.throws(() => normalizeCensysOrganizationId('not-a-uuid'), /Organization ID/)
})

test('PAT and organization settings are write-only and preserve unrelated platform config', t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { FOFA_KEY: 'legacy-fofa' }, tools: { nmap: '/fixture/nmap' } }, root)
  const initial = censysConnectionGet(root)
  assert.equal(initial.configured, false)
  assert.equal(initial.organizationConfigured, false)
  assert.equal(JSON.stringify(initial).includes('CENSYS_PAT'), false)
  const saved = censysConnectionSave(root, { token: 'private-censys-token', organizationId: org })
  assert.equal(saved.configured, true)
  assert.equal(saved.organizationConfigured, true)
  assert.equal(saved.organizationId, org)
  assert.equal(JSON.stringify(saved).includes('private-censys-token'), false)
  assert.equal(loadPlatformConfig(root).env.CENSYS_PAT, 'private-censys-token')
  assert.equal(loadPlatformConfig(root).env.CENSYS_ORG_ID, org)
  assert.equal(loadPlatformConfig(root).env.FOFA_KEY, 'legacy-fofa')
  assert.equal(loadPlatformConfig(root).tools.nmap, '/fixture/nmap')
  assert.throws(() => censysConnectionSave(root, { token: 'new-token', clearToken: true }), /不能同时/)
  assert.equal(censysConnectionSave(root, { clearToken: true }).configured, false)
  assert.equal(censysConnectionSave(root, { clearOrganizationId: true }).organizationConfigured, false)
})

test('connection test calls only the zero-credit account endpoint', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { CENSYS_PAT: 'private-token' } }, root)
  const result = await censysConnectionTest(root, { fetch: async (url, options) => {
    assert.equal(url.origin, CENSYS_API_BASE_URL)
    assert.equal(url.pathname, '/v3/accounts/users/credits')
    assert.equal(options.method, 'GET')
    assert.equal(options.headers.Authorization, 'Bearer private-token')
    assert.equal(options.redirect, 'error')
    return new Response(JSON.stringify({ balance: 12 }), { status: 200 })
  } })
  assert.equal(result.ok, true)
  assert.equal(result.verified, true)
  assert.equal(result.testScope, 'free-user-credit-balance')
  assert.equal(JSON.stringify(result).includes('private-token'), false)
})

test('organization connection test uses the optional organization credit endpoint', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { CENSYS_PAT: 'private-token', CENSYS_ORG_ID: org } }, root)
  const result = await censysConnectionTest(root, { fetch: async (url, options) => {
    assert.equal(url.pathname, '/v3/accounts/organizations/' + org + '/credits')
    assert.equal(options.headers.Authorization, 'Bearer private-token')
    return new Response('{}', { status: 200 })
  } })
  assert.equal(result.ok, true)
  assert.equal(result.testScope, 'organization-credit-balance')
})

test('connection test distinguishes auth, role, and network failures without echoing secrets', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { CENSYS_PAT: 'private-token' } }, root)
  const unauthorized = await censysConnectionTest(root, { fetch: async () => new Response('{}', { status: 401 }) })
  assert.equal(unauthorized.error, 'Censys PAT 无效，请检查或重新生成 Personal Access Token')
  const forbidden = await censysConnectionTest(root, { fetch: async () => new Response('{}', { status: 403 }) })
  assert.match(forbidden.error, /API Access 权限不足/)
  const offline = await censysConnectionTest(root, { fetch: async () => { throw new Error('private-token') } })
  assert.equal(offline.error, 'Censys 连接失败或响应无效')
  assert.equal(JSON.stringify([unauthorized, forbidden, offline]).includes('private-token'), false)
})

test('host lookup uses v3 single-IP endpoint, bearer auth and bounded fields', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { CENSYS_PAT: 'private-token', CENSYS_ORG_ID: org } }, root)
  const result = await censysHostLookup(root, ip, { fetch: async (url, options) => {
    assert.equal(url.pathname, '/v3/global/asset/host/' + ip)
    assert.equal(url.searchParams.get('organization_id'), org)
    assert.match(url.searchParams.get('fields'), /services\.port/)
    assert.equal(options.headers.Authorization, 'Bearer private-token')
    assert.equal(options.headers.Accept, CENSYS_HOST_ACCEPT)
    assert.equal(options.redirect, 'error')
    return new Response(JSON.stringify(hostPayload), { status: 200 })
  } })
  assert.equal(result.ok, true)
  assert.equal(result.creditCost, 1)
  assert.equal(result.payload.result.resource.ip, ip)
  assert.equal(JSON.stringify(result).includes('private-token'), false)
})

test('host lookup maps missing hosts separately from invalid credentials', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { CENSYS_PAT: 'private-token' } }, root)
  const missing = await censysHostLookup(root, ip, { fetch: async () => new Response('{}', { status: 404 }) })
  assert.equal(missing.error, 'Censys 未找到该 IP 的主机记录')
  const invalid = await censysHostLookup(root, ip, { fetch: async () => new Response('{}', { status: 401 }) })
  assert.equal(invalid.error, 'Censys PAT 无效，请检查或重新生成 Personal Access Token')
})

test('Censys normalization is passive, deduplicates ports and retains timestamps', () => {
  const result = normalizeIntelHost('censys', hostPayload, ip)
  assert.equal(result.provenance, 'passive')
  assert.deepEqual(result.ports.map(p => [p.port, p.proto]), [[443, 'tcp'], [53, 'udp']])
  assert.equal(result.ports[0].product, 'nginx')
  assert.equal(result.ports[0].version, '1.27')
  assert.equal(result.ports[0].observed_at, '2026-11-24T00:00:00Z')
  assert.deepEqual(result.hostnames, ['lab.example.test'])
})

test('scope and one-time external consent are checked before any Censys request', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { CENSYS_PAT: 'private-token' } }, root)
  const store = { root, listEngagements: () => [{ id: 'lab', scope: [ip] }], activeEngagementId: () => 'lab' }
  let calls = 0
  const fetch = async () => { calls++; return new Response(JSON.stringify(hostPayload), { status: 200 }) }
  await assert.rejects(runScopedIntelLookup(store, { target: ip, sources: ['censys'] }, { fetch }))
  await assert.rejects(runScopedIntelLookup(store, { target: '192.0.2.11', confirmExternal: true, sources: ['censys'] }, { fetch }))
  assert.equal(calls, 0)
})

test('scoped Censys lookup returns only passive observations and never rewrites live ports', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { CENSYS_PAT: 'private-token' } }, root)
  const store = new RedteamStore(root)
  const { id } = store.openEngagement('lab', [ip])
  const result = await runScopedIntelLookup(store, { engagement: id, target: ip, confirmExternal: true, sources: ['censys'] }, {
    fetch: async (url, options) => {
      assert.equal(url.origin, CENSYS_API_BASE_URL)
      assert.equal(options.redirect, 'error')
      return new Response(JSON.stringify(hostPayload), { status: 200 })
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.results[0].source, 'censys')
  assert.equal(result.imported, null)
  assert.equal(result.ports.length, 2)
  assert.match(result.note, /1 credit/)
  assert.equal(JSON.stringify(result).includes('private-token'), false)
})

test('scope changes during the request prevent result delivery and import', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { CENSYS_PAT: 'private-token' } }, root)
  let scope = [ip]
  const store = { root, listEngagements: () => [{ id: 'lab', scope }], activeEngagementId: () => 'lab' }
  const result = await runScopedIntelLookup(store, { target: ip, confirmExternal: true, sources: ['censys'], commit: true }, {
    fetch: async () => {
      scope = []
      return new Response(JSON.stringify(hostPayload), { status: 200 })
    },
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /授权范围发生变化/)
  assert.deepEqual(result.results, [])
})

test('direct host helper rejects non-IP targets before network access', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { CENSYS_PAT: 'private-token' } }, root)
  let calls = 0
  const result = await censysHostLookup(root, 'example.test', { fetch: async () => { calls++; return new Response('{}') } })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'Censys 仅支持单个 IP 查询')
  assert.equal(calls, 0)
})

test('host lookup uses the bounded text fallback when a response has no stream reader', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { CENSYS_PAT: 'private-token' } }, root)
  const result = await censysHostLookup(root, ip, { fetch: async () => ({
    ok: true, body: null, text: async () => JSON.stringify(hostPayload),
  }) })
  assert.equal(result.ok, true)
  assert.equal(result.payload.result.resource.ip, ip)
})

test('Censys setup and query controls exist in source and generated desktop client', () => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const src = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    const view = src.slice(src.indexOf('function LocalAssetSearchTab(props)'), src.indexOf('function EnvTab(props)'))
    assert.match(view, /censysConnectionGet/)
    assert.match(view, /censysConnectionSave/)
    assert.match(view, /censysConnectionTest/)
    assert.match(view, /Censys Platform API v3/)
    assert.match(view, /每次查询消耗 1 credit/)
    assert.match(view, /censysPat/)
    assert.match(view, /sources: \['censys'\]/)
  }
})
