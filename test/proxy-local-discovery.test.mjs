import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  flClashProxyFromConfig, flClashProxyCandidatesFromConfig, discoverFlClashProxy,
} from '../lib/redteam/proxy-local-discovery.js'
import { handleProxyOp } from '../lib/redteam/proxy-api.js'

test('FlClash config selects configured mixed/SOCKS/HTTP listener, not TUN', () => {
  const yaml = 'mixed-port: 7890\nsocks-port: 7891\nport: 7892\ntun:\n  enable: true\nauthentication: []\n'
  assert.deepEqual(flClashProxyCandidatesFromConfig(yaml).map(x => [x.protocol, x.port]),
    [['socks5', 7890], ['socks5', 7891], ['http', 7892]])
  assert.deepEqual(flClashProxyFromConfig(yaml), {
    protocol: 'socks5', host: '127.0.0.1', port: 7890, requiresAuth: false,
  })
  assert.equal(flClashProxyFromConfig('mixed-port: 0\nsocks-port: 0\nport: 0\ntun:\n  enable: true\n'), null)
  assert.equal(flClashProxyFromConfig('mixed-port: true'), null)
  assert.equal(flClashProxyFromConfig('mixed-port: 65536'), null)
  assert.equal(flClashProxyFromConfig('mixed-port: 8080\nauthentication: [redacted-secret]')?.requiresAuth, true)
})

test('discovery checks only FlClash-configured loopback ports, with no external request', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'flclash-local-'))
  const path = join(dir, 'config.yaml')
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(path, 'mixed-port: 7890\nsocks-port: 7891\nport: 0\nproxy-providers:\n  secret:\n    url: https://token-user:token-secret@example.invalid/sub\n')
  const checked = []
  const result = await discoverFlClashProxy({
    platform: 'win32', filePaths: [path],
    probe: async (port) => { checked.push(port); return port === 7891 },
  })
  assert.deepEqual(checked, [7890, 7891])
  assert.equal(result.found, true)
  assert.equal(result.loopbackListening, true)
  assert.equal(result.endpoint.type, 'socks5')
  assert.equal(result.endpoint.server, '127.0.0.1')
  assert.equal(result.endpoint.port, 7891)
  assert.equal(result.tunRequired, false)
  assert.equal(result.identityVerified, false)
  assert.equal(result.upstreamVerified, false)
  assert.doesNotMatch(JSON.stringify(result), /token-user|token-secret|example.invalid|config.yaml/)
})

test('actual read-only TCP probe succeeds on localhost listener without a remote call', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'flclash-listener-'))
  const file = join(dir, 'config.yaml')
  const server = createServer(socket => {
    socket.once('data', (greeting) => {
      assert.deepEqual([...greeting], [0x05, 0x02, 0x00, 0x02])
      socket.end(Buffer.from([0x05, 0x00]))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })
  const port = server.address().port
  writeFileSync(file, 'mixed-port: ' + port + '\ntun:\n  enable: false\n')
  const result = await discoverFlClashProxy({ platform: 'win32', filePaths: [file] })
  assert.equal(result.status, 'loopback_listening')
  assert.equal(result.endpoint.port, port)
  assert.equal(result.protocolVerified, true)
  assert.equal(result.identityVerified, false)
})

test('a listening non-proxy service is rejected; HTTP probe stays on loopback', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'flclash-protocol-'))
  const file = join(dir, 'config.yaml')
  const wrong = createServer(socket => socket.once('data', () => socket.end('not a SOCKS proxy')))
  const http = createServer(socket => socket.once('data', request => {
    // The verification target is loopback-only and never sends credentials.
    assert.match(request.toString('ascii'), /^CONNECT 127\.0\.0\.1:1 HTTP\/1\.1/)
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')
  }))
  await new Promise(resolve => wrong.listen(0, '127.0.0.1', resolve))
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => wrong.close(resolve))
    await new Promise(resolve => http.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })
  const wrongPort = wrong.address().port
  const httpPort = http.address().port
  writeFileSync(file, 'mixed-port: ' + wrongPort + '\n')
  const rejected = await discoverFlClashProxy({ platform: 'win32', filePaths: [file] })
  assert.equal(rejected.found, false)
  assert.equal(rejected.status, 'listener_unavailable')
  writeFileSync(file, 'mixed-port: ' + wrongPort + '\nport: ' + httpPort + '\n')
  const found = await discoverFlClashProxy({ platform: 'win32', filePaths: [file] })
  assert.equal(found.found, true)
  assert.equal(found.endpoint.type, 'http')
  assert.equal(found.endpoint.port, httpPort)
  assert.equal(found.protocolVerified, true)
  assert.equal(found.identityVerified, false)
  assert.equal(found.upstreamVerified, false)
})

test('disabled listeners, missing config, auth requirement and WSL are distinct', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'flclash-disabled-'))
  const file = join(dir, 'config.yaml')
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.equal((await discoverFlClashProxy({ platform: 'win32', filePaths: [join(dir, 'missing.yaml')] })).status,
    'config_not_found')
  writeFileSync(file, 'mixed-port: 0\nsocks-port: 0\nport: 0\ntun:\n  enable: true\n')
  assert.equal((await discoverFlClashProxy({ platform: 'win32', filePaths: [file] })).status, 'no_proxy_port')
  writeFileSync(file, 'mixed-port: 7890\n')
  assert.equal((await discoverFlClashProxy({ platform: 'win32', filePaths: [file], probe: async () => false })).status,
    'listener_unavailable')
  writeFileSync(file, 'mixed-port: 7890\nauthentication: [local-credential]\n')
  const auth = await discoverFlClashProxy({ platform: 'win32', filePaths: [file], probe: async () => true })
  assert.equal(auth.status, 'authentication_required')
  assert.equal(auth.requiresAuth, true)
  assert.doesNotMatch(JSON.stringify(auth), /local-credential/)
  const linux = await discoverFlClashProxy({ platform: 'linux', filePaths: [file], probe: () => { throw Error('must not probe') } })
  assert.equal(linux.status, 'windows_only')
  assert.equal(linux.found, false)
})

test('API only returns a redacted discovery candidate and the UI is in existing environment network tab', async () => {
  const viaApi = await handleProxyOp('/ignored', { op: 'proxyLocalDiscover' })
  assert.equal(viaApi.ok, true)
  assert.equal(viaApi.tunRequired, false)
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /op: 'proxyLocalDiscover'/)
    assert.match(source, /op: 'proxyModeBVerify'/)
    assert.match(source, /section === 'network' \? modeBNetworkCard\(\)/)
    assert.match(source, /确认入口并保存模式 B/)
    assert.match(source, /不需要开启 TUN/)
  }
})
