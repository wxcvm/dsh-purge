import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { probeLocalArtexOverview } from '../lib/artex-integration.js'

const health = { state: 'detected' }
const env = { DSH_PURGE_ARTEX_OVERVIEW_TOKEN: 'synthetic-overview-token', DSH_PURGE_ARTEX_PRIVACY_TOKEN: 'synthetic-listener-token' }
const fixture = () => ({
  service: 'artex', schema_version: 1, overview: {
    model_keys: { state: 'complete', key_state: 'configured', total: 4, empty: 1, plaintext_only: 1, encrypted_only: 1, mixed: 1, verified: 1, failed: 1, unchecked: 0, profiles: [{ id: 'private-profile-id' }] },
    config: { file_state: 'readable', file_permissions: 'windows_acl_not_inspected', profiles_state: 'complete', profiles_checked: 4, findings: 2, incomplete_findings: 1, path: 'private-path' },
    outbound: { total: 10, retained: 5, capacity: 256, http_responses: 2, http_non_2xx: 1, transport_failures: 1, canceled: 1, timeouts: 1, proxy_configured: 1, events: [{ host: 'private.example.test' }] },
    listener: { address: 'private-address' },
  },
})
test('overview requires its own opt-in credential and confirmed local service', async () => {
  let calls = 0
  const fetchFn = async () => { calls++; throw new Error('unexpected') }
  assert.equal((await probeLocalArtexOverview({ health, env: { DSH_PURGE_ARTEX_PRIVACY_TOKEN: 'old' }, fetchFn })).status, 'not_configured')
  for (const state of ['absent', 'degraded', 'service_candidate']) {
    assert.equal((await probeLocalArtexOverview({ health: { state }, env, fetchFn })).status, 'not_inspected')
  }
  assert.equal(calls, 0)
})
test('overview whitelists aggregate values and uses only the dedicated local route', async () => {
  const got = await probeLocalArtexOverview({ health, env, fetchFn: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8787/api/privacy/bridge-overview')
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'manual')
    assert.deepEqual(options.headers, { 'X-Artex-Privacy-Overview-Token': env.DSH_PURGE_ARTEX_OVERVIEW_TOKEN })
    return { status: 200, ok: true, json: async () => fixture() }
  } })
  assert.equal(got.status, 'complete')
  assert.equal(got.summary.modelKeys.verified, 1)
  assert.equal(got.summary.config.findings, 2)
  assert.equal(got.summary.outbound.retained, 5)
  assert.doesNotMatch(JSON.stringify(got), /private-|private\.example|synthetic-/)
})
test('overview rejects invalid counts, versions, errors and redirects', async () => {
  for (const change of [
    x => { x.schema_version = 2 },
    x => { x.overview.model_keys.total = 8 },
    x => { x.overview.model_keys.failed = -1 },
    x => { x.overview.config.incomplete_findings = 9 },
    x => { x.overview.outbound.retained = 6 },
    x => { x.overview.config.file_permissions = 'unknown-value' },
  ]) {
    const body = fixture(); change(body)
    const got = await probeLocalArtexOverview({ health, env, fetchFn: async () => ({ status: 200, ok: true, json: async () => body }) })
    assert.equal(got.status, 'invalid_response')
    assert.equal(got.summary, null)
  }
  for (const [status, expected] of [[401, 'auth_rejected'], [404, 'unsupported'], [302, 'unavailable'], [503, 'unavailable']]) {
    assert.equal((await probeLocalArtexOverview({ health, env, fetchFn: async () => ({ status, ok: false }) })).status, expected)
  }
  const got = await probeLocalArtexOverview({ health, env, fetchFn: async () => { throw new Error('synthetic-overview-token') } })
  assert.equal(got.status, 'unavailable')
  assert.doesNotMatch(JSON.stringify(got), /synthetic-/)
})
test('overview is triggered by a button, not automatic posture loading', () => {
  const host = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  assert.match(host, /request\.op === 'artexPrivacyOverview'/)
  for (const file of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    const begin = source.indexOf('function LowImpactTab(props)')
    const end = source.indexOf('const runArtexOverview =', begin)
    assert.ok(begin >= 0 && end > begin)
    assert.doesNotMatch(source.slice(begin, end), /artexPrivacyOverview/)
    assert.match(source, /api\(\{ op: 'artexPrivacyOverview' \}\)/)
    assert.match(source, /onClick: runArtexOverview/)
  }
})

