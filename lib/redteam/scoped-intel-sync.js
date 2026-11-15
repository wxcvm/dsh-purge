/** Explicit local-only transfer of saved historical intelligence to ARTEX. */
import { buildScopedIntelInventory } from './scoped-intel-inventory.js'
import { probeLocalArtex } from '../artex-integration.js'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from './atomic-write.js'
import { privateDirectory, privateFile } from './private-storage.js'
import { SecretVault } from './secret-vault.js'

const ENDPOINT = 'http://127.0.0.1:8787/api/purge/intel-bridge'
const MAX_BYTES = 8 * 1024 * 1024

export function scopedIntelSyncConfig(env = process.env) {
  const token = String(env.DSH_PURGE_ARTEX_INTEL_TOKEN || '').trim()
  const company = String(env.DSH_PURGE_ARTEX_INTEL_COMPANY_ID || '').trim()
  const companyId = /^[1-9][0-9]*$/.test(company) && Number.isSafeInteger(Number(company)) ? Number(company) : null
  const distinct = !['DSH_PURGE_ARTEX_PRIVACY_TOKEN', 'DSH_PURGE_ARTEX_OVERVIEW_TOKEN']
    .some(key => token && token === String(env[key] || '').trim())
  return { configured: token.length >= 32 && distinct && companyId !== null, companyId, endpoint: ENDPOINT }
}

const TOKEN = 'DSH_PURGE_ARTEX_INTEL_TOKEN'
const COMPANY = 'DSH_PURGE_ARTEX_INTEL_COMPANY_ID'
const FIELD = 'artex.intel.token'
const pairingFile = root => join(root, 'artex-intel-pairing.json')
const vaultOf = store => store.secretVault || new SecretVault(process.env.DSH_PURGE_SECRET_KEY)
const envOverride = env => !!(String(env[TOKEN] || '').trim() || String(env[COMPANY] || '').trim())

