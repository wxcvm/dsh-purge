import test from 'node:test'
import assert from 'node:assert/strict'
import { collectNetworkPrivacy } from '../lib/redteam/network-privacy.js'

test('local snapshot aggregates address families without disclosing addresses or proxy secrets', () => {
  const result = collectNetworkPrivacy({
    interfaces: () => ({ privateName: [
      { family: 'IPv4', address: '192.0.2.7', internal: false },
      { family: 6, address: '2001:db8::7', internal: false },
      { family: 4, address: '127.0.0.1', internal: true },
    ] }),
    servers: () => ['192.0.2.53:5353', '[2001:db8::53]:5353', 'invalid'],
    env: { https_proxy: 'http://secret:password@localhost:8080', NO_PROXY: 'private.domain' },
    now: () => new Date('2026-11-12T00:00:00Z'), platform: 'win32',
  })
  assert.deepEqual(result.interfaces, { status: 'observed', ipv4: 1, ipv6: 1, internal: 1 })
  assert.deepEqual(result.dns, { status: 'observed', ipv4: 1, ipv6: 1, other: 1 })
  assert.equal(result.proxyEnvironment.find(x => x.name === 'HTTPS_PROXY').configured, true)
  assert.equal(result.proxyEnvironment.find(x => x.name === 'HTTP_PROXY').configured, false)
  assert.equal(result.egress.ipv4, 'not_tested')
  assert.equal(result.actualDns, 'not_tested')
  assert.equal(result.browserWebRtc, 'not_tested')
  assert.equal(result.observedAt, '2026-11-12T00:00:00.000Z')
  const json = JSON.stringify(result)
  for (const value of ['192.0.2.', '2001:db8', 'privateName', 'password', 'private.domain']) {
    assert.ok(!json.includes(value))
  }
})
test('failed observations stay unknown; empty observed lists are distinct', () => {
  const failure = collectNetworkPrivacy({ interfaces: () => { throw Error('private') }, servers: () => { throw Error('private') }, env: {} })
  assert.deepEqual(failure.interfaces, { status: 'unknown' })
  assert.deepEqual(failure.dns, { status: 'unknown' })
  const empty = collectNetworkPrivacy({ interfaces: () => ({}), servers: () => [], env: {} })
  assert.equal(empty.interfaces.status, 'observed')
  assert.equal(empty.interfaces.ipv4, 0)
  assert.equal(empty.dns.ipv6, 0)
})
