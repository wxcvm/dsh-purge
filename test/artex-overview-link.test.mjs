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
