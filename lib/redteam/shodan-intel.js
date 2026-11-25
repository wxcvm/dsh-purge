/** Shodan REST API connection, plan check and single-IP passive host lookup. */
import { isIP } from 'node:net'
import { loadPlatformConfig, savePlatformConfig } from './platform-config.js'

export const DEFAULT_SHODAN_API_URL = 'https://api.shodan.io'
const MAX_KEY_LENGTH = 4096
const MAX_BODY = 4 * 1024 * 1024

export function normalizeShodanBaseUrl(value) {
  const raw = String(value || DEFAULT_SHODAN_API_URL).trim()
  let url
  try { url = new URL(raw) } catch { throw new Error('Shodan 接口地址无效') }
  const authorityEnd = raw.indexOf('://') + 3
  const pathStart = raw.indexOf('/', authorityEnd)
  const rawPath = pathStart < 0 ? '' : raw.slice(pathStart).split(/[?#]/)[0]
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash ||
      rawPath.split('/').some(segment => segment === '.' || segment === '..' || /^%2e(?:%2e)?$/i.test(segment))) {
    throw new Error('Shodan 接口地址须是 HTTPS 服务根地址或兼容网关路径')
  }
  while (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1)
  return url.origin + (url.pathname === '/' ? '' : url.pathname)
}

function endpoint(baseUrl, path) {
  const base = new URL(normalizeShodanBaseUrl(baseUrl))
  const prefix = base.pathname === '/' ? '' : base.pathname
  const suffix = String(path).startsWith('/') ? String(path).slice(1) : String(path)
  return new URL(base.origin + prefix + '/' + suffix)
}
export function loadShodanConnection(root) {
  const cfg = loadPlatformConfig(root)
  if (cfg.error) throw new Error(cfg.error)
  const localKey = String(cfg.env?.SHODAN_API_KEY || '').trim()
  const environmentKey = cfg.env?.SHODAN_API_KEY_DISABLED === 'true'
    ? '' : String(process.env.SHODAN_API_KEY || '').trim()
  const key = localKey || environmentKey
  const baseUrl = normalizeShodanBaseUrl(cfg.env?.SHODAN_BASE_URL || process.env.SHODAN_BASE_URL)
  return { key, baseUrl, credentialSource: localKey ? 'config' : environmentKey ? 'environment' : 'none' }
}

export function shodanConnectionGet(root) {
  const connection = loadShodanConnection(root)
  return {
    ok: true, configured: !!connection.key, baseUrl: connection.baseUrl,
    credentialSource: connection.credentialSource, verified: false,
    note: '已保存不代表连接通过；测试只读取 /api-info，不查询主机。',
  }
}

export function shodanConnectionSave(root, req = {}) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) throw new Error('Shodan 设置无效')
  const old = loadShodanConnection(root)
  if (req.key !== undefined && (typeof req.key !== 'string' || req.key.length > MAX_KEY_LENGTH)) {
    throw new Error('Shodan API Key 格式无效')
  }
  const newKey = typeof req.key === 'string' ? req.key.trim() : ''
  if (newKey.includes('\n') || newKey.includes('\r')) throw new Error('Shodan API Key 格式无效')
  const clearKey = req.clearKey === true
  if (clearKey && newKey) throw new Error('清除与更换 API Key 不能同时选择')
  const baseUrl = req.baseUrl === undefined ? old.baseUrl : normalizeShodanBaseUrl(req.baseUrl)
  if (baseUrl !== old.baseUrl && old.key && !newKey && !clearKey) {
    throw new Error('更换接口地址时请同时提供该服务的 Key，避免向新地址发送旧密钥')
  }
  const env = { SHODAN_BASE_URL: baseUrl }
  if (clearKey) {
    env.SHODAN_API_KEY = ''
    env.SHODAN_API_KEY_DISABLED = 'true'
  } else if (newKey) {
    env.SHODAN_API_KEY = newKey
    env.SHODAN_API_KEY_DISABLED = ''
  }
  savePlatformConfig({ env }, root)
  return shodanConnectionGet(root)
}

