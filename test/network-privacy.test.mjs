import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
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

const client = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
const helperStart = client.indexOf('    function compareNetworkPrivacy(')
const helperEnd = client.indexOf('    function NetworkPrivacyCard()', helperStart)
assert.ok(helperStart >= 0 && helperEnd > helperStart)
const { compareNetworkPrivacy, networkPrivacyReport } = runInNewContext(
  client.slice(helperStart, helperEnd) + '\n;({ compareNetworkPrivacy, networkPrivacyReport })'
)
const plain = x => JSON.parse(JSON.stringify(x))
const sample = overrides => ({
  observedAt: '2026-11-12T00:00:00Z', platform: 'win32',
  interfaces: { status: 'observed', ipv4: 1, ipv6: 2, internal: 2 },
  dns: { status: 'observed', ipv4: 1, ipv6: 0, other: 0 },
  proxyEnvironment: [{ name: 'HTTPS_PROXY', configured: false }],
  ...overrides,
})
test('comparison distinguishes changed, equal and unavailable observations', () => {
  const before = sample()
  const after = sample({ interfaces: { status: 'observed', ipv4: 2, ipv6: 2, internal: 2 },
    dns: { status: 'unknown' }, proxyEnvironment: [{ name: 'HTTPS_PROXY', configured: true }] })
  const rows = compareNetworkPrivacy(before, after)
  assert.equal(rows.length, 10)
  assert.equal(rows.find(x => x.label === '网络地址 ipv4').state, 'changed')
  assert.equal(rows.find(x => x.label === '网络地址 ipv6').state, 'same')
  assert.equal(rows.find(x => x.label === 'Node DNS ipv4').state, 'unknown')
  assert.equal(rows.find(x => x.label === 'HTTPS_PROXY').state, 'changed')
  assert.equal(rows.find(x => x.label === 'HTTP_PROXY').state, 'unknown')
  assert.equal(compareNetworkPrivacy(before, sample({ platform: 'linux' })).length, 0)
  assert.equal(compareNetworkPrivacy(null, after).length, 0)
})
test('report keeps observations and comparison but not extra source properties', () => {
  const before = sample({ interfaces: { status: 'observed', ipv4: 1, ipv6: 2, internal: 2, address: '192.0.2.23' },
    proxyEnvironment: [{ name: 'HTTPS_PROXY', configured: true, value: 'sensitive-secret' }],
    privateField: 'sensitive-secret' })
  const after = sample({ dns: { status: 'unknown', ipv4: 99 }, observedAt: '2026-11-12T00:01:00Z' })
  const report = plain(networkPrivacyReport(before, after))
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.current.observedAt, after.observedAt)
  assert.deepEqual(report.current.dns, { status: 'unknown' })
  assert.deepEqual(report.current.egress, { ipv4: 'not_tested', ipv6: 'not_tested' })
  assert.equal(report.current.actualDns, 'not_tested')
  assert.equal(report.comparison.length, 10)
  assert.ok(!JSON.stringify(report).includes('sensitive-secret'))
  assert.ok(!JSON.stringify(report).includes('192.0.2.23'))
  assert.equal(networkPrivacyReport(null, after).baseline, null)
})
