import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore, dispatchAsync } from '../lib/redteam/store-core.js'
import { savePlatformConfig, loadPlatformConfig } from '../lib/redteam/platform-config.js'
import {
  SHODAN_API_BASE_URL, shodanConnectionGet, shodanConnectionSave,
  shodanConnectionTest, shodanHostLookup,
} from '../lib/redteam/shodan-intel.js'
import { runScopedIntelLookup } from '../lib/redteam/scoped-intel.js'

const ip = '192.0.2.10'
const hostPayload = {
  ip_str: ip,
  ports: [443, 80],
  hostnames: ['lab.example.test'],
  last_update: '2026-11-25T00:00:00Z',
}

function fixture(t) {
  const priorKey = process.env.SHODAN_API_KEY
  delete process.env.SHODAN_API_KEY
  const root = mkdtempSync(join(tmpdir(), 'purge-shodan-'))
  const cleanups = []
  t.after(() => {
    try {
      for (const cleanup of cleanups.reverse()) cleanup()
    } finally {
      rmSync(root, { recursive: true, force: true })
      if (priorKey === undefined) delete process.env.SHODAN_API_KEY
      else process.env.SHODAN_API_KEY = priorKey
    }
  })
  return { root, onCleanup: cleanup => cleanups.push(cleanup) }
}

test('Shodan API key is write-only and preserves unrelated platform settings', t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { FOFA_KEY: 'legacy-fofa' }, tools: { nmap: '/fixture/nmap' } }, root)
  assert.equal(shodanConnectionGet(root).configured, false)
  const saved = shodanConnectionSave(root, { key: 'private-shodan-key' })
  assert.equal(saved.configured, true)
  assert.equal(JSON.stringify(saved).includes('private-shodan-key'), false)
  assert.equal(loadPlatformConfig(root).env.SHODAN_API_KEY, 'private-shodan-key')
  assert.equal(loadPlatformConfig(root).env.FOFA_KEY, 'legacy-fofa')
  assert.equal(loadPlatformConfig(root).tools.nmap, '/fixture/nmap')
  assert.throws(() => shodanConnectionSave(root, { key: 'new-key', clearKey: true }), /不能同时/)
  assert.equal(shodanConnectionSave(root, { clearKey: true }).configured, false)
})

test('api-info connection test validates the account and returns only safe plan counters', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { SHODAN_API_KEY: 'private-shodan-key' } }, root)
  const result = await shodanConnectionTest(root, { fetch: async (url, options) => {
    assert.equal(url.origin, SHODAN_API_BASE_URL)
    assert.equal(url.pathname, '/api-info')
    assert.equal(url.searchParams.get('key'), 'private-shodan-key')
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'error')
    return new Response(JSON.stringify({
      plan: 'stream-100', query_credits: 120, scan_credits: 8, monitored_ips: 3,
    }), { status: 200 })
  } })
  assert.equal(result.ok, true)
  assert.equal(result.plan, 'stream-100')
  assert.equal(result.queryCredits, 120)
  assert.equal(result.scanCredits, 8)
  assert.equal(result.monitoredIps, 3)
  assert.equal(JSON.stringify(result).includes('private-shodan-key'), false)
})

test('connection failures are sanitized and never echo the key or request URL', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { SHODAN_API_KEY: 'private-shodan-key' } }, root)
  const invalid = await shodanConnectionTest(root, { fetch: async () => new Response('{}', { status: 401 }) })
  assert.equal(invalid.error, 'Shodan API Key 无效，请检查或重新生成 API Key')
  const offline = await shodanConnectionTest(root, { fetch: async () => { throw new Error('https://api.shodan.io/api-info?key=private-shodan-key') } })
  assert.equal(offline.error, 'Shodan 连接失败或响应无效')
  assert.equal(JSON.stringify([invalid, offline]).includes('private-shodan-key'), false)
})

