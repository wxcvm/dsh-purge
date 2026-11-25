import { isIP } from 'node:net'
import { loadPlatformConfig, savePlatformConfig } from './platform-config.js'

export const SHODAN_API_BASE_URL = 'https://api.shodan.io'
const MAX_KEY_LENGTH = 512
const MAX_RESPONSE_BYTES = 256 * 1024

function configuredKey(root, override) {
  if (typeof override === 'string' && override.trim()) return override.trim()
  const config = loadPlatformConfig(root)
  if (config.error) throw new Error(config.error)
  return String(config.env?.SHODAN_API_KEY || process.env.SHODAN_API_KEY || '').trim()
}

function clean(value, limit = 120) {
  return typeof value === 'string' ? value.replace(/[\r\n\t\0]/g, ' ').trim().slice(0, limit) : ''
}

function safeCount(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

async function readJsonBounded(response) {
  const reader = response.body?.getReader?.()
  let body
  if (!reader) {
    if (typeof response.text === 'function') {
      body = await response.text()
      if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('response oversized')
    } else if (typeof response.json === 'function') {
      const value = await response.json()
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_RESPONSE_BYTES) throw new Error('invalid response')
      return value
    } else throw new Error('invalid response')
  } else {
    const chunks = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_RESPONSE_BYTES) throw new Error('response oversized')
        chunks.push(Buffer.from(value))
      }
      body = Buffer.concat(chunks).toString('utf8')
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
  const value = JSON.parse(body)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid response')
  return value
}

function connectionError(status, kind = 'account') {
  if (status === 401) return 'Shodan API Key 无效，请检查或重新生成 API Key'
  if (status === 403) return kind === 'host'
    ? 'Shodan Host API 需要 Shodan Membership 或更高权限；免费 IP 查询可使用 InternetDB'
    : 'Shodan 当前账户无权读取该 API 信息'
  if (status === 402) return 'Shodan 账户额度不足或套餐不支持该操作'
  if (status === 404) return kind === 'host' ? 'Shodan 没有该 IP 的主机记录' : 'Shodan API 账户接口不可用'
  if (status === 429) return 'Shodan 请求频率受限，请稍后重试'
  if (status >= 500) return 'Shodan 服务暂时不可用'
  return 'Shodan 接口返回 HTTP ' + status
}

/** Write-only API key settings. The key is never returned to the UI. */
export function shodanConnectionGet(root) {
  const key = configuredKey(root)
  return {
    ok: true,
    configured: !!key,
    note: 'Shodan 官方 REST API 将 API Key 放在 HTTPS 查询参数中；仅使用可信网络出口。连接测试只访问 api-info，不执行主机查询。',
  }
}

export function shodanConnectionSave(root, req = {}) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) throw new Error('Shodan 设置无效')
  const old = loadPlatformConfig(root)
  if (old.error) throw new Error(old.error)
  const env = { ...(old.env || {}) }
  const newKey = typeof req.key === 'string' ? req.key.trim() : ''
  if (newKey.length > MAX_KEY_LENGTH || /[\r\n\0]/.test(newKey)) throw new Error('Shodan API Key 格式无效')
  if (req.clearKey === true && newKey) throw new Error('不能同时设置新 Key 和清除 Key')
  if (newKey) env.SHODAN_API_KEY = newKey
  else if (req.clearKey === true) env.SHODAN_API_KEY = ''
  savePlatformConfig({ env }, root)
  return shodanConnectionGet(root)
}

/** Account-only validation. It does not perform a host lookup or active scan. */
export async function shodanConnectionTest(root, options = {}) {
  let key
  try { key = configuredKey(root) } catch { return { ok: false, error: 'Shodan 配置不可用' } }
  if (!key) return { ok: false, error: '请先配置 Shodan API Key' }
  const fetcher = options.fetch || globalThis.fetch
  if (typeof fetcher !== 'function') return { ok: false, error: '当前运行环境不支持 HTTPS 请求' }
  const url = new URL('/api-info', SHODAN_API_BASE_URL)
  url.searchParams.set('key', key)
  try {
    const response = await fetcher(url, {
      method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return { ok: false, error: connectionError(response.status, 'account') }
    const payload = await readJsonBounded(response)
    return {
      ok: true, verified: true, plan: clean(payload.plan, 80) || 'unknown',
      queryCredits: safeCount(payload.query_credits), scanCredits: safeCount(payload.scan_credits),
      monitoredIps: safeCount(payload.monitored_ips), testedAt: new Date().toISOString(),
      note: '已验证 Shodan api-info 账户接口；未执行主机查询或扫描。',
    }
  } catch {
    return { ok: false, error: 'Shodan 连接失败或响应无效' }
  }
}

/** Single-IP, minified passive host lookup. No search query or active scan. */
export async function shodanHostLookup(root, target, options = {}) {
  let key
  try { key = configuredKey(root, options.key) } catch { return { ok: false, error: 'Shodan 配置不可用' } }
  if (!key) return { ok: false, error: '请先配置 Shodan API Key' }
  const ip = String(target || '').trim()
  if (isIP(ip) === 0) return { ok: false, error: 'Shodan 主机查询仅支持单个 IP' }
  const fetcher = options.fetch || globalThis.fetch
  if (typeof fetcher !== 'function') return { ok: false, error: '当前运行环境不支持 HTTPS 请求' }
  const url = new URL('/shodan/host/' + encodeURIComponent(ip), SHODAN_API_BASE_URL)
  url.searchParams.set('minify', 'true')
  url.searchParams.set('key', key)
  try {
    const response = await fetcher(url, {
      method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return { ok: false, error: connectionError(response.status, 'host') }
    return { ok: true, payload: await readJsonBounded(response), mode: 'minified-host-lookup' }
  } catch {
    return { ok: false, error: 'Shodan 主机查询失败或响应无效' }
  }
}
