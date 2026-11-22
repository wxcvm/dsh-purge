import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { allowedBridgeOrigin } from '../lib/redteam/bridge-origin.js'

function request(origin, remoteAddress = '127.0.0.1', host = '127.0.0.1:53380', cookie) {
  const headers = { host }
  if (origin !== undefined) headers.origin = origin
  if (cookie !== undefined) headers.cookie = cookie
  return { socket: { remoteAddress }, headers }
}

function rc5DesktopCookie(host, value = 'v1.payload.signature') {
  const authority = new URL(`http://${host}`).host
  const name = 'dsh-auth-' + createHash('sha256').update(authority).digest('base64url')
  return name + '=' + value
}

test('same-origin browser and authenticated Desktop forwarding remain compatible', () => {
  assert.equal(allowedBridgeOrigin(request('http://127.0.0.1:53380')), true)
  assert.equal(allowedBridgeOrigin(request('http://localhost:53380', '::1', 'localhost:53380')), true)
  assert.equal(allowedBridgeOrigin(request('app://dsh')), true)
  assert.equal(allowedBridgeOrigin(request(undefined, '127.0.0.1', '127.0.0.1:53380',
    'dsh-desktop-session=private-test-cookie')), true)
})

test('Harness rc.5 authority-bound Desktop cookie is accepted only for its Host', () => {
  const host = '127.0.0.1:53380'
  const cookie = rc5DesktopCookie(host)
  assert.equal(allowedBridgeOrigin(request(undefined, '127.0.0.1', host, cookie)), true)
  assert.equal(allowedBridgeOrigin(request(undefined, '127.0.0.1', host,
    'theme=dark; ' + cookie + '; other=value')), true)

  assert.equal(allowedBridgeOrigin(request(undefined, '127.0.0.1', host,
    rc5DesktopCookie('localhost:53380'))), false, 'the cookie name is bound to the exact Host authority')
  assert.equal(allowedBridgeOrigin(request(undefined, '127.0.0.1', host,
    'dsh-auth-' + 'a'.repeat(43) + '=v1.payload.signature')), false,
  'an arbitrary dsh-auth cookie name is not a Desktop credential')
  assert.equal(allowedBridgeOrigin(request(undefined, '127.0.0.1', host,
    rc5DesktopCookie(host, ''))), false, 'an empty credential is not accepted')
})

test('opaque and cross-site browser origins cannot use the local exemption', () => {
  const host = '127.0.0.1:53380'
  const legacyCookie = rc5DesktopCookie(host)
  assert.equal(allowedBridgeOrigin(request('null')), false)
  assert.equal(allowedBridgeOrigin(request('null', '127.0.0.1', host, legacyCookie)), false)
  assert.equal(allowedBridgeOrigin(request('https://malicious.example')), false)
  assert.equal(allowedBridgeOrigin(request('https://malicious.example', '127.0.0.1', host, legacyCookie)), false)
  assert.equal(allowedBridgeOrigin(request('http://localhost:5000')), false)
  assert.equal(allowedBridgeOrigin(request('data:text/plain,hi')), false)
  assert.equal(allowedBridgeOrigin(request(undefined)), false,
    'a missing Origin requires a private Desktop forwarding cookie')
})

test('unrelated app origins do not bypass the local browser-origin boundary', () => {
  const host = '127.0.0.1:53380'
  const legacyCookie = rc5DesktopCookie(host)
  for (const origin of [
    'app://other', 'app://dsh.evil.example', 'app:opaque',
    'app://dsh@malicious.example', 'app://dsh/path', 'app://dsh:80',
    'dsh-app://app',
  ]) {
    assert.equal(allowedBridgeOrigin(request(origin)), false, origin)
    assert.equal(allowedBridgeOrigin(request(origin, '127.0.0.1', host,
      'dsh-desktop-session=private-test-cookie')), false,
    'an unrecognized explicit Origin must never become trusted via a current Desktop cookie: ' + origin)
    assert.equal(allowedBridgeOrigin(request(origin, '127.0.0.1', host, legacyCookie)), false,
    'an unrecognized explicit Origin must never become trusted via an rc.5 Desktop cookie: ' + origin)
  }
  assert.equal(allowedBridgeOrigin(request('APP://DSH')), true,
    'the established renderer Origin stays compatible when case differs')
})

test('remote peers cannot claim local desktop-origin exemptions', () => {
  const host = '127.0.0.1:53380'
  const legacyCookie = rc5DesktopCookie(host)
  assert.equal(allowedBridgeOrigin(request('null', '198.51.100.8')), false)
  assert.equal(allowedBridgeOrigin(request(undefined, '198.51.100.8')), false)
  assert.equal(allowedBridgeOrigin(request(undefined, '198.51.100.8', host, legacyCookie)), false)
  assert.equal(allowedBridgeOrigin(request('app://dsh', '198.51.100.8')), false)
  assert.equal(allowedBridgeOrigin(request('https://example.test', '198.51.100.8', 'example.test')), true)
})
