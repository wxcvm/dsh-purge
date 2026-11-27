import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  artexToolRoots, findArtexTool, inspectArtex, probeLocalArtex, probeLocalArtexPrivacy, ARTEX_SHARED_TOOLS,
} from '../lib/artex-integration.js'
import { resolveTool } from '../lib/redteam/platform-config.js'

function workspace(t) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-purge-artex-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}
function put(file) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, 'test binary')
  return file
}

test('ARTEX Windows Tool Manager current layout is reusable without copying or config writes', (t) => {
  const home = workspace(t)
  const path = put(join(home, 'ARTEX', 'tools', 'nuclei', 'current', 'nuclei.exe'))
  const env = { LOCALAPPDATA: home, PATH: '' }
  assert.equal(findArtexTool('nuclei', { env, platform: 'win32' }), path)
  assert.equal(findArtexTool('nmap', { env, platform: 'win32' }), null, 'unknown ARTEX inventory is not guessed')
  const root = join(home, 'dsh', 'redteam')
  const config = { platform: 'windows', tools: {}, toolkitDir: join(home, 'empty'), binDirs: [] }
  const resolved = resolveTool('nuclei', { root, config, env })
  assert.equal(resolved.path, path)
  assert.equal(resolved.source, 'artex')
})

test('explicit user tool path wins over ARTEX shared binary', (t) => {
  const home = workspace(t)
  put(join(home, 'ARTEX', 'tools', 'nuclei', 'current', 'nuclei.exe'))
  const own = put(join(home, 'dsh-tools', 'nuclei.exe'))
  const resolved = resolveTool('nuclei', {
    root: join(home, 'dsh', 'redteam'),
    config: { platform: 'windows', toolkitDir: join(home, 'empty'), binDirs: [], tools: { nuclei: own } },
    env: { LOCALAPPDATA: home, PATH: '' },
  })
  assert.equal(resolved.path, own)
  assert.equal(resolved.source, 'config')
})

test('ARTEX versioned fallback excludes inactive previous staging files', (t) => {
  const home = workspace(t)
  const root = join(home, 'ARTEX', 'tools', 'ffuf')
  put(join(root, '.previous', 'ffuf.exe'))
  put(join(root, '.pending', 'ffuf.exe'))
  assert.equal(findArtexTool('ffuf', { env: { LOCALAPPDATA: home }, platform: 'win32' }), null)
  const active = put(join(root, '2.1.0', 'ffuf.exe'))
  assert.equal(findArtexTool('ffuf', { env: { LOCALAPPDATA: home }, platform: 'win32' }), active)
})

test('custom ARTEX_TOOL_DIRS are searched before managed binaries', (t) => {
  const home = workspace(t)
  const custom = join(home, 'custom-tools')
  const customFile = put(join(custom, 'subfinder.exe'))
  put(join(home, 'ARTEX', 'tools', 'subfinder', 'current', 'subfinder.exe'))
  const env = { LOCALAPPDATA: home, ARTEX_TOOL_DIRS: custom }
  assert.equal(artexToolRoots(env)[0], custom)
  assert.equal(findArtexTool('subfinder', { env, platform: 'win32' }), customFile)
  assert.ok(ARTEX_SHARED_TOOLS.includes('subfinder'))
})

test('optional ARTEX_HOME shares portable tools from data/tools and tools', (t) => {
  const home = workspace(t)
  const portable = join(home, 'ARTEX-portable')
  const dataTool = put(join(portable, 'data', 'tools', 'katana', 'current', 'katana.exe'))
  const fallbackTool = put(join(portable, 'tools', 'subfinder', '2.1.0', 'subfinder.exe'))
  const env = { ARTEX_HOME: portable, PATH: '' }
  assert.equal(findArtexTool('katana', { env, platform: 'win32' }), dataTool)
  assert.equal(findArtexTool('subfinder', { env, platform: 'win32' }), fallbackTool)
  const resolved = resolveTool('katana', {
    root: join(home, 'dsh', 'redteam'),
    config: { platform: 'windows', toolkitDir: join(home, 'empty'), binDirs: [], tools: {} },
    env,
  })
  assert.equal(resolved.source, 'artex')
  assert.equal(resolved.path, dataTool)
})

