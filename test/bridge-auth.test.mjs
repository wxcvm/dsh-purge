import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { authorizeBridgeRequest, isLocalBridgePeer, isTrustedLocalRequest, bridgePrivacyPosture } from '../lib/redteam/bridge-auth.js'

function req(remoteAddress, host, token) {
  return {
    socket: { remoteAddress },
    headers: {
      host,
      ...(token === undefined ? {} : { 'x-dsh-purge-token': token }),
    },
  }
}

test('local desktop API works without remote credentials', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const request = req(ip, '127.0.0.1:53380')
    assert.equal(isLocalBridgePeer(request), true)
    assert.deepEqual(authorizeBridgeRequest(request, { token: '' }), { ok: true, local: true })
  }
})

test('local write requests require a same-origin browser request or the private Desktop cookie', () => {
  const host = '127.0.0.1:53380'
  const base = { socket: { remoteAddress: '127.0.0.1' } }
  assert.equal(isTrustedLocalRequest({ ...base, headers: { host, origin: 'http://127.0.0.1:53380' } }), true)
  assert.equal(isTrustedLocalRequest({ ...base, headers: { host, cookie: 'dsh-desktop-session=private-test-cookie' } }), true)
  assert.equal(isTrustedLocalRequest({ ...base, headers: { host, origin: 'null', 'content-type': 'text/plain' } }), false)
  assert.equal(isTrustedLocalRequest({ ...base, headers: { host, origin: 'https://malicious.example' } }), false)
  assert.equal(isTrustedLocalRequest({ ...base, headers: { host, origin: 'app://dsh' } }), true)
  assert.equal(isTrustedLocalRequest({ ...base, headers: { host, origin: 'app://unrelated' } }), false)
  assert.equal(isTrustedLocalRequest({ ...base, headers: {
    host, origin: 'app://unrelated', cookie: 'dsh-desktop-session=private-test-cookie',
  } }), false)
  assert.equal(isTrustedLocalRequest({ ...base, headers: { host } }), false)
  assert.equal(isTrustedLocalRequest({ ...base, headers: {
    host, cookie: 'dsh-desktop-session=private-test-cookie', 'x-forwarded-for': '203.0.113.5',
  } }), false)
})

test('non-local API is closed by default, including localhost reverse proxies', () => {
  for (const request of [
    req('203.0.113.5', 'example.test'),
    req('203.0.113.5', '127.0.0.1:53380'),
    req('127.0.0.1', 'example.test'),
    { ...req('127.0.0.1', '127.0.0.1:53380'), headers: { host: '127.0.0.1:53380', 'x-forwarded-for': '203.0.113.5' } },
    { ...req('127.0.0.1', '127.0.0.1:53380'), headers: { host: '127.0.0.1:53380', forwarded: 'for=203.0.113.5' } },
    ...['x-real-ip', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port',
      'x-client-ip', 'cf-connecting-ip', 'true-client-ip', 'via',
      'x-original-host', 'x-original-forwarded-for'].map(name => ({
        ...req('127.0.0.1', '127.0.0.1:53380'),
        headers: { host: '127.0.0.1:53380', [name]: '203.0.113.5' },
      })),
  ]) {
    assert.equal(isLocalBridgePeer(request), false)
    assert.deepEqual(authorizeBridgeRequest(request, { token: '' }), {
      ok: false, status: 403, error: 'bridge_remote_not_configured',
    })
  }
})

test('remote API accepts only the configured token', () => {
  const opts = { token: 'random-remote-token-for-this-test' }
  const remote = req('203.0.113.5', 'example.test')
  assert.deepEqual(authorizeBridgeRequest(remote, opts), {
    ok: false, status: 401, error: 'bridge_token_required',
  })
  assert.equal(authorizeBridgeRequest(req('203.0.113.5', 'example.test', 'wrong'), opts).error, 'bridge_token_invalid')
  assert.equal(authorizeBridgeRequest(req('203.0.113.5', 'example.test', opts.token), opts).tokenAuthenticated, true)
})

