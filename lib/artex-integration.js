/**
 * Read-only ARTEX local integration.
 *
 * ARTEX Desktop identifies its Go backend at 127.0.0.1:8787/api/health and
 * manages Windows tools below %LOCALAPPDATA%/ARTEX/tools. We only reuse
 * executable paths from that layout. The optional privacy bridge uses its own
 * read-only credential; no ARTEX login credentials, config writes or process starts.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'

const HEALTH_URL = 'http://127.0.0.1:8787/api/health'
const PRIVACY_URL = 'http://127.0.0.1:8787/api/privacy/bridge-status'
export const ARTEX_SHARED_TOOLS = ['nuclei', 'httpx', 'subfinder', 'ffuf', 'dnsx', 'naabu', 'katana']

export function artexToolRoots(env = process.env) {
  const dirs = String(env.ARTEX_TOOL_DIRS || '').split(delimiter).filter(Boolean)
  if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'ARTEX', 'tools'))
  // ARTEX also searches tools relative to its executable. For a portable or D:-drive
  // installation, callers can opt in by setting ARTEX_HOME to that directory.
  const home = String(env.ARTEX_HOME || '').trim()
  if (home) dirs.push(join(home, 'data', 'tools'), join(home, 'tools'))
  return [...new Set(dirs.map(x => x.trim()).filter(Boolean).map(x => resolve(x)))]
}

function usableFile(file, platform) {
  try {
    const info = statSync(file)
    return info.isFile() && (platform === 'win32' || (info.mode & 0o111) !== 0)
  } catch { return false }
}

/** Locate only the small set of binaries that ARTEX's Tool Manager supports. */
export function findArtexTool(id, options = {}) {
  if (!ARTEX_SHARED_TOOLS.includes(id)) return null
  const env = options.env || process.env
  const platform = options.platform || process.platform
  const binary = id + (platform === 'win32' ? '.exe' : '')
  for (const root of artexToolRoots(env)) {
    const paths = [
      join(root, binary), join(root, id, binary), join(root, id, 'current', binary),
    ]
    // Older or manual ARTEX layouts may use a versioned folder instead of current/.
    const base = join(root, id)
    if (existsSync(base)) {
      try {
        for (const name of readdirSync(base).sort().reverse()) {
          if (name.startsWith('.') || name === 'current') continue
          paths.push(join(base, name, binary))
        }
      } catch { /* inaccessible tool folder */ }
    }
    for (const path of paths) if (usableFile(path, platform)) return path
  }
  return null
}

/**
 * The health endpoint differs across ARTEX forks. Only an explicit service
 * identity confirms ARTEX; 401/403 and a generic 200 are unverified candidates.
 * Redirects are never followed and credentials are never sent.
 */
export async function probeLocalArtex(options = {}) {
  const request = options.fetchFn || fetch
  try {
    const reply = await request(HEALTH_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(900),
      redirect: 'manual',
    })
    const httpStatus = reply.status
    if (httpStatus === 401 || httpStatus === 403) {
      return { state: 'service_candidate', httpStatus,
        reason: '本机健康接口需要认证，尚不能确认服务身份' }
    }
    if (!reply.ok) {
      return { state: 'service_candidate', httpStatus,
        reason: '本机健康接口响应异常，尚不能确认服务身份' }
    }
    let info
    try { info = await reply.json() }
    catch {
      return { state: 'service_candidate', httpStatus,
        reason: '健康接口未返回有效 JSON，尚不能确认服务身份' }
    }
    if (!info || info.service !== 'artex') {
      return { state: 'service_candidate', httpStatus,
        reason: '健康接口没有可验证的 ARTEX 服务标识' }
    }
    if (info.ok !== true) {
      return { state: 'degraded', httpStatus,
        reason: 'ARTEX 身份已确认，但健康状态异常' }
    }
    return { state: 'detected', httpStatus,
      version: typeof info.version === 'string' ? info.version : '' }
  } catch {
    return { state: 'absent', httpStatus: null,
      reason: '本机健康接口无响应' }
  }
}

/**
 * Read a coarse privacy snapshot using a separately configured, scoped credential.
 * A health check is not authentication: never send the token to an unverified
 * service, a configurable remote URL, or a redirect target.
 */
export async function probeLocalArtexPrivacy(options = {}) {
  const result = (privacyExposure, privacyHttpStatus = null, privacyScope = null, privacySource = null) => ({
    privacyExposure, privacyHttpStatus, privacyScope, privacySource,
    publicReachability: 'not_tested',
  })
  if (options.health?.state !== 'detected') return result('not_inspected')
  const env = options.env || process.env
  const token = String(env.DSH_PURGE_ARTEX_PRIVACY_TOKEN || '').trim()
  if (!token) return result('not_configured')
  const request = options.fetchFn || fetch
  try {
    const reply = await request(PRIVACY_URL, {
      method: 'GET',
      headers: { 'X-Artex-Privacy-Token': token },
      signal: AbortSignal.timeout(900),
      redirect: 'manual',
    })
    const status = reply.status
    if (status === 401 || status === 403) return result('auth_rejected', status)
    if (status === 404 || status === 405) return result('unsupported', status)
    if (!reply.ok) return result('unavailable', status)
    let info
    try { info = await reply.json() }
    catch { return result('invalid_response', status) }
    const scopes = ['loopback', 'all_interfaces', 'specific_interface', 'unknown']
    const sources = ['runtime_listener', 'configured', 'not_inspected']
    if (!info || info.service !== 'artex' || info.public_reachability !== 'not_tested'
      || !scopes.includes(info.scope) || !sources.includes(info.binding_source)) {
      return result('invalid_response', status)
    }
    if (info.binding_source === 'not_inspected') return result('not_inspected', status)
    return result(info.binding_source === 'runtime_listener' ? 'runtime_observed' : 'configured_only',
      status, info.scope, info.binding_source)
  } catch {
    // Do not forward exceptions: request details could include the credential.
    return result('unavailable')
  }
}

/** No ARTEX login, database, or model API is accessed. */
export async function inspectArtex(options = {}) {
  const env = options.env || process.env
  const probe = options.probe || probeLocalArtex
  const result = await probe()
  // Keep compatible with existing in-process probes that return {version}.
  const health = result?.state ? result : result ? { state: 'detected', ...result }
    : { state: 'absent' }
  const tools = ARTEX_SHARED_TOOLS.map(id => ({ id, path: findArtexTool(id, options) }))
  const found = tools.filter(x => x.path)
  const state = health.state === 'absent' && found.length > 0
    ? 'installed_offline' : health.state
  const online = state === 'detected'
  return {
    ok: true,
    online,
    state,
    httpStatus: health.httpStatus ?? null,
    version: online ? (health.version || '') : '',
    url: 'http://127.0.0.1:8787/',
    toolCount: found.length,
    tools: found,
    toolRoots: artexToolRoots(env).filter(existsSync),
    skillDir: env.ARTEX_SKILL_DIR && existsSync(env.ARTEX_SKILL_DIR) ? resolve(env.ARTEX_SKILL_DIR) : '',
    note: health.reason || (online ? 'ARTEX 服务身份已确认'
      : state === 'installed_offline' ? '找到 ARTEX 本机工具，但没有检测到运行中的 ARTEX 服务'
      : '未检测到本机 ARTEX 服务'),
  }
}
