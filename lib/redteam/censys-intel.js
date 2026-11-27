/** Censys Platform API v3 connection and single-host passive lookup. */
import { isIP } from 'node:net'
import { loadPlatformConfig, savePlatformConfig } from './platform-config.js'
import { censysPatStorageStatus, loadCensysPat, platformSecretVaultEnabled, saveCensysPat } from './platform-secret-store.js'

export const CENSYS_API_BASE_URL = 'https://api.platform.censys.io'
export const CENSYS_HOST_ACCEPT = 'application/vnd.censys.api.v3.host.v1+json'
export const CENSYS_HOST_FIELDS = 'ip,dns.names,services.port,services.protocol,services.transport_protocol,services.scan_time,services.software'
const MAX_TOKEN_LENGTH = 4096
const MAX_BODY = 4 * 1024 * 1024

export function normalizeCensysOrganizationId(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    throw new Error('Censys Organization ID 格式无效')
  }
  return raw.toLowerCase()
}

/** Internal credential read. Callers must never return the PAT to the UI. */
export function loadCensysConnection(root) {
  const cfg = loadPlatformConfig(root)
  if (cfg.error) throw new Error(cfg.error)
  const envToken = String(process.env.CENSYS_PAT || '').trim()
  const legacyToken = String(cfg.env?.CENSYS_PAT || '').trim()
  const stored = censysPatStorageStatus(root)
  const storedToken = stored.configured ? loadCensysPat(root) : ''
  const token = storedToken || legacyToken || envToken
  const storageMode = storedToken ? 'encrypted-local'
    : legacyToken ? 'legacy-plaintext'
      : envToken ? 'environment' : 'none'
  const organizationId = normalizeCensysOrganizationId(
    cfg.env?.CENSYS_ORG_ID || process.env.CENSYS_ORG_ID || '',
  )
  return {
    token, organizationId, storageMode,
    protectedAtRest: storageMode === 'encrypted-local',
    vaultEnabled: stored.vaultEnabled,
  }
}

export function censysConnectionGet(root) {
  const cfg = loadPlatformConfig(root)
  if (cfg.error) throw new Error(cfg.error)
  const stored = censysPatStorageStatus(root)
  let storedToken = ''
  let credentialError = stored.error ? '本机平台凭据文件无法读取或格式无效' : ''
  if (stored.configured && !stored.error) {
    try { storedToken = loadCensysPat(root) }
    catch (error) { credentialError = error?.message || '本地 Censys PAT 无法解密' }
  }
  const legacyToken = String(cfg.env?.CENSYS_PAT || '').trim()
  const envToken = String(process.env.CENSYS_PAT || '').trim()
  const token = storedToken || legacyToken || envToken
  const storageMode = stored.configured ? storedToken ? 'encrypted-local' : 'encrypted-local-locked'
    : legacyToken ? 'legacy-plaintext'
      : envToken ? 'environment' : 'none'
  const organizationId = normalizeCensysOrganizationId(
    cfg.env?.CENSYS_ORG_ID || process.env.CENSYS_ORG_ID || '',
  )
  return {
    ok: true,
    configured: !!token || stored.configured,
    organizationConfigured: !!organizationId,
    organizationId,
    storageMode,
    protectedAtRest: stored.protectedAtRest,
    vaultEnabled: stored.vaultEnabled,
    ...(credentialError ? { credentialError } : {}),
    apiVersion: 'v3',
    verified: false,
    note: '本地 PAT 使用 DSH_PURGE_SECRET_KEY 的 AES-256-GCM 加密保存；测试只访问零额度账户接口。单 IP 主机查询每个资产消耗 1 credit。',
  }
}

export function censysConnectionSave(root, req = {}) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) throw new Error('Censys 设置无效')
  const cfg = loadPlatformConfig(root)
  if (cfg.error) throw new Error(cfg.error)
  if (req.token !== undefined && (typeof req.token !== 'string' || req.token.length > MAX_TOKEN_LENGTH)) {
    throw new Error('Censys PAT 格式无效')
  }
  const newToken = typeof req.token === 'string' ? req.token.trim() : ''
  if (newToken && /[\r\n]/.test(newToken)) throw new Error('Censys PAT 格式无效')
  const clearToken = req.clearToken === true
  if (clearToken && newToken) throw new Error('清除与更换 PAT 不能同时选择')
  const oldOrganizationId = normalizeCensysOrganizationId(
    cfg.env?.CENSYS_ORG_ID || process.env.CENSYS_ORG_ID || '',
  )
  const organizationId = req.organizationId === undefined
    ? oldOrganizationId
    : normalizeCensysOrganizationId(req.organizationId)
  if (req.clearOrganizationId === true && req.organizationId !== undefined && organizationId) {
    throw new Error('清除与设置 Organization ID 不能同时选择')
  }

  const legacyToken = String(cfg.env?.CENSYS_PAT || '').trim()
  const envToken = String(process.env.CENSYS_PAT || '').trim()
  const env = {}
  if (clearToken) {
    saveCensysPat('', root)
    env.CENSYS_PAT = ''
  } else if (newToken) {
    saveCensysPat(newToken, root)
    env.CENSYS_PAT = ''
  } else if (legacyToken && platformSecretVaultEnabled() && !censysPatStorageStatus(root).configured) {
    saveCensysPat(legacyToken, root)
    env.CENSYS_PAT = ''
  }
  if (req.clearOrganizationId === true) env.CENSYS_ORG_ID = ''
  else if (req.organizationId !== undefined) env.CENSYS_ORG_ID = organizationId
  if (Object.keys(env).length) savePlatformConfig({ env }, root)
  return censysConnectionGet(root)
}