test('operator may opt in to requiring the token even for localhost', () => {
  const local = req('::1', '[::1]:53380')
  assert.equal(authorizeBridgeRequest(local, { token: 'local-secret', requireLocalToken: true }).status, 401)
  assert.equal(authorizeBridgeRequest(req('::1', '[::1]:53380', 'local-secret'), {
    token: 'local-secret', requireLocalToken: true,
  }).tokenAuthenticated, true)
})

test('privacy posture only reports configuration, never secrets or public reachability', () => {
  const secret = 'not-for-ui-random-test-secret'
  const snapshot = bridgePrivacyPosture(req('127.0.0.1', 'localhost:53380'), {
    DSH_PURGE_BRIDGE_TOKEN: secret,
    DSH_PURGE_REQUIRE_LOCAL_TOKEN: '1',
  })
  assert.deepEqual(snapshot, {
    localPeer: true,
    remoteTokenConfigured: true,
    localTokenRequired: true,
    acceptedAddress: null,
    acceptedPort: null,
    configuredPort: null,
    boundAddress: null,
    boundPort: null,
    publicReachability: 'not_tested',
    listenerScope: 'not_inspected',
  })
  assert.equal(JSON.stringify(snapshot).includes(secret), false)

  const remote = bridgePrivacyPosture(req('203.0.113.5', 'example.test'), {})
  assert.equal(remote.localPeer, false)
  assert.equal(remote.remoteTokenConfigured, false)
  assert.equal(remote.publicReachability, 'not_tested')
})

test('observed socket endpoint is not mistaken for the bound listener', () => {
  const request = req('127.0.0.1', '127.0.0.1:53380')
  request.socket.localAddress = '127.0.0.1'
  request.socket.localPort = 53380
  const summary = bridgePrivacyPosture(request, {}, 53380)
  assert.equal(summary.acceptedAddress, '127.0.0.1')
  assert.equal(summary.acceptedPort, 53380)
  assert.equal(summary.configuredPort, 53380)
  // Even when this request arrived through loopback, the listener may have
  // been bound to all interfaces or forwarded through a reverse proxy.
  assert.equal(summary.listenerScope, 'not_inspected')
  assert.equal(summary.publicReachability, 'not_tested')
})

test('privacy posture distinguishes a bound listener from an accepted loopback connection', () => {
  for (const [address, scope] of [
    ['127.0.0.1', 'loopback_bound'],
    ['::1', 'loopback_bound'],
    ['0.0.0.0', 'all_interfaces'],
    ['::', 'all_interfaces'],
    ['192.0.2.10', 'specific_interface'],
  ]) {
    const request = req('127.0.0.1', '127.0.0.1:53380')
    request.socket.localAddress = '127.0.0.1'
    request.socket.localPort = 53380
    request.socket.server = { address: () => ({ address, port: 53380 }) }
    const summary = bridgePrivacyPosture(request, {}, 53380)
    assert.equal(summary.listenerScope, scope, address)
    assert.equal(summary.boundAddress, address)
    assert.equal(summary.boundPort, 53380)
    assert.equal(summary.acceptedAddress, '127.0.0.1')
    assert.equal(summary.publicReachability, 'not_tested')
  }
})

test('non-IP or inaccessible listener binding remains explicitly unknown', () => {
  const request = req('127.0.0.1', 'localhost')
  request.socket.server = { address: () => { throw new Error('not accessible') } }
  assert.equal(bridgePrivacyPosture(request).listenerScope, 'not_inspected')
  request.socket.server = { address: () => '/tmp/test.sock' }
  assert.equal(bridgePrivacyPosture(request).listenerScope, 'not_inspected')
})

test('real HTTP server exposes wildcard bind even when the request uses 127.0.0.1', async (t) => {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(bridgePrivacyPosture(request, {}, server.address().port)))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '0.0.0.0', resolve)
  })
  t.after(() => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())))
  const response = await fetch('http://127.0.0.1:' + server.address().port)
  assert.equal(response.status, 200)
  const snapshot = await response.json()
  assert.equal(snapshot.localPeer, true)
  assert.equal(snapshot.acceptedAddress, '127.0.0.1')
  assert.equal(snapshot.boundAddress, '0.0.0.0')
  assert.equal(snapshot.listenerScope, 'all_interfaces')
  assert.equal(snapshot.publicReachability, 'not_tested')
})
