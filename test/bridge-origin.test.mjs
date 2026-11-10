import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedBridgeOrigin } from '../lib/redteam/bridge-origin.js'

function request(origin, remoteAddress = '127.0.0.1', host = '127.0.0.1:53380') {
  const headers = { host }
  if (origin !== undefined) headers.origin = origin
  return { socket: { remoteAddress }, headers }
}

test('local desktop and same-origin browser requests remain compatible', () => {
  assert.equal(allowedBridgeOrigin(request(undefined)), true)
  assert.equal(allowedBridgeOrigin(request('null')), true)
  assert.equal(allowedBridgeOrigin(request('app://dsh')), true)
  assert.equal(allowedBridgeOrigin(request('http://127.0.0.1:53380')), true)
  assert.equal(allowedBridgeOrigin(request('http://localhost:53380', '::1', 'localhost:53380')), true)
})

test('cross-site requests to localhost are denied even over loopback', () => {
  assert.equal(allowedBridgeOrigin(request('https://malicious.example')), false)
  assert.equal(allowedBridgeOrigin(request('http://localhost:5000')), false)
  assert.equal(allowedBridgeOrigin(request('data:text/plain,hi')), false)
})

test('remote peers cannot claim local desktop-origin exemptions', () => {
  assert.equal(allowedBridgeOrigin(request('null', '198.51.100.8')), false)
  assert.equal(allowedBridgeOrigin(request(undefined, '198.51.100.8')), false)
  assert.equal(allowedBridgeOrigin(request('app://dsh', '198.51.100.8')), false)
  assert.equal(allowedBridgeOrigin(request('https://example.test', '198.51.100.8', 'example.test')), true)
})
