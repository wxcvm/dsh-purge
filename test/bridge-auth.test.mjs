import test from 'node:test'
import assert from 'node:assert/strict'
import { authorizeBridgeRequest, isLocalBridgePeer } from '../lib/redteam/bridge-auth.js'

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

test('non-local API is closed by default, including localhost reverse proxies', () => {
  for (const request of [
    req('203.0.113.5', 'example.test'),
    req('203.0.113.5', '127.0.0.1:53380'),
    req('127.0.0.1', 'example.test'),
    { ...req('127.0.0.1', '127.0.0.1:53380'), headers: { host: '127.0.0.1:53380', 'x-forwarded-for': '203.0.113.5' } },
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