function connectionError(status, organizationId, kind = 'account') {
  if (status === 401) return 'Censys PAT 无效，请检查或重新生成 Personal Access Token'
  if (status === 403) return 'Censys API Access 权限不足，或当前账号无权读取该组织数据'
  if (status === 402) return 'Censys 账户额度不足'
  if (status === 404) {
    if (kind === 'host') return 'Censys 未找到该 IP 的主机记录'
    return organizationId ? 'Censys Organization ID 无效或组织不可访问' : 'Censys 账户未找到或接口不可用'
  }
  if (status === 422) return kind === 'host' ? 'Censys 主机查询参数无效' : 'Censys Organization ID 或账户参数无效'
  if (status === 429 || status === 503) return 'Censys 请求频率或并发额度受限，请稍后重试'
  return 'Censys 接口返回 HTTP ' + status
}

/** Zero-credit account/credit endpoint check; never performs a host lookup. */
export async function censysConnectionTest(root, options = {}) {
  let connection
  try { connection = loadCensysConnection(root) }
  catch (error) { return { ok: false, error: error?.message || 'Censys 配置不可用' } }
  if (!connection.token) return { ok: false, error: '请先配置 Censys Platform PAT' }
  const path = connection.organizationId
    ? '/v3/accounts/organizations/' + encodeURIComponent(connection.organizationId) + '/credits'
    : '/v3/accounts/users/credits'
  const url = new URL(path, CENSYS_API_BASE_URL)
  const fetcher = options.fetch || globalThis.fetch
  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + connection.token, Accept: 'application/json' },
      redirect: 'error',
      signal: options.signal || AbortSignal.timeout(12000),
    })
    if (!response.ok) return { ok: false, error: connectionError(response.status, connection.organizationId, 'account') }
    return {
      ok: true,
      configured: true,
      verified: true,
      testedAt: new Date().toISOString(),
      testScope: connection.organizationId ? 'organization-credit-balance' : 'free-user-credit-balance',
      note: '账户额度接口验证成功；该测试不执行主机查询且不消耗查询额度。',
    }
  } catch {
    return { ok: false, error: 'Censys 连接失败或响应无效' }
  }
}

async function readBoundedBody(response) {
  const reader = response.body?.getReader?.()
  if (!reader) {
    const body = await response.text()
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY) throw new Error('response oversized')
    return body
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
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** One-IP passive asset lookup. Scope and external-consent checks belong to scoped-intel.js. */
export async function censysHostLookup(root, target, options = {}) {
  let connection
  try { connection = loadCensysConnection(root) }
  catch (error) { return { ok: false, error: error?.message || 'Censys 配置不可用' } }
  if (!connection.token) return { ok: false, error: '请先配置 Censys Platform PAT' }
  if (isIP(String(target || '').trim()) === 0) return { ok: false, error: 'Censys 仅支持单个 IP 查询' }
  const url = new URL('/v3/global/asset/host/' + encodeURIComponent(target), CENSYS_API_BASE_URL)
  url.searchParams.set('fields', CENSYS_HOST_FIELDS)
  if (connection.organizationId) url.searchParams.set('organization_id', connection.organizationId)
  const fetcher = options.fetch || globalThis.fetch
  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + connection.token, Accept: CENSYS_HOST_ACCEPT },
      redirect: 'error',
      signal: options.signal || AbortSignal.timeout(15000),
    })
    if (!response.ok) return { ok: false, error: connectionError(response.status, connection.organizationId, 'host') }
    const body = await readBoundedBody(response)
    let payload
    try { payload = JSON.parse(body) } catch { return { ok: false, error: 'Censys 返回格式无效' } }
    return { ok: true, payload, creditCost: 1 }
  } catch {
    return { ok: false, error: 'Censys 查询失败或响应无效' }
  }
}