test('status separates live ARTEX from binary existence and never reports credentials', async (t) => {
  const home = workspace(t)
  const file = put(join(home, 'ARTEX', 'tools', 'dnsx', 'current', 'dnsx.exe'))
  const env = { LOCALAPPDATA: home, ARTEX_PG_DSN: 'postgres://private:key@host/db' }
  const live = await inspectArtex({ env, platform: 'win32', probe: async () => ({ version: '0.3-test' }) })
  assert.equal(live.ok, true)
  assert.equal(live.online, true)
  assert.equal(live.version, '0.3-test')
  assert.equal(live.toolCount, 1)
  assert.equal(live.tools[0].path, file)
  assert.ok(!JSON.stringify(live).includes('postgres://'))
  const offline = await inspectArtex({ env, platform: 'win32', probe: async () => null })
  assert.equal(offline.online, false)
  assert.equal(offline.toolCount, 1, 'installed tools remain reusable while service is stopped')
})

test('ARTEX is mounted in the RedTeam Resources tab and uses the existing read-only bridge', () => {
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const source = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const server = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(source, /function ArtexTab\(props\)/)
  assert.match(source, /\['artex', 'ARTEX'\]/)
  assert.match(source, /else if \(st\.tab === 'artex'\) body = h\(ArtexTab, \{ engagement: eng,/)
  assert.match(source, /onGotoAsset: \(assetId\) =>/)
  assert.match(source, /onGotoFindings: \(assetId\) =>/)
  assert.match(client, /function ArtexTab\(props\)/)
  assert.doesNotMatch(client, /function ArtexLinkSection\(\)/)
  assert.match(client, /fetch\('\/dsh-purge\/artex', \{ method: 'GET' \}\)/)
  assert.match(server, /path: "\/dsh-purge\/artex"/)
  assert.match(server, /const state = await inspectArtex\(\{ env: artexLocalEnv\(config\) \}\)/)
  assert.match(server, /reused: resolveTool\(item\.id, \{ root, config \}\)\.path === item\.path/)
})

test('local health distinguishes verified ARTEX from authenticated or unrelated services', async () => {
  const examples = [
    { status: 200, body: { ok: true, service: 'artex', version: '0.5' },
      expected: 'detected' },
    { status: 200, body: { ok: false, service: 'artex' }, expected: 'degraded' },
    { status: 200, body: { ok: true, service: 'other' }, expected: 'service_candidate' },
    { status: 200, body: { ok: true }, expected: 'service_candidate' },
    { status: 401, body: {}, expected: 'service_candidate' },
    { status: 403, body: {}, expected: 'service_candidate' },
    { status: 404, body: {}, expected: 'service_candidate' },
    { status: 302, body: {}, expected: 'service_candidate' },
  ]
  for (const item of examples) {
    const got = await probeLocalArtex({ fetchFn: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:8787/api/health')
      assert.equal(options.method, 'GET')
      assert.equal(options.redirect, 'manual')
      assert.equal(options.headers, undefined, 'no ARTEX credentials are forwarded')
      return {
        status: item.status,
        ok: item.status >= 200 && item.status < 300,
        json: async () => item.body,
      }
    } })
    assert.equal(got.state, item.expected, 'HTTP ' + item.status + ' / ' + JSON.stringify(item.body))
    assert.equal(got.httpStatus, item.status)
  }
})

test('malformed health and connection errors do not disrupt DSH', async () => {
  const malformed = await probeLocalArtex({ fetchFn: async () => ({
    status: 200, ok: true, json: async () => { throw new SyntaxError('malformed') },
  }) })
  assert.equal(malformed.state, 'service_candidate')
  const unreachable = await probeLocalArtex({ fetchFn: async () => { throw new Error('ECONNREFUSED') } })
  assert.equal(unreachable.state, 'absent')
  assert.equal(unreachable.httpStatus, null)
  assert.ok(!JSON.stringify(unreachable).includes('ECONNREFUSED'))
})

test('protected endpoint is only an unverified candidate and does not authorize ARTEX UI actions', async (t) => {
  const home = workspace(t)
  put(join(home, 'ARTEX', 'tools', 'nuclei', 'current', 'nuclei.exe'))
  const status = await inspectArtex({
    env: { LOCALAPPDATA: home },
    platform: 'win32',
    probe: async () => ({ state: 'service_candidate', httpStatus: 401, reason: 'authentication required' }),
  })
  assert.equal(status.online, false)
  assert.equal(status.state, 'service_candidate')
  assert.equal(status.httpStatus, 401)
  assert.equal(status.toolCount, 1)
})

test('tool files without a responding service are shown installed/offline, not connected', async (t) => {
  const home = workspace(t)
  put(join(home, 'ARTEX', 'tools', 'dnsx', 'current', 'dnsx.exe'))
  const status = await inspectArtex({
    env: { LOCALAPPDATA: home }, platform: 'win32',
    probe: async () => ({ state: 'absent', httpStatus: null }),
  })
  assert.equal(status.state, 'installed_offline')
  assert.equal(status.online, false)
  assert.equal(status.toolCount, 1)
})

test('RedTeam ARTEX tab distinguishes unverified and offline service states', () => {
  const source = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  assert.match(source, /service_candidate: '8787 端口有响应/)
  assert.match(source, /installed_offline: 'ARTEX 本机工具已发现/)
  assert.match(source, /state && state\.online \? h\('a'/)
  assert.match(source, /找到文件不代表可执行已验证/)
})

test('privacy console uses scoped ARTEX status without sharing administrator credentials', () => {
  const host = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  const source = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const bundle = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(host, /const artex = await probeLocalArtex\(\)/)
  assert.match(host, /state\.artex = \{/)
  assert.match(host, /const artexPrivacy = await probeLocalArtexPrivacy\(\{ health: artex \}\)/)
  assert.match(host, /\.\.\.artexPrivacy/)
  assert.doesNotMatch(host, /state\.artex = await inspectArtex\(\)/)
  for (const body of [source, bundle]) {
    assert.match(body, /ARTEX 本机联动状态/)
    assert.match(body, /setUI\(\{ tab: 'artex' \}\)/)
    assert.match(body, /已读取实际 HTTP 监听范围/)
    assert.match(body, /仅有启动配置，尚未观察实际绑定/)
    assert.match(body, /ARTEX 公网可达性、宿主机端口映射与反向代理仍未检测/)
  }
})

test('ARTEX privacy probe never sends a token without a confirmed health marker and opt-in config', async () => {
  let calls = 0
  const fetchFn = async () => { calls++; throw new Error('must not fetch') }
  const env = { DSH_PURGE_ARTEX_PRIVACY_TOKEN: 'test-read-only-token' }
  for (const state of ['absent', 'service_candidate', 'degraded']) {
    const got = await probeLocalArtexPrivacy({ health: { state }, env, fetchFn })
    assert.equal(got.privacyExposure, 'not_inspected')
    assert.equal(got.publicReachability, 'not_tested')
  }
  const unconfigured = await probeLocalArtexPrivacy({
    health: { state: 'detected' }, env: {}, fetchFn,
  })
  assert.equal(unconfigured.privacyExposure, 'not_configured')
  assert.equal(calls, 0)
})

test('ARTEX scoped privacy probe distinguishes runtime observations from configured values', async () => {
  const token = 'test-read-only-token-123456'
  const env = { DSH_PURGE_ARTEX_PRIVACY_TOKEN: token }
  for (const [source, expected] of [
    ['runtime_listener', 'runtime_observed'],
    ['configured', 'configured_only'],
    ['not_inspected', 'not_inspected'],
  ]) {
    const got = await probeLocalArtexPrivacy({
      health: { state: 'detected' }, env,
      fetchFn: async (url, options) => {
        assert.equal(url, 'http://127.0.0.1:8787/api/privacy/bridge-status')
        assert.equal(options.method, 'GET')
        assert.equal(options.redirect, 'manual')
        assert.deepEqual(options.headers, { 'X-Artex-Privacy-Token': token })
        return { status: 200, ok: true, json: async () => ({
          service: 'artex', scope: 'loopback', binding_source: source,
          public_reachability: 'not_tested', token, extra: 'do not forward',
        }) }
      },
    })
    assert.equal(got.privacyExposure, expected)
    assert.equal(got.privacyHttpStatus, 200)
    assert.equal(got.privacyScope, source === 'not_inspected' ? null : 'loopback')
    assert.equal(got.publicReachability, 'not_tested')
    assert.ok(!JSON.stringify(got).includes(token))
    assert.ok(!JSON.stringify(got).includes('do not forward'))
  }
})

test('ARTEX privacy probe fails without overstating scope or leaking errors', async () => {
  const health = { state: 'detected' }
  const env = { DSH_PURGE_ARTEX_PRIVACY_TOKEN: 'private-test-token' }
  const examples = [
    { status: 401, expected: 'auth_rejected' },
    { status: 403, expected: 'auth_rejected' },
    { status: 404, expected: 'unsupported' },
    { status: 405, expected: 'unsupported' },
    { status: 302, expected: 'unavailable' },
    { status: 503, expected: 'unavailable' },
    { status: 200, body: { service: 'other' }, expected: 'invalid_response' },
    { status: 200, body: { service: 'artex', scope: 'loopback',
      binding_source: 'runtime_listener', public_reachability: 'reachable' }, expected: 'invalid_response' },
    { status: 200, body: { service: 'artex', scope: 'invented',
      binding_source: 'runtime_listener', public_reachability: 'not_tested' }, expected: 'invalid_response' },
  ]
  for (const item of examples) {
    const got = await probeLocalArtexPrivacy({ health, env, fetchFn: async () => ({
      status: item.status, ok: item.status === 200, json: async () => item.body,
    }) })
    assert.equal(got.privacyExposure, item.expected)
    assert.equal(got.privacyScope, null)
    assert.equal(got.publicReachability, 'not_tested')
    assert.ok(!JSON.stringify(got).includes(env.DSH_PURGE_ARTEX_PRIVACY_TOKEN))
  }
  const malformed = await probeLocalArtexPrivacy({ health, env, fetchFn: async () => ({
    status: 200, ok: true, json: async () => { throw new Error('malformed private-test-token') },
  }) })
  assert.equal(malformed.privacyExposure, 'invalid_response')
  const unreachable = await probeLocalArtexPrivacy({ health, env,
    fetchFn: async () => { throw new Error('private-test-token') },
  })
  assert.equal(unreachable.privacyExposure, 'unavailable')
  assert.ok(!JSON.stringify(unreachable).includes('private-test-token'))
})

test('Windows installer default and saved portable paths are recognized', (t) => {
  const home = workspace(t)
  const standard = put(join(home, 'Programs', 'ARTEX', 'tools', 'dnsx.exe'))
  assert.equal(findArtexTool('dnsx', { env: { LOCALAPPDATA: home }, platform: 'win32' }), standard)
  const portable = join(home, 'portable')
  const tool = put(join(portable, 'tools', 'katana.exe'))
  assert.equal(resolveTool('katana', { root: home, config: { platform: 'windows', env: { ARTEX_HOME: portable } }, env: { PATH: '' } }).path, tool)
})

test('ARTEX status uses an injected store, preserves custom root, and survives service reload', async () => {
  const server = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const start = server.indexOf('function watchArtexStore(ctx)')
  const end = server.indexOf('function installWebServer(ctx, cfg)', start)
  assert.ok(start >= 0 && end > start)
  const watch = new Function(server.slice(start, end) + '\nreturn watchArtexStore')()
  let activate, cleanup
  const ctx = new Proxy({
    inject(keys, fn) { assert.deepEqual(keys, ['redteam']); activate = fn }
  }, { get(target, key) {
    if (key === 'redteam') throw Error('cannot get property "redteam" without inject')
    return target[key]
  } })
  const getArtexStore = watch(ctx)
  assert.equal(getArtexStore(), null)
  const routeStart = server.indexOf('path: "/dsh-purge/artex",')
  const handlerStart = server.indexOf('handler: ', routeStart) + 'handler: '.length
  const handlerEnd = server.indexOf('\n        },\n      },', handlerStart)
  assert.ok(routeStart >= 0 && handlerEnd > handlerStart)
  const reads = []
  const config = { env: {} }
  let status, body
  const handler = new Function('getArtexStore', 'loadPlatformConfig', 'artexLocalEnv', 'inspectArtex', 'resolveTool', 'sendJson',
    'return (' + server.slice(handlerStart, handlerEnd) + '\n        })')(
    getArtexStore, root => { reads.push(root); return config }, c => c.env,
    async () => ({ ok: true, tools: [{ id: 'sample', path: '/custom/tool' }] }),
    (id, opts) => { assert.equal(opts.root, reads.at(-1)); assert.equal(opts.config, config); return { path: '/custom/tool' } },
    (res, code, value) => { status = code; body = value })
  const request = { method: 'GET' }
  await handler(request, {})
  assert.equal(status, 503)
  assert.equal(reads.length, 0)
  activate({ redteam: { root: '/custom/profile' }, effect(fn) { cleanup = fn() } })
  await handler(request, {})
  assert.equal(status, 200)
  assert.equal(body.tools[0].reused, true)
  assert.deepEqual(reads, ['/custom/profile'])
  cleanup()
  await handler(request, {})
  assert.equal(status, 503)
  activate({ redteam: { root: '/new/profile' }, effect(fn) { cleanup = fn() } })
  await handler(request, {})
  assert.equal(status, 200)
  assert.deepEqual(reads, ['/custom/profile', '/new/profile'])
  cleanup()
})
