import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedBridgeOrigin } from '../lib/redteam/bridge-origin.js'

function request(origin, remoteAddress = '127.0.0.1', host = '127.0.0.1:53380', cookie) {
  const headers = { host }
  if (origin !== undefined) headers.origin = origin
  if (cookie !== undefined) headers.cookie = cookie
  return { socket: { remoteAddress }, headers }
}

test('same-origin browser and authenticated Desktop forwarding remain compatible', () => {
  assert.equal(allowedBridgeOrigin(request('http://127.0.0.1:53380')), true)
  assert.equal(allowedBridgeOrigin(request('http://localhost:53380', '::1', 'localhost:53380')), true)
  assert.equal(allowedBridgeOrigin(request('app://dsh')), true)
  assert.equal(allowedBridgeOrigin(request(undefined, '127.0.0.1', '127.0.0.1:53380',
    'dsh-desktop-session=private-test-cookie')), true)
})

test('opaque and cross-site browser origins cannot use the local exemption', () => {
  assert.equal(allowedBridgeOrigin(request('null')), false)
  assert.equal(allowedBridgeOrigin(request('https://malicious.example')), false)
  assert.equal(allowedBridgeOrigin(request('http://localhost:5000')), false)
  assert.equal(allowedBridgeOrigin(request('data:text/plain,hi')), false)
  assert.equal(allowedBridgeOrigin(request(undefined)), false,
    'a missing Origin requires the private Desktop Host cookie')
})

test('unrelated app origins do not bypass the local browser-origin boundary', () => {
  for (const origin of [
    'app://other', 'app://dsh.evil.example', 'app:opaque',
    'app://dsh@malicious.example', 'app://dsh/path', 'app://dsh:80',
    'dsh-app://app',
  ]) {
    assert.equal(allowedBridgeOrigin(request(origin)), false, origin)
    assert.equal(allowedBridgeOrigin(request(origin, '127.0.0.1', '127.0.0.1:53380',
      'dsh-desktop-session=private-test-cookie')), false,
    'an unrecognized explicit Origin must never become trusted via a cookie: ' + origin)
  }
  assert.equal(allowedBridgeOrigin(request('APP://DSH')), true,
    'the established renderer Origin stays compatible when case differs')
})

test('remote peers cannot claim local desktop-origin exemptions', () => {
  assert.equal(allowedBridgeOrigin(request('null', '198.51.100.8')), false)
  assert.equal(allowedBridgeOrigin(request(undefined, '198.51.100.8')), false)
  assert.equal(allowedBridgeOrigin(request('app://dsh', '198.51.100.8')), false)
  assert.equal(allowedBridgeOrigin(request('https://example.test', '198.51.100.8', 'example.test')), true)
})