// A pair is resolved as a unit; never mix one environment field with a saved one.
export function resolveScopedIntelPairing(store, env = process.env) {
  if (envOverride(env)) return { env, source: 'environment', encrypted: false }
  if (!store?.root) return { env, source: 'none', encrypted: false }
  try {
    const saved = JSON.parse(readFileSync(pairingFile(store.root), 'utf8'))
    if (!saved || typeof saved.token !== 'string' || !Number.isSafeInteger(saved.companyId) || saved.companyId < 1)
      throw Error('invalid pairing')
    const vault = vaultOf(store)
    const token = vault.decrypt(saved.token, FIELD)
    return { env: { ...env, [TOKEN]: token, [COMPANY]: String(saved.companyId) },
      source: 'saved', encrypted: vault.isEncrypted(saved.token) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { env, source: 'none', encrypted: false }
    throw Error('无法读取本机 ARTEX 配对配置；请检查密钥或重新配对')
  }
}

export function savedScopedIntelConfig(store, env = process.env) {
  const resolved = resolveScopedIntelPairing(store, env)
  return { ok: true, ...scopedIntelSyncConfig(resolved.env), source: resolved.source, encrypted: resolved.encrypted }
}

export function saveScopedIntelPairing(store, req, env = process.env) {
  if (envOverride(env)) return { ok: false, error: '宿主环境变量正在接管配对；请先在宿主清除或修改它们' }
  if (!store?.root) return { ok: false, error: '本机配置目录不可用' }
  if (req.clear === true) {
    rmSync(pairingFile(store.root), { force: true })
    return savedScopedIntelConfig(store, env)
  }
  const token = typeof req.token === 'string' ? req.token.trim() : ''
  const company = String(req.companyId || '').trim()
  const config = scopedIntelSyncConfig({ ...env, [TOKEN]: token, [COMPANY]: company })
  if (!config.configured || token.length > 4096 || !/^[!-~]+$/.test(token) || token.startsWith('dshp:vault:v1:'))
    return { ok: false, error: '请输入有效的独立情报令牌（至少 32 个可见 ASCII 字符）及正整数公司 ID' }
  const vault = vaultOf(store)
  privateDirectory(store.root)
  atomicWriteFileSync(pairingFile(store.root), JSON.stringify({ companyId: config.companyId, token: vault.encrypt(token, FIELD) }))
  privateFile(pairingFile(store.root))
  return savedScopedIntelConfig(store, env)
}

// Explicit read-only check: never sends the inventory or changes ARTEX state.
export async function probeScopedIntelPairing(options = {}) {
  const env = options.env || process.env
  const config = scopedIntelSyncConfig(env)
  if (!config.configured) return { ok: false, status: 'not_configured', error: '未配置独立情报令牌或接收公司 ID' }
  const request = options.fetchFn || globalThis.fetch
  try {
    const health = await (options.probe || probeLocalArtex)({ fetchFn: request })
    if (health?.state !== 'detected') return { ok: false, status: 'unavailable', error: '未确认本机 ARTEX 服务' }
    const reply = await request(ENDPOINT + '/status', {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: {
        'X-Artex-Purge-Intel-Token': String(env.DSH_PURGE_ARTEX_INTEL_TOKEN).trim(),
        'X-Artex-Purge-Intel-Company': String(config.companyId),
      },
    })
    if (!reply.ok) {
      const status = reply.status
      return { ok: false, status: status === 409 ? 'company_mismatch' : status === 401 || status === 403 ? 'auth_rejected' : status === 404 || status === 405 ? 'unsupported_or_missing' : 'unavailable',
        httpStatus: status, error: status === 409 ? '两端接收公司不一致'
          : status === 401 || status === 403 ? '凭据未被接受，或当前 ARTEX 尚不支持配对检测'
          : status === 404 || status === 405 ? '配对接口或接收公司不存在，请检查 ARTEX 版本和公司配置'
          : 'ARTEX 配对检测暂不可用' }
    }
    const data = await reply.json()
    if (data?.service !== 'artex' || data.schema_version !== 1 || data.paired !== true ||
        data.company_id !== config.companyId || !Number.isSafeInteger(data.scope_count) || data.scope_count < 0)
      return { ok: false, status: 'invalid_response', error: '配对检测回执无效' }
    return { ok: true, status: 'paired', companyId: config.companyId, scopeCount: data.scope_count }
  } catch {
    return { ok: false, status: 'unavailable', error: '无法确认配对状态' }
  }
}

// Read the paired company's summary only. Never accept a destination or company
// override from the renderer, and never pass through unrecognized response fields.
export async function readScopedIntelOverview(store, options = {}) {
  const env = options.env || resolveScopedIntelPairing(store).env
  const config = scopedIntelSyncConfig(env)
  if (!config.configured) return { ok: false, error: '尚未配置 ARTEX 配对' }
  const request = options.fetchFn || globalThis.fetch
  const count = value => Number.isSafeInteger(value) && value >= 0
  const id = value => Number.isSafeInteger(value) && value > 0
  try {
    const health = await (options.probe || probeLocalArtex)({ fetchFn: request })
    if (health?.state !== 'detected') return { ok: false, error: '未确认本机 ARTEX 服务' }
    const reply = await request(ENDPOINT + '/overview', { method: 'GET', redirect: 'error',
      signal: AbortSignal.timeout(5000), headers: {
        'X-Artex-Purge-Intel-Token': String(env.DSH_PURGE_ARTEX_INTEL_TOKEN).trim(),
        'X-Artex-Purge-Intel-Company': String(config.companyId),
      } })
    if (!reply.ok) return { ok: false, httpStatus: reply.status,
      error: reply.status === 409 ? '两端公司不匹配' : reply.status === 401 || reply.status === 403
        ? '配对未被接受，或 ARTEX 版本尚不支持概览' : 'ARTEX 项目概览暂不可用，请检查服务版本' }
    const v = await reply.json()
    if (v?.service !== 'artex' || v.schema_version !== 1 || v.company_id !== config.companyId ||
        ![v.task_count,v.asset_count,v.linked_finding_count,v.snapshot_count].every(count) ||
        !Array.isArray(v.tasks) || v.tasks.length > 50 || !Array.isArray(v.snapshots) || v.snapshots.length > 20 ||
        !v.tasks.every(t => id(t?.id) && typeof t.status === 'string' && typeof t.paused === 'boolean' && typeof t.queued === 'boolean') ||
        !v.snapshots.every(t => id(t?.id) && typeof t.received_at === 'string'))
      return { ok: false, error: 'ARTEX 项目概览回执无效' }
    return { ok: true, companyId: config.companyId, taskCount: v.task_count, assetCount: v.asset_count,
      linkedFindingCount: v.linked_finding_count, snapshotCount: v.snapshot_count,
      tasks: v.tasks.map(t => ({ id:t.id, status:t.status, paused:t.paused, queued:t.queued })),
      snapshots: v.snapshots.map(t => ({ id:t.id, receivedAt:t.received_at })) }
  } catch { return { ok: false, error: '无法读取 ARTEX 项目概览' } }
}

// Read only the configured company and explicitly selected page/snapshot.
export async function readScopedIntelDetail(store, req = {}, options = {}) {
  const env = options.env || resolveScopedIntelPairing(store).env
  const config = scopedIntelSyncConfig(env)
  if (!config.configured) return { ok:false, error:'尚未配置 ARTEX 配对' }
  if (req.companyId !== config.companyId) return { ok:false, error:'配对公司已变化，请刷新项目概览' }
  const id = n => Number.isSafeInteger(n) && n > 0
  const count = n => Number.isSafeInteger(n) && n >= 0
  let suffix
  if (req.kind === 'assets' && (req.before === undefined || id(req.before))) suffix = '/assets' + (req.before ? '?before=' + req.before : '')
  else if (req.kind === 'snapshot' && id(req.snapshotId)) suffix = '/snapshot?snapshot=' + req.snapshotId
  else return { ok:false, error:'无效的 ARTEX 详情请求' }
  try {
    const request = options.fetchFn || globalThis.fetch
    const health = await (options.probe || probeLocalArtex)({ fetchFn:request })
    if (health?.state !== 'detected') return {ok:false,error:'未确认本机 ARTEX 服务'}
    const reply = await request(ENDPOINT + suffix, { method:'GET', redirect:'error', signal:AbortSignal.timeout(5000),
      headers:{ 'X-Artex-Purge-Intel-Token':String(env.DSH_PURGE_ARTEX_INTEL_TOKEN).trim(),
        'X-Artex-Purge-Intel-Company':String(config.companyId) } })
    if (!reply.ok) return {ok:false,httpStatus:reply.status,error:reply.status === 409
      ? '公司或授权范围已变化，请刷新配对与项目数据' : 'ARTEX 详情不可用，请检查版本或记录是否存在'}
    const v = await reply.json()
    if (v?.service !== 'artex' || v.schema_version !== 1 || v.company_id !== config.companyId)
      return {ok:false,error:'ARTEX 详情回执无效'}
    if (req.kind === 'assets') {
      if (!Array.isArray(v.items) || v.items.length > 50 || !count(v.next_before) ||
        !v.items.every(a=>id(a?.id) && [a.type,a.domain,a.ip,a.app_name,a.service_type,a.last_seen].every(x=>typeof x==='string') &&
          count(a.port) && a.port<=65535) || (v.next_before !== 0 && (v.items.length !== 50 || v.next_before !== v.items[49].id)))
        return {ok:false,error:'ARTEX 资产回执无效'}
      return {ok:true,companyId:config.companyId,nextBefore:v.next_before,items:v.items.map(a=>({
        id:a.id,type:a.type,domain:a.domain,ip:a.ip,port:a.port,appName:a.app_name,serviceType:a.service_type,lastSeen:a.last_seen}))}
    }
    const a=v.analysis
    const fields=['names','ips','edges','port_observations','excluded_dns','unknown_transport_ports','ports_without_observation_time','shared_addresses']
    const lists=['names_with_multiple_sources','names_without_dns','names_with_dns_failures','names_without_retained_address','ips_without_domain_link','ips_without_port_evidence']
    if (v.snapshot_id !== req.snapshotId || a?.schema !== 'artex.purge-intel-analysis.v1' || a.historical_only !== true ||
        typeof a.target !== 'string' || typeof a.truncated !== 'boolean' || !fields.every(k=>count(a[k])) ||
        !lists.every(k=>Array.isArray(a[k]) && a[k].length<=500 && a[k].every(x=>typeof x==='string')))
      return {ok:false,error:'ARTEX 历史分析回执无效'}
    return {ok:true,companyId:config.companyId,snapshotId:v.snapshot_id,analysis:{
      target:a.target,historical_only:true,truncated:a.truncated,
      ...Object.fromEntries([...fields,...lists].map(k=>[k,a[k]]))}}
  } catch { return {ok:false,error:'无法读取 ARTEX 详情'} }
}

export async function syncScopedIntelToArtex(store, req = {}, options = {}) {
  if (req.confirm !== true) throw new Error('请明确确认向本机 ARTEX 发送历史情报')
  const env = options.env || resolveScopedIntelPairing(store).env
  const config = scopedIntelSyncConfig(env)
  if (!config.configured) throw new Error('未配置独立情报令牌或接收公司 ID')
  if (req.companyId !== config.companyId) throw new Error('接收公司配置已变化，请重新确认')
  const inventory = buildScopedIntelInventory(store, req)
  if (!inventory.names.length && !inventory.ips.length) throw new Error('没有可同步的授权情报')
  const body = JSON.stringify(inventory)
  if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) throw new Error('情报清单超过 8 MiB')
  const request = options.fetchFn || globalThis.fetch
  // Fixed literal loopback, same health probe as existing integration; no redirects.
  const health = await (options.probe || probeLocalArtex)({ fetchFn: request })
  if (health?.state !== 'detected') return { ok: false, status: 'unavailable', error: '未确认本机 ARTEX 服务' }
  try {
    const reply = await request(ENDPOINT, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json',
        'X-Artex-Purge-Intel-Token': String(env.DSH_PURGE_ARTEX_INTEL_TOKEN).trim(),
        'X-Artex-Purge-Intel-Company': String(config.companyId) },
      body,
    })
    if (!reply.ok) {
      const status = reply.status
      return { ok: false, status: 'rejected', httpStatus: status,
        error: status === 401 ? 'ARTEX 拒绝情报令牌' : status === 409 ? 'ARTEX 接收公司不匹配'
          : status === 400 ? 'ARTEX 拒绝情报结构或公司范围' : 'ARTEX 导入未成功' }
    }
    const data = await reply.json()
    if (data?.historical_only !== true || data.company_id !== config.companyId ||
        !Number.isSafeInteger(data.id) || data.id < 1 || data.names !== inventory.names.length || data.ips !== inventory.ips.length ||
        typeof data.digest !== 'string' || !/^[a-f0-9]{64}$/.test(data.digest))
      return { ok: false, status: 'unknown', error: '未能确认导入回执；请在 ARTEX 查看历史' }
    return { ok: true, status: 'imported', engagement: inventory.engagement,
      companyId: config.companyId, snapshotId: data.id, digest: data.digest, names: data.names, ips: data.ips,
      historicalOnly: true }
  } catch {
    // Never include a request exception, body, or secret in the UI.
    return { ok: false, status: 'unknown', error: '无法确认传输结果；请在 ARTEX 查看历史后重试' }
  }
}
