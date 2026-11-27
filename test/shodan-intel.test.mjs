import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { savePlatformConfig, loadPlatformConfig } from '../lib/redteam/platform-config.js'
import { saveCensysPat, loadCensysPat } from '../lib/redteam/platform-secret-store.js'
import { dispatchAsync } from '../lib/redteam/store-core.js'
import {
  DEFAULT_SHODAN_API_URL, normalizeShodanBaseUrl, loadShodanConnection,
  shodanConnectionGet, shodanConnectionSave, shodanConnectionTest, shodanHostLookup,
} from '../lib/redteam/shodan-intel.js'
import { runScopedIntelLookup } from '../lib/redteam/scoped-intel.js'

const ip = '192.0.2.10'
const TEST_SECRET_KEY = '0123456789abcdef'.repeat(4)
function fixture(t, secretKey = TEST_SECRET_KEY) {
  const oldKey = process.env.SHODAN_API_KEY
  const oldUrl = process.env.SHODAN_BASE_URL
  const oldSecretKey = process.env.DSH_PURGE_SECRET_KEY
  delete process.env.SHODAN_API_KEY
  delete process.env.SHODAN_BASE_URL
  process.env.DSH_PURGE_SECRET_KEY = secretKey
  const root = mkdtempSync(join(tmpdir(), 'purge-shodan-'))
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
    if (oldKey === undefined) delete process.env.SHODAN_API_KEY
    else process.env.SHODAN_API_KEY = oldKey
    if (oldUrl === undefined) delete process.env.SHODAN_BASE_URL
    else process.env.SHODAN_BASE_URL = oldUrl
    if (oldSecretKey === undefined) delete process.env.DSH_PURGE_SECRET_KEY
    else process.env.DSH_PURGE_SECRET_KEY = oldSecretKey
  })
  return { root }
}
const hostPayload = {
  ip_str: ip, hostnames: ['lab.example.test'],
  data: [
    { port: 443, transport: 'tcp', product: 'nginx', version: '1.27', timestamp: '2026-11-24T00:00:00Z' },
    { port: 53, transport: 'udp', product: 'dns' },
  ],
}

test('Shodan-compatible HTTPS roots accept optional gateway path and reject unsafe URLs', () => {
  assert.equal(normalizeShodanBaseUrl(), DEFAULT_SHODAN_API_URL)
  assert.equal(normalizeShodanBaseUrl('https://gateway.example/shodan/v1/'), 'https://gateway.example/shodan/v1')
  for (const value of ['http://gateway.example', 'https://user:pass@gateway.example',
    'https://gateway.example/?key=secret', 'https://gateway.example/#token',
    'file:///tmp/api', 'https://gateway.example/a/../b']) {
    assert.throws(() => normalizeShodanBaseUrl(value), Error)
  }
})

test('legacy environment key remains usable; saved key is write-only and clear disables env fallback', t => {
  const { root } = fixture(t)
  process.env.SHODAN_API_KEY = 'legacy-environment-key'
  assert.deepEqual(loadShodanConnection(root), {
    key: 'legacy-environment-key', baseUrl: DEFAULT_SHODAN_API_URL, credentialSource: 'environment',
  })
  assert.equal(shodanConnectionGet(root).configured, true)
  const saved = shodanConnectionSave(root, { key: 'new-private-key' })
  assert.equal(saved.configured, true)
  assert.equal(saved.credentialSource, 'config')
  assert.equal(JSON.stringify(saved).includes('new-private-key'), false)
  assert.equal(loadPlatformConfig(root).env.SHODAN_API_KEY, '')
  const stored = JSON.parse(readFileSync(join(root, 'platform-secrets.json'), 'utf8'))
  assert.match(stored.shodanApiKey, /^dshp:vault:v1:/)
  assert.equal(stored.shodanApiKey.includes('new-private-key'), false)
  assert.equal(shodanConnectionGet(root).credentialSource, 'encrypted-local')
  assert.equal(shodanConnectionGet(root).protectedAtRest, true)
  assert.throws(() => shodanConnectionSave(root, { baseUrl: 'https://relay.example' }), /同时提供/)
  const cleared = shodanConnectionSave(root, { clearKey: true })
  assert.equal(cleared.configured, false)
  assert.equal(cleared.credentialSource, 'none')
  assert.equal(loadPlatformConfig(root).env.SHODAN_API_KEY_DISABLED, 'true')
  assert.equal(loadShodanConnection(root).key, '')
})

