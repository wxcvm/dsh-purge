import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'
import { scopedIntelSyncConfig, syncScopedIntelToArtex } from '../lib/redteam/scoped-intel-sync.js'

const token = 'fixture-only-32-character-secret-123'
const env = { DSH_PURGE_ARTEX_INTEL_TOKEN: token, DSH_PURGE_ARTEX_INTEL_COMPANY_ID: '12' }
const domain = 'example.test'
const req = { target: domain, companyId: 12, confirm: true }

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'intel-sync-'))
  const store = new RedteamStore(root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  store.openEngagement('lab', [domain])
  return store
}

test('configuration exposes no secret and rejects reused privacy credential', () => {
  assert.deepEqual(scopedIntelSyncConfig(env), { configured: true, companyId: 12, endpoint: 'http://127.0.0.1:8787/api/purge/intel-bridge' })
  assert.equal(scopedIntelSyncConfig({ ...env, DSH_PURGE_ARTEX_PRIVACY_TOKEN: token }).configured, false)
  assert.equal(scopedIntelSyncConfig({ ...env, DSH_PURGE_ARTEX_INTEL_COMPANY_ID: '12.5' }).configured, false)
})

test('requires consent, matching company and authorized local evidence before network', async t => {
  const store = fixture(t)
  let calls = 0
  const options = { env, fetchFn: async () => { calls++; throw Error('unexpected network') } }
  for (const change of [{confirm:false}, {companyId:13}, {target:'outside.test'}])
    await assert.rejects(syncScopedIntelToArtex(store, {...req,...change}, options))
  assert.equal(calls, 0)
})

test('checks local service first, transfers only historical inventory and validates receipt', async t => {
  const store = fixture(t)
  let calls = 0
  const r = await syncScopedIntelToArtex(store, req, { env, fetchFn: async (url, opts) => {
    calls++
    if (calls === 1) {
      assert.equal(url, 'http://127.0.0.1:8787/api/health')
      assert.equal(opts.headers, undefined)
      return new Response(JSON.stringify({ service:'artex', ok:true }))
    }
    assert.equal(url, 'http://127.0.0.1:8787/api/purge/intel-bridge')
    assert.equal(opts.redirect, 'error')
    assert.equal(opts.headers['X-Artex-Purge-Intel-Token'], token)
    assert.equal(opts.headers['X-Artex-Purge-Intel-Company'], '12')
    const b = JSON.parse(opts.body)
    assert.equal(b.schema, 'purge.asset-intel.v1')
    assert.equal(b.mode, 'offline-passive')
    assert.equal(b.target, domain)
    assert.equal(opts.body.includes(token), false)
    return new Response(JSON.stringify({ id:7, company_id:12, names:b.names.length, ips:b.ips.length, digest:'a'.repeat(64), historical_only:true }))
  }})
  assert.equal(r.ok, true)
  assert.equal(r.snapshotId, 7)
  assert.equal(calls, 2)
})

test('unverified service or ambiguous receipt is never reported as imported', async t => {
  const store = fixture(t)
  let calls = 0
  const r = await syncScopedIntelToArtex(store, req, { env, fetchFn: async () => {
    calls++; return new Response(JSON.stringify({ ok:true, service:'other' }))
  }})
  assert.equal(r.ok, false)
  assert.equal(calls, 1)
  const bad = await syncScopedIntelToArtex(store, req, { env, probe: async () => ({state:'detected'}),
    fetchFn: async () => { throw Error(token) } })
  assert.equal(bad.status, 'unknown')
  assert.equal(JSON.stringify(bad).includes(token), false)
  const mismatched = await syncScopedIntelToArtex(store, req, { env, probe: async () => ({state:'detected'}),
    fetchFn: async () => new Response(JSON.stringify({id:7,company_id:99,historical_only:true})) })
  assert.equal(mismatched.ok, false)
  assert.equal(mismatched.status, 'unknown')
})
