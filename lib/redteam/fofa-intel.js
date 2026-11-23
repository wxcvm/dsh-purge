/** FOFA-compatible passive search over explicitly registered IP/domain targets. */
import { isIP } from 'node:net'
import { loadPlatformConfig, savePlatformConfig } from './platform-config.js'
import { targetInScope } from './scan-runner.js'
import { normalizeDnsName } from './scoped-dns-intel.js'

export const DEFAULT_FOFA_URL = 'https://fofa.info'
const FIELDS = 'host,ip,port,protocol,title,product,lastupdatetime'
const MAX_BODY = 3 * 1024 * 1024

export function normalizeFofaBaseUrl(value) {
  const raw = String(value || DEFAULT_FOFA_URL).trim()
  let url
  try { url = new URL(raw) } catch { throw new Error('FOFA 接口地址无效') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash ||
      !['', '/', '/api/v1', '/api/v1/'].includes(url.pathname)) {
    throw new Error('FOFA 接口地址须是 HTTPS 服务根地址（可带 /api/v1）')
  }
  url.pathname = '/'
  return url.origin
}

function loadConnection(root) {
  const cfg = loadPlatformConfig(root)
  if (cfg.error) throw new Error(cfg.error)
  const key = String(cfg.env?.FOFA_KEY || process.env.FOFA_KEY || '').trim()
  return { key, baseUrl: normalizeFofaBaseUrl(cfg.env?.FOFA_BASE_URL) }
}

export function fofaConnectionGet(root) {
  const { key, baseUrl } = loadConnection(root)
  return { ok: true, configured: !!key, baseUrl, verified: false,
    note: '已保存不代表连接通过；测试连接不会执行资产搜索。' }
}

export function fofaConnectionSave(root, req = {}) {
  if (!req || typeof req !== 'object') throw new Error('FOFA 设置无效')
  const old = loadConnection(root)
  const baseUrl = req.baseUrl === undefined ? old.baseUrl : normalizeFofaBaseUrl(req.baseUrl)
  if (req.key !== undefined && (typeof req.key !== 'string' || req.key.length > 4096))
    throw new Error('FOFA Key 格式无效')
  const newKey = typeof req.key === 'string' ? req.key.trim() : ''
  const clearKey = req.clearKey === true
  if (clearKey && newKey) throw new Error('清除与更换 Key 不能同时选择')
  if (baseUrl !== old.baseUrl && old.key && !newKey && !clearKey)
    throw new Error('更换接口地址时请同时提供该服务的 Key，避免向新地址发送旧密钥')
  const env = { FOFA_BASE_URL: baseUrl }
  if (clearKey) env.FOFA_KEY = ''
  else if (newKey) env.FOFA_KEY = newKey
  savePlatformConfig({ env }, root)
  return fofaConnectionGet(root)
}

function errorCode(status, data) {
  if (status === 401 || status === 403) return '认证失败，请核对 FOFA Key'
  if (status === 402 || status === 429) return '额度不足或请求受限'
  if (status < 200 || status >= 300) return '接口返回 HTTP ' + status
  if (data?.error === true) {
    const msg = String(data.errmsg || data.message || '').toLowerCase()
    if (/key|auth|token|invalid|401|403/.test(msg)) return '认证失败，请核对 FOFA Key'
    if (/limit|quota|point|429|rate|余额|额度/.test(msg)) return '额度不足或请求受限'
    return 'FOFA 接口拒绝了请求'
  }
  return null
}