test('legacy config Key migrates to encrypted local storage without remaining in config.json', t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { SHODAN_API_KEY: 'legacy-config-key' } }, root)
  assert.equal(shodanConnectionGet(root).credentialSource, 'legacy-plaintext')
  const migrated = shodanConnectionSave(root, {})
  assert.equal(migrated.credentialSource, 'encrypted-local')
  assert.equal(migrated.protectedAtRest, true)
  assert.equal(loadShodanConnection(root).key, 'legacy-config-key')
  assert.equal(loadPlatformConfig(root).env.SHODAN_API_KEY, '')
  const raw = readFileSync(join(root, 'platform-secrets.json'), 'utf8')
  assert.ok(!raw.includes('legacy-config-key'))
})

test('new API Keys are never saved in plaintext when the local vault is unavailable', t => {
  const { root } = fixture(t, '')
  assert.throws(() => shodanConnectionSave(root, { key: 'private-key' }), /DSH_PURGE_SECRET_KEY/)
  assert.equal(loadPlatformConfig(root).env.SHODAN_API_KEY, '')
  assert.equal(shodanConnectionGet(root).configured, false)
})

test('locked encrypted Key fails closed without environment fallback and can still be cleared', async t => {
  const { root } = fixture(t)
  shodanConnectionSave(root, { key: 'private-key' })
  process.env.DSH_PURGE_SECRET_KEY = 'f'.repeat(64)
  process.env.SHODAN_API_KEY = 'fallback-key'
  const locked = shodanConnectionGet(root)
  assert.equal(locked.configured, true)
  assert.equal(locked.credentialSource, 'encrypted-local-locked')
  assert.ok(locked.credentialError)
  let calls = 0
  const lookup = await shodanHostLookup(root, ip, { fetch: async () => { calls++; return new Response('{}') } })
  assert.equal(lookup.ok, false)
  assert.equal(calls, 0)
  const cleared = shodanConnectionSave(root, { clearKey: true })
  assert.equal(cleared.configured, false)
  assert.equal(cleared.credentialSource, 'none')
})

test('Shodan and Censys secrets share the encrypted file without overwriting each other', t => {
  const { root } = fixture(t)
  saveCensysPat('censys-private-pat', root)
  shodanConnectionSave(root, { key: 'shodan-private-key' })
  assert.equal(loadCensysPat(root), 'censys-private-pat')
  assert.equal(loadShodanConnection(root).key, 'shodan-private-key')
  const raw = readFileSync(join(root, 'platform-secrets.json'), 'utf8')
  assert.ok(!raw.includes('censys-private-pat'))
  assert.ok(!raw.includes('shodan-private-key'))
})

test('connection test checks only /api-info and returns plan and credit counters without key', async t => {
  const { root } = fixture(t)
  shodanConnectionSave(root, { key: 'private-key', baseUrl: 'https://relay.example/shodan/v1' })
  const result = await shodanConnectionTest(root, { fetch: async (url, options) => {
    assert.equal(url.origin, 'https://relay.example')
    assert.equal(url.pathname, '/shodan/v1/api-info')
    assert.equal(url.searchParams.get('key'), 'private-key')
    assert.equal(options.redirect, 'error')
    return new Response(JSON.stringify({ plan: 'small-business', query_credits: 18, scan_credits: 0 }), { status: 200 })
  } })
  assert.equal(result.ok, true)
  assert.equal(result.plan, 'small-business')
  assert.equal(result.queryCredits, 18)
  assert.equal(result.scanCredits, 0)
  assert.equal(JSON.stringify(result).includes('private-key'), false)
})

test('connection test maps invalid key, denied account and rate limit without provider body', async t => {
  const { root } = fixture(t)
  shodanConnectionSave(root, { key: 'private-key' })
  const invalid = await shodanConnectionTest(root, { fetch: async () => new Response('private-key', { status: 401 }) })
  assert.equal(invalid.error, 'Shodan API Key 无效，请核对密钥')
  const denied = await shodanConnectionTest(root, { fetch: async () => new Response('private-key', { status: 403 }) })
  assert.equal(denied.error, 'Shodan API 账户无权读取该接口')
  const limited = await shodanConnectionTest(root, { fetch: async () => new Response('private-key', { status: 429 }) })
  assert.equal(limited.error, 'Shodan 请求频率受限，请稍后重试')
  assert.equal(JSON.stringify([invalid, denied, limited]).includes('private-key'), false)
})

