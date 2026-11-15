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