async function getJson(fetcher, url, signal) {
  const response = await fetcher(url, { redirect: 'error', signal })
  if (!response || typeof response.status !== 'number') throw new Error('invalid response')
  const reader = response.body?.getReader?.()
  if (!reader) {
    const value = await response.json()
    return { status: response.status, data: value }
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
    let data
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch {
      if (response.status >= 200 && response.status < 300) throw new Error('invalid JSON response')
      data = {}
    }
    return { status: response.status, data }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function fofaConnectionTest(root, options = {}) {
  const { key, baseUrl } = loadConnection(root)
  if (!key) return { ok: false, error: '请先配置 FOFA Key' }
  const url = new URL('/api/v1/info/my', baseUrl)
  url.searchParams.set('key', key)
  try {
    const { status, data } = await getJson(options.fetch || globalThis.fetch, url, AbortSignal.timeout(12000))
    const error = errorCode(status, data)
    if (error) return { ok: false, error }
    if (!data || typeof data !== 'object' || (!('error' in data) && !('email' in data) && !('username' in data)))
      return { ok: false, error: '接口返回格式与 FOFA 不兼容' }
    return { ok: true, testedAt: new Date().toISOString(),
      note: '账户接口已响应；不代表资产查询额度充足。' }
  } catch {
    return { ok: false, error: '连接失败、超时或返回格式不兼容' }
  }
}

function clean(value, size = 256) {
  return typeof value === 'string' ? value.trim().slice(0, size) : ''
}
function hostName(value) {
  const raw = clean(value)
  try {
    const host = new URL(raw.includes('://') ? raw : 'https://' + raw).hostname
    return normalizeDnsName(host)
  } catch { return '' }
}
export function parseFofaResults(data, target, scope) {
  if (!data || !Array.isArray(data.results)) throw new Error('invalid FOFA result format')
  const targetIP = isIP(target) > 0
  const items = []
  for (const row of data.results.slice(0, 100)) {
    if (!Array.isArray(row)) continue
    const [host, ip, port, protocol, title, product, updatedAt] = row
    const address = clean(ip, 100)
    const hostname = hostName(host)
    const allowed = targetIP ? address === target : !!hostname && targetInScope(scope, hostname).ok
    if (!allowed) continue
    const portNo = Number(port)
    items.push({ host: clean(host), ip: address,
      port: Number.isInteger(portNo) && portNo >= 1 && portNo <= 65535 ? portNo : null,
      protocol: clean(protocol, 24), title: clean(title), product: clean(product),
      observedAt: clean(updatedAt, 60), source: 'fofa', provenance: 'passive' })
  }
  return items
}

function fofaTargetAuthorized(scope, target) {
  return targetInScope(scope, target).ok || (isIP(target) === 0 &&
    scope.some(rule => typeof rule === 'string' &&
      rule.trim().toLowerCase().replace(/\.$/, '') === '*.' + target))
}

export async function runFofaSearch(store, req = {}, options = {}) {
  const engagement = store.listEngagements().find(e => e.id === (req.engagement || store.activeEngagementId?.()))
  if (!engagement || !Array.isArray(engagement.scope) || engagement.scope.length === 0)
    throw new Error('请先选择并登记项目授权范围')
  const rawTarget = String(req.target || '').trim()
  let target
  try { target = isIP(rawTarget) ? rawTarget : normalizeDnsName(rawTarget) }
  catch { throw new Error('只能查询单个已登记 IP 或域名') }
  if (!fofaTargetAuthorized(engagement.scope, target)) throw new Error('目标不在登记范围内')
  if (req.confirmExternal !== true) throw new Error('请确认向 FOFA 提交本次查询')
  const { key, baseUrl } = loadConnection(store.root)
  if (!key) return { ok: false, error: '请先配置 FOFA Key' }
  const page = Number(req.page ?? 1)
  if (!Number.isInteger(page) || page < 1 || page > 20) throw new Error('FOFA 页码范围为 1–20')
  const hasWildcard = !isIP(target) && engagement.scope.some(rule => String(rule).trim().toLowerCase() === '*.' + target)
  const expression = isIP(target) ? 'ip="' + target + '"' : (hasWildcard ? 'domain="' : 'host="') + target + '"'
  const url = new URL('/api/v1/search/all', baseUrl)
  url.searchParams.set('key', key)
  url.searchParams.set('qbase64', Buffer.from(expression).toString('base64'))
  url.searchParams.set('fields', FIELDS)
  url.searchParams.set('page', String(page))
  url.searchParams.set('size', '20')
  try {
    const { status, data } = await getJson(options.fetch || globalThis.fetch, url, AbortSignal.timeout(15000))
    const error = errorCode(status, data)
    if (error) return { ok: false, error }
    // The registered scope may have changed while the network call was in progress.
    const current = store.listEngagements().find(e => e.id === engagement.id)
    if (!current?.scope || !fofaTargetAuthorized(current.scope, target))
      return { ok: false, error: '查询期间项目授权范围发生变化' }
    const items = parseFofaResults(data, target, current.scope)
    return { ok: true, engagement: engagement.id, source: 'fofa', target, page,
      total: Number.isSafeInteger(data.size) && data.size >= 0 ? data.size : null,
      items, retrievedAt: new Date().toISOString(),
      note: '仅展示符合当前授权范围的历史情报；未自动写入实时资产或端口。' }
  } catch {
    return { ok: false, error: 'FOFA 查询失败、超时或返回格式不兼容' }
  }
}