test('host lookup uses one-IP endpoint, API key and redirect protection', async t => {
  const { root } = fixture(t)
  shodanConnectionSave(root, { key: 'private-key' })
  const result = await shodanHostLookup(root, ip, { fetch: async (url, options) => {
    assert.equal(url.pathname, '/shodan/host/' + ip)
    assert.equal(url.searchParams.get('key'), 'private-key')
    assert.equal(options.redirect, 'error')
    return new Response(JSON.stringify(hostPayload), { status: 200 })
  } })
  assert.equal(result.ok, true)
  assert.equal(result.payload.ip_str, ip)
  assert.equal(JSON.stringify(result).includes('private-key'), false)
})

test('host lookup rejects non-IP before network and distinguishes missing host from plan denial', async t => {
  const { root } = fixture(t)
  shodanConnectionSave(root, { key: 'private-key' })
  let calls = 0
  const invalid = await shodanHostLookup(root, 'example.test', { fetch: async () => { calls++; return new Response('{}') } })
  assert.equal(invalid.error, 'Shodan Host API 仅支持单个 IP 查询')
  assert.equal(calls, 0)
  const missing = await shodanHostLookup(root, ip, { fetch: async () => new Response('{}', { status: 404 }) })
  assert.equal(missing.error, 'Shodan 未找到该 IP 的主机记录')
  const denied = await shodanHostLookup(root, ip, { fetch: async () => new Response('{}', { status: 403 }) })
  assert.match(denied.error, /套餐或账户权限/)
})

test('scope and one-time disclosure are checked before the Shodan request', async t => {
  const { root } = fixture(t)
  shodanConnectionSave(root, { key: 'private-key' })
  const store = { root, listEngagements: () => [{ id: 'lab', scope: [ip] }], activeEngagementId: () => 'lab' }
  let calls = 0
  const fetch = async () => { calls++; return new Response(JSON.stringify(hostPayload)) }
  await assert.rejects(runScopedIntelLookup(store, { target: ip, sources: ['shodan'] }, { fetch }))
  await assert.rejects(runScopedIntelLookup(store, { target: '192.0.2.11', confirmExternal: true, sources: ['shodan'] }, { fetch }))
  assert.equal(calls, 0)
})

test('scoped Shodan lookup imports passive history only and never changes live ports', async t => {
  const { root } = fixture(t)
  shodanConnectionSave(root, { key: 'private-key' })
  const store = { root, listEngagements: () => [{ id: 'lab', scope: [ip] }], activeEngagementId: () => 'lab' }
  const result = await runScopedIntelLookup(store, { target: ip, confirmExternal: true, sources: ['shodan'] }, {
    fetch: async (url, options) => {
      assert.equal(url.pathname, '/shodan/host/' + ip)
      assert.equal(options.redirect, 'error')
      return new Response(JSON.stringify(hostPayload), { status: 200 })
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.results[0].source, 'shodan')
  assert.equal(result.ports.length, 2)
  assert.equal(result.imported, null)
  assert.equal(result.results[0].provenance, 'passive')
})

test('dispatch exposes Shodan settings through the host bridge without credentials', async t => {
  const { root } = fixture(t)
  const saved = await dispatchAsync({ root }, { op: 'shodanConnectionSave', key: 'private-key' })
  assert.equal(saved.ok, true)
  assert.equal(saved.configured, true)
  const loaded = await dispatchAsync({ root }, { op: 'shodanConnectionGet' })
  assert.equal(loaded.ok, true)
  assert.equal(JSON.stringify([saved, loaded]).includes('private-key'), false)
})

test('Shodan settings and quick query controls exist in source and generated desktop client', async () => {
  const { readFileSync } = await import('node:fs')
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const src = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    const view = src.slice(src.indexOf('function LocalAssetSearchTab(props)'), src.indexOf('function EnvTab(props)'))
    assert.match(view, /shodanConnectionGet/)
    assert.match(view, /shodanConnectionSave/)
    assert.match(view, /shodanConnectionTest/)
    assert.match(view, /Shodan REST API/)
    assert.match(view, /Shodan-compatible/)
    assert.match(view, /shodanBaseUrl/)
    assert.match(view, /shodanKey/)
    assert.match(view, /quickSource === 'shodan'/)
    assert.match(view, /每次外部查询仍需单次确认/)
    assert.match(view, /Host API 仅支持单个 IP/)
  }
})