test('host lookup is a minified single-IP request with no active scan or search query', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { SHODAN_API_KEY: 'private-shodan-key' } }, root)
  const result = await shodanHostLookup(root, ip, { fetch: async (url, options) => {
    assert.equal(url.origin, SHODAN_API_BASE_URL)
    assert.equal(url.pathname, '/shodan/host/' + ip)
    assert.equal(url.searchParams.get('key'), 'private-shodan-key')
    assert.equal(url.searchParams.get('minify'), 'true')
    assert.equal(options.redirect, 'error')
    return new Response(JSON.stringify(hostPayload), { status: 200 })
  } })
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'minified-host-lookup')
  assert.equal(result.payload.ip_str, ip)
  assert.equal(JSON.stringify(result).includes('private-shodan-key'), false)
})

test('host lookup rejects non-IP targets before network access and maps missing records', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { SHODAN_API_KEY: 'private-shodan-key' } }, root)
  let calls = 0
  const invalid = await shodanHostLookup(root, 'example.test', { fetch: async () => { calls++; return new Response('{}') } })
  assert.equal(invalid.error, 'Shodan 主机查询仅支持单个 IP')
  assert.equal(calls, 0)
  const missing = await shodanHostLookup(root, ip, { fetch: async () => new Response('{}', { status: 404 }) })
  assert.equal(missing.error, 'Shodan 没有该 IP 的主机记录')
})

test('scoped Shodan lookup returns minified passive ports and leaves live state untouched', async t => {
  const { root, onCleanup } = fixture(t)
  savePlatformConfig({ env: { SHODAN_API_KEY: 'private-shodan-key' } }, root)
  const store = new RedteamStore(root)
  onCleanup(() => store.close())
  const { id } = store.openEngagement('lab', [ip])
  const result = await runScopedIntelLookup(store, {
    engagement: id, target: ip, confirmExternal: true, sources: ['shodan'],
  }, {
    fetch: async (url, options) => {
      assert.equal(url.pathname, '/shodan/host/' + ip)
      assert.equal(url.searchParams.get('minify'), 'true')
      assert.equal(options.redirect, 'error')
      return new Response(JSON.stringify(hostPayload), { status: 200 })
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.results[0].source, 'shodan')
  assert.deepEqual(result.ports.map(row => row.port), [80, 443])
  assert.ok(result.ports.every(row => row.proto === 'unknown'))
  assert.equal(result.imported, null)
  assert.equal(JSON.stringify(result).includes('private-shodan-key'), false)
})

test('scope and external consent prevent Shodan requests before network access', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { SHODAN_API_KEY: 'private-shodan-key' } }, root)
  const store = { root, listEngagements: () => [{ id: 'lab', scope: [ip] }], activeEngagementId: () => 'lab' }
  let calls = 0
  const fetch = async () => { calls++; return new Response(JSON.stringify(hostPayload), { status: 200 }) }
  await assert.rejects(runScopedIntelLookup(store, { target: ip, sources: ['shodan'] }, { fetch }))
  await assert.rejects(runScopedIntelLookup(store, { target: '192.0.2.11', confirmExternal: true, sources: ['shodan'] }, { fetch }))
  assert.equal(calls, 0)
})

test('dispatch exposes write-only Shodan settings through the host bridge', async t => {
  const { root } = fixture(t)
  const saved = await dispatchAsync({ root }, { op: 'shodanConnectionSave', key: 'private-shodan-key' })
  assert.equal(saved.ok, true)
  assert.equal(saved.configured, true)
  const loaded = await dispatchAsync({ root }, { op: 'shodanConnectionGet' })
  assert.equal(loaded.ok, true)
  assert.equal(loaded.configured, true)
  assert.equal(JSON.stringify([saved, loaded]).includes('private-shodan-key'), false)
})

test('Shodan setup and source controls exist in source and generated desktop client', () => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const src = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    const view = src.slice(src.indexOf('function LocalAssetSearchTab(props)'), src.indexOf('function EnvTab(props)'))
    assert.match(view, /shodanConnectionGet/)
    assert.match(view, /shodanConnectionSave/)
    assert.match(view, /shodanConnectionTest/)
    assert.match(view, /Shodan 官方 REST API/)
    assert.match(view, /shodanKey/)
    assert.match(view, /sources: \['shodan'\]/)
  }
})
