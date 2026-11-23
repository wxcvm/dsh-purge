import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isPublicIPv4, verifyModeBExit } from '../lib/redteam/proxy-mode-b-verify.js'

const snapshot = () => ({
  enabled: true, strictEgress: true, activeId: 'mode-b',
  profiles: [{ id: 'mode-b', enabled: true, kind: 'mihomo-chain', hopCount: 3,
    finalExit: 'vps2_configured_unverified', verification: 'not_tested' }],
})

test('expected and observed exit must be real public IPv4, not placeholders or private networks', () => {
  assert.equal(isPublicIPv4('8.8.8.8'), true)
  assert.equal(isPublicIPv4('1.1.1.1'), true)
  for (const ip of ['', 'not-an-ip', '127.0.0.1', '10.0.0.1', '172.16.0.1',
    '192.168.1.1', '100.64.0.1', '169.254.1.1', '192.0.2.10',
    '198.51.100.20', '203.0.113.30', '198.18.0.2', '224.0.0.1']) {
    assert.equal(isPublicIPv4(ip), false, ip)
  }
})

test('Mode B exit verifier only accepts an active, strict, three-hop profile', async () => {
  let requests = 0
  const request = async () => { requests++; return { statusCode: 200, body: '8.8.8.8' } }
  const cases = [
    { ...snapshot(), enabled: false },
    { ...snapshot(), strictEgress: false },
    { ...snapshot(), activeId: 'another-profile' },
    { ...snapshot(), profiles: [{ ...snapshot().profiles[0], kind: 'direct' }] },
    { ...snapshot(), profiles: [{ ...snapshot().profiles[0], hopCount: 2 }] },
    { ...snapshot(), profiles: [{ ...snapshot().profiles[0], enabled: false }] },
  ]
  for (const state of cases) {
    await assert.rejects(verifyModeBExit('8.8.8.8', { snapshot: state, root: '/fixture', request }), /三跳模式 B/)
  }
  await assert.rejects(verifyModeBExit('192.0.2.10', { snapshot: snapshot(), root: '/fixture', request }), /公网 IPv4/)
  assert.equal(requests, 0, 'invalid profiles cannot initiate a network request')
})

test('one explicitly proxied request validates exit, but never claims intermediate hops', async () => {
  let requests = 0
  const result = await verifyModeBExit('8.8.8.8', {
    snapshot: snapshot(),
    root: '/fixture',
    request: async (root, url, options) => {
      requests++
      assert.equal(root, '/fixture')
      assert.equal(url, 'https://api.ipify.org/')
      assert.equal(options.requireProxy, true)
      assert.equal(options.timeout, 15000)
      return { statusCode: 200, body: '8.8.8.8\n' }
    },
  })
  assert.equal(requests, 1)
  assert.equal(result.ok, true)
  assert.equal(result.verification, 'exit_ip_matched')
  assert.equal(result.scope, 'purge_plugin_http_only')
  assert.equal(result.upstreamHops, 'not_tested')
  assert.doesNotMatch(JSON.stringify(result), /8\.8\.8\.8/)
  assert.ok(Number.isFinite(Date.parse(result.observedAt)))
})

test('a mismatch, failed upstream or invalid observation cannot be accepted', async () => {
  for (const response of [
    { statusCode: 403, body: '8.8.8.8' },
    { statusCode: 200, body: '1.1.1.1' },
    { statusCode: 200, body: '127.0.0.1' },
    { statusCode: 200, body: '<script>not an IP</script>' },
  ]) {
    await assert.rejects(verifyModeBExit('8.8.8.8', {
      snapshot: snapshot(), root: '/fixture', request: async () => response,
    }))
  }
  await assert.rejects(verifyModeBExit('8.8.8.8', {
    snapshot: snapshot(), root: '/fixture', request: async () => { throw new Error('gateway down') },
  }), /gateway down/)
})

test('operator CLI uses the verifier and does not print observed address or secrets', () => {
  const source = readFileSync(new URL('../scripts/mode-b-verify.mjs', import.meta.url), 'utf8')
  assert.match(source, /verifyModeBExit/)
  assert.match(source, /--expected-exit-ip/)
  assert.match(source, /NOT TESTED/)
  assert.doesNotMatch(source, /console\.log\(.*observed|process\.env\.HTTP_PROXY|fetch\(/)
})
