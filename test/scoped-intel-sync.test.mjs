import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'
import { scopedIntelSyncConfig, syncScopedIntelToArtex, probeScopedIntelPairing, savedScopedIntelConfig, saveScopedIntelPairing, resolveScopedIntelPairing, readScopedIntelOverview } from '../lib/redteam/scoped-intel-sync.js'

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

test('pairing probe is read-only, fixed loopback and validates identity without leaking credentials', async () => {
  let calls = 0
  const result = await probeScopedIntelPairing({ env, fetchFn: async (url, opts) => {
    calls++
    if (calls === 1) {
      assert.equal(url, 'http://127.0.0.1:8787/api/health')
      assert.equal(opts.headers, undefined)
      return new Response(JSON.stringify({ service: 'artex', ok: true }))
    }
    assert.equal(url, 'http://127.0.0.1:8787/api/purge/intel-bridge/status')
    assert.equal(opts.method, 'GET')
    assert.equal(opts.body, undefined)
    assert.equal(opts.redirect, 'error')
    assert.equal(opts.headers['X-Artex-Purge-Intel-Token'], token)
    return new Response(JSON.stringify({ service: 'artex', schema_version: 1, paired: true, company_id: 12, scope_count: 2 }))
  } })
  assert.deepEqual(result, { ok: true, status: 'paired', companyId: 12, scopeCount: 2 })
  assert.equal(calls, 2)
  const probe = async () => ({ state: 'detected' })
  assert.equal((await probeScopedIntelPairing({ env, probe, fetchFn: async () => new Response('', { status: 409 }) })).status, 'company_mismatch')
  assert.equal((await probeScopedIntelPairing({ env, probe, fetchFn: async () => new Response('', { status: 401 }) })).status, 'auth_rejected')
  assert.equal((await probeScopedIntelPairing({ env, probe, fetchFn: async () => new Response(JSON.stringify({ service: 'artex', schema_version: 1, paired: true, company_id: 99, scope_count: 2 })) })).status, 'invalid_response')
  const fail = await probeScopedIntelPairing({ env, probe, fetchFn: async () => { throw Error(token) } })
  assert.equal(JSON.stringify(fail).includes(token), false)
})

test('saved pairing survives reopening and never returns the token; environment override is whole-pair', t => {
  const store = fixture(t)
  const local = saveScopedIntelPairing(store, { token, companyId: 12 }, {})
  assert.equal(local.configured, true)
  assert.equal(local.source, 'saved')
  assert.equal(JSON.stringify(local).includes(token), false)
  assert.equal(savedScopedIntelConfig({ root: store.root, secretVault: store.secretVault }, {}).companyId, 12)
  assert.equal(resolveScopedIntelPairing(store, {}).env.DSH_PURGE_ARTEX_INTEL_TOKEN, token)
  const overridden = savedScopedIntelConfig(store, { DSH_PURGE_ARTEX_INTEL_COMPANY_ID: '99' })
  assert.equal(overridden.configured, false)
  assert.equal(overridden.source, 'environment')
  assert.equal(saveScopedIntelPairing(store, { clear: true }, env).ok, false)
  assert.equal(saveScopedIntelPairing(store, { clear: true }, {}).configured, false)
})

test('saved pairing reuses existing vault encryption and rejects invalid input without replacement', t => {
  const store = fixture(t)
  const encrypted = new RedteamStore(store.root, { secretKey: 'a'.repeat(64) })
  t.after(() => encrypted.close())
  const r = saveScopedIntelPairing(encrypted, { token, companyId: 12 }, {})
  assert.equal(r.encrypted, true)
  const file = join(store.root, 'artex-intel-pairing.json')
  const before = readFileSync(file, 'utf8')
  assert.equal(before.includes(token), false)
  assert.equal(saveScopedIntelPairing(encrypted, { token: 'short', companyId: 12 }, {}).ok, false)
  assert.equal(readFileSync(file, 'utf8'), before)
  assert.equal(resolveScopedIntelPairing(encrypted, {}).env.DSH_PURGE_ARTEX_INTEL_TOKEN, token)
  assert.throws(() => resolveScopedIntelPairing(store, {}), /无法读取/)
})

test('overview uses paired company only and whitelists read-only metadata', async () => {
  const probe = async () => ({ state:'detected' })
  const payload = { service:'artex', schema_version:1, company_id:12, task_count:1, asset_count:3,
    linked_finding_count:2, snapshot_count:1, tasks:[{id:7,status:'running',paused:false,queued:false,description:'private'}],
    snapshots:[{id:9,received_at:'2026-11-15',payload:'private'}], token }
  const result = await readScopedIntelOverview(null,{env,probe,fetchFn:async(url,opts)=>{
    assert.equal(url,'http://127.0.0.1:8787/api/purge/intel-bridge/overview')
    assert.equal(opts.method,'GET')
    assert.equal(opts.body,undefined)
    assert.equal(opts.headers['X-Artex-Purge-Intel-Company'],'12')
    return new Response(JSON.stringify(payload))
  }})
  assert.equal(result.ok,true)
  assert.equal(result.taskCount,1)
  assert.deepEqual(result.tasks,[{id:7,status:'running',paused:false,queued:false}])
  assert.equal(JSON.stringify(result).includes('private'),false)
  assert.equal(JSON.stringify(result).includes(token),false)
  assert.equal((await readScopedIntelOverview(null,{env,probe,fetchFn:async()=>new Response(JSON.stringify({...payload,company_id:99}))})).ok,false)
})