function connectionError(status, kind = 'account') {
  if (status === 401) return 'Shodan API Key 无效，请核对密钥'
  if (status === 403) return kind === 'host'
    ? '当前 Shodan 套餐或账户权限不支持 Host API 查询；可使用 InternetDB 免 Key 查询'
    : 'Shodan API 账户无权读取该接口'
  if (status === 402) return 'Shodan 账户额度不足'
  if (status === 404) return kind === 'host' ? 'Shodan 未找到该 IP 的主机记录' : 'Shodan API 信息接口不存在'
  if (status === 429) return 'Shodan 请求频率受限，请稍后重试'
  if (status === 503) return 'Shodan 服务暂时不可用'
  return 'Shodan 接口返回 HTTP ' + status
}

async function readBoundedJson(response) {
  const reader = response.body?.getReader?.()
  if (!reader) {
    const body = await response.text()
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY) throw new Error('response oversized')
    return JSON.parse(body)
  }
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BODY) throw new Error('response oversized')
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Reads account plan and credits only; does not query or scan a target. */
export async function shodanConnectionTest(root, options = {}) {
  let connection
  try { connection = loadShodanConnection(root) }
  catch (error) { return { ok: false, error: error?.message || 'Shodan 配置不可用' } }
  if (!connection.key) return { ok: false, error: '请先配置 Shodan API Key' }
  const url = endpoint(connection.baseUrl, 'api-info')
  url.searchParams.set('key', connection.key)
  try {
    const response = await (options.fetch || globalThis.fetch)(url, {
      method: 'GET', headers: { Accept: 'application/json' },
      redirect: 'error', signal: options.signal || AbortSignal.timeout(12000),
    })
    if (!response.ok) return { ok: false, error: connectionError(response.status, 'account') }
    const data = await readBoundedJson(response)
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        !['plan', 'query_credits', 'scan_credits', 'usage_limits'].some(key => key in data)) {
      return { ok: false, error: '接口返回格式与 Shodan API Info 不兼容' }
    }
    return {
      ok: true, configured: true, verified: true, testedAt: new Date().toISOString(),
      plan: typeof data.plan === 'string' ? data.plan.slice(0, 80) : null,
      queryCredits: numeric(data.query_credits), scanCredits: numeric(data.scan_credits),
      note: 'API Info 已响应；此测试不执行主机查询或主动扫描。',
    }
  } catch {
    return { ok: false, error: 'Shodan 连接失败、超时或返回格式不兼容' }
  }
}

/** One-IP passive lookup against Shodan's existing host database; never starts a scan. */
export async function shodanHostLookup(root, target, options = {}) {
  let connection
  try {
    connection = options.apiKey
      ? { key: String(options.apiKey), baseUrl: normalizeShodanBaseUrl(options.baseUrl) }
      : loadShodanConnection(root)
  } catch (error) {
    return { ok: false, error: error?.message || 'Shodan 配置不可用' }
  }
  if (!connection.key) return { ok: false, error: '请先配置 Shodan API Key' }
  const ip = String(target || '').trim()
  if (!isIP(ip)) return { ok: false, error: 'Shodan Host API 仅支持单个 IP 查询' }
  const url = endpoint(connection.baseUrl, 'shodan/host/' + encodeURIComponent(ip))
  url.searchParams.set('key', connection.key)
  try {
    const response = await (options.fetch || globalThis.fetch)(url, {
      method: 'GET', headers: { Accept: 'application/json' },
      redirect: 'error', signal: options.signal || AbortSignal.timeout(15000),
    })
    if (!response.ok) return { ok: false, error: connectionError(response.status, 'host') }
    const payload = await readBoundedJson(response)
    return { ok: true, payload }
  } catch {
    return { ok: false, error: 'Shodan Host 查询失败或响应无效' }
  }
}