test('Mode B bridge accepts only explicit executor exit comparison states', async () => {
  const make = network => {
    const value = fixture()
    if (network !== undefined) value.overview.execution_network = network
    return value
  }
  const read = body => probeLocalArtexOverview({ health, env,
    fetchFn: async () => ({ status: 200, ok: true, json: async () => body }) })
  const absent = await read(make(undefined))
  assert.equal(absent.status, 'complete')
  assert.equal(absent.summary.network.configuration, 'not_reported')
  assert.equal(absent.summary.network.verification, 'not_tested')

  const legacy = { mode: 'B', configuration: 'configured_only', verification: 'not_tested',
    scope: 'runner_builtins_intended', final_exit: 'not_tested',
    proxy_url: 'http://private-secret@untrusted.example:7890' }
  const configured = await read(make(legacy))
  assert.equal(configured.status, 'complete')
  assert.deepEqual(configured.summary.network, {
    mode: 'B', configuration: 'configured_only', verification: 'not_tested',
    scope: 'runner_builtins_intended', finalExit: 'not_tested',
    actualEgress: 'not_tested', observedAt: null, failClosed: 'not_tested',
    verifyBeforeTask: false, coveredProcesses: [],
  })
  assert.doesNotMatch(JSON.stringify(configured), /private-secret|untrusted.example/)

  const verified = {
    ...legacy,
    verification: 'exit_ip_match',
    final_exit: 'matched_expected',
    actual_egress: 'matches_expected',
    observed_at: '2026-11-24T05:00:00.123456789Z',
    fail_closed: 'not_tested',
    verify_before_task: false,
    covered_processes: ['linux_docker_tool_executor_proxy_aware'],
    observed_ip: '203.0.113.99',
  }
  const matched = await read(make(verified))
  assert.equal(matched.status, 'complete')
  assert.deepEqual(matched.summary.network, {
    mode: 'B', configuration: 'configured_only', verification: 'exit_ip_match',
    scope: 'runner_builtins_intended', finalExit: 'matched_expected',
    actualEgress: 'matches_expected', observedAt: verified.observed_at,
    failClosed: 'not_tested', verifyBeforeTask: false,
    coveredProcesses: ['linux_docker_tool_executor_proxy_aware'],
  })
  assert.doesNotMatch(JSON.stringify(matched), /203\.0\.113\.99|private-secret|untrusted.example/)

  for (const state of [
    { verification: 'exit_ip_mismatch', final_exit: 'mismatch', actual_egress: 'mismatch' },
    { verification: 'probe_failed', final_exit: 'unavailable', actual_egress: 'unavailable' },
  ]) {
    const result = await read(make({ ...verified, ...state }))
    assert.equal(result.status, 'complete')
    assert.equal(result.summary.network.verification, state.verification)
    assert.equal(result.summary.network.finalExit, state.final_exit)
    assert.equal(result.summary.network.actualEgress, state.actual_egress)
  }

  const modeOffWithRuntimeEvidence = await read(make({
    ...verified, mode: 'off', configuration: 'not_configured', scope: 'none',
  }))
  assert.equal(modeOffWithRuntimeEvidence.status, 'invalid_response')

  for (const bad of [
    { ...verified, verification: 'verified' },
    { ...verified, final_exit: 'vps2' },
    { ...verified, configuration: 'not_configured' },
    { ...verified, scope: 'all_processes' },
    { ...verified, actual_egress: '203.0.113.99' },
    { ...verified, verify_before_task: true },
    { ...verified, observed_at: 'not-a-date' },
    { ...verified, covered_processes: ['external_mcp'] },
    { ...verified, actual_egress: 'mismatch' },
  ]) {
    const result = await read(make(bad))
    assert.equal(result.status, 'invalid_response')
    assert.equal(result.summary, null)
  }
})
test('both Purge clients distinguish an exit-IP comparison from hop and process coverage', () => {
  for (const file of ['../lib/redteam/client.js', '../client.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(src, /ARTEX 任务网络（模式 B）/)
    assert.match(src, /预期最终出口 IP 已匹配/)
    assert.match(src, /逐跳未核验/)
    assert.match(src, /失败关闭未验证/)
    assert.match(src, /MCP、外部浏览器和 Windows 原生任务不在此覆盖范围/)
  }
})
