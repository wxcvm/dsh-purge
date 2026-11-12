/** Explicit local-only transfer of saved historical intelligence to ARTEX. */
import { buildScopedIntelInventory } from './scoped-intel-inventory.js'
import { probeLocalArtex } from '../artex-integration.js'

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

export async function syncScopedIntelToArtex(store, req = {}, options = {}) {
  if (req.confirm !== true) throw new Error('请明确确认向本机 ARTEX 发送历史情报')
  const env = options.env || process.env
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
