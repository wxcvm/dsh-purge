import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { savePlatformConfig, loadPlatformConfig } from '../lib/redteam/platform-config.js'
import { dispatchAsync } from '../lib/redteam/store-core.js'
import {
  DEFAULT_FOFA_URL, normalizeFofaBaseUrl, fofaConnectionGet, fofaConnectionSave,
  fofaConnectionTest, parseFofaResults, runFofaSearch,
} from '../lib/redteam/fofa-intel.js'

const ip = '192.0.2.10'
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'purge-fofa-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const store = { root, listEngagements: () => [{ id: 'lab', scope: [ip, '*.example.test'] }],
    activeEngagementId: () => 'lab' }
  return { root, store }
}

test('FOFA base URL accepts HTTPS-compatible roots only', () => {
  assert.equal(normalizeFofaBaseUrl(), DEFAULT_FOFA_URL)
  assert.equal(normalizeFofaBaseUrl('https://custom.test/api/v1'), 'https://custom.test')
  for (const bad of ['http://custom.test', 'https://alice:pass@custom.test', 'https://custom.test/other',
    'https://custom.test/?token=abc', 'file:///tmp/x', 'https://custom.test/#x']) {
    assert.throws(() => normalizeFofaBaseUrl(bad), Error)
  }
})
test('connection keeps legacy Key private and rejects implicit forwarding to new host', t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { FOFA_KEY: 'legacy-private' }, tools: { nmap: '/fixture/nmap' } }, root)
  assert.deepEqual(fofaConnectionGet(root), { ok: true, configured: true, baseUrl: DEFAULT_FOFA_URL,
    verified: false, note: '已保存不代表连接通过；测试连接不会执行资产搜索。' })
  assert.throws(() => fofaConnectionSave(root, { baseUrl: 'https://custom.test' }), /更换接口地址/)
  assert.equal(loadPlatformConfig(root).env.FOFA_KEY, 'legacy-private')
  const after = fofaConnectionSave(root, { baseUrl: 'https://custom.test', key: 'new-private' })
  assert.equal(after.baseUrl, 'https://custom.test')
  assert.equal(JSON.stringify(after).includes('new-private'), false)
  assert.equal(loadPlatformConfig(root).env.FOFA_KEY, 'new-private')
  assert.equal(loadPlatformConfig(root).tools.nmap, '/fixture/nmap')
  assert.equal(fofaConnectionSave(root, { clearKey: true }).configured, false)
})
test('FOFA connection test verifies account endpoint without a target query', async t => {
  const { root } = fixture(t)
  savePlatformConfig({ env: { FOFA_KEY: 'private-secret' } }, root)
  const ok = await fofaConnectionTest(root, { fetch: async (url, opts) => {
    assert.equal(url.origin, DEFAULT_FOFA_URL)
    assert.equal(url.pathname, '/api/v1/info/my')
    assert.equal(url.searchParams.get('key'), 'private-secret')
    assert.equal(opts.redirect, 'error')
    return new Response(JSON.stringify({ error: false, email: 'demo@invalid.test' }), { status: 200 })
  } })
  assert.equal(ok.ok, true)
  assert.equal(JSON.stringify(ok).includes('private-secret'), false)
  assert.equal((await fofaConnectionTest(root, { fetch: async () =>
    new Response(JSON.stringify({ error: true, errmsg: 'invalid key private-secret' })) })).error,
  '认证失败，请核对 FOFA Key')
  assert.equal((await fofaConnectionTest(root, { fetch: async () =>
    new Response('rate limited', { status: 429 }) })).error, '额度不足或请求受限')
})
test('FOFA single-target search validates scope/consent before requests and filters rows', async t => {
  const { root, store } = fixture(t)
  savePlatformConfig({ env: { FOFA_KEY: 'secret' } }, root)
  let calls = 0
  const fetch = async (url, opts) => {
    calls++
    assert.equal(url.pathname, '/api/v1/search/all')
    assert.equal(url.searchParams.get('key'), 'secret')
    assert.equal(Buffer.from(url.searchParams.get('qbase64'), 'base64').toString(), 'ip="192.0.2.10"')
    assert.equal(opts.redirect, 'error')
    return new Response(JSON.stringify({ error: false, size: 3, results: [
      ['https://app.example.test', ip, '443', 'https', 'Demo', 'nginx', '2026-11-21'],
      ['https://other.test', '192.0.2.11', 80, 'http', 'Outside', 'Apache'],
      ['https://app.example.test', ip, 'bad', 'tcp', 'Unknown', 'x'],
    ] }), { status: 200 })
  }
  for (const req of [{ target: ip }, { target: '192.0.2.11', confirmExternal: true },
    { target: ip, confirmExternal: true, page: 50 }]) {
    await assert.rejects(runFofaSearch(store, req, { fetch }))
  }
  assert.equal(calls, 0)
  const result = await runFofaSearch(store, { target: ip, confirmExternal: true }, { fetch })
  assert.equal(calls, 1)
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].port, 443)
  assert.equal(result.items[1].port, null)
  assert.equal(result.total, 3)
  assert.equal(JSON.stringify(result).includes('secret'), false)
  assert.equal((await dispatchAsync(store, { op: 'fofaConnectionGet' })).configured, true)
})
test('FOFA domain results keep only exact or authorized subdomain hosts', () => {
  const source = { results: [
    ['https://a.example.test', '192.0.2.1', 443, 'tcp'],
    ['https://other.test', '192.0.2.1', 443, 'tcp'],
  ] }
  assert.deepEqual(parseFofaResults(source, 'example.test', ['*.example.test']).map(x => x.host),
    ['https://a.example.test'])
  assert.deepEqual(parseFofaResults(source, 'example.test', ['example.test']), [])
})
test('UI has no marketing copy in survey headings', async () => {
  const { readFileSync } = await import('node:fs')
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const src = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    const page = src.slice(src.indexOf('function LocalAssetSearchTab(props)'), src.indexOf('function EnvTab(props)'))
    assert.match(page, /开始测绘/)
    assert.match(page, /数据源/)
    assert.match(page, /fofaConnectionSave/)
    assert.match(page, /fofaConnectionTest/)
    assert.match(page, /fofaSearch/)
    assert.doesNotMatch(page, /简洁且可用|开箱即用|五项就够|鸟鸟的实施计划/)
  }
})
