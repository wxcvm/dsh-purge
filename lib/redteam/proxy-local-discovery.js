/**
 * Read-only discovery of FlClash's loopback HTTP/SOCKS listener on Windows.
 *
 * No subscription import, process scanning, privileged API, TUN change, or
 * external network request. A TCP listener is only a candidate, not proof
 * that FlClash owns it or that the configured upstream is healthy.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { connect } from 'node:net'
import { platform } from 'node:os'
import { join, win32 } from 'node:path'
import { parse as parseYaml } from 'yaml'

const MAX_CONFIG_BYTES = 5 * 1024 * 1024
const CONNECT_TIMEOUT_MS = 500
const CONFIG_RELATIVE_PATHS = Object.freeze([
  ['com.follow', 'clash', 'config.yaml'],
  ['com.follow', 'flclash', 'config.yaml'],
])

function portOf(value) {
  if (!(typeof value === 'number' || typeof value === 'string')) return null
  if (typeof value === 'string' && !/^\\d{1,5}$/.test(value.trim())) return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
}

export function flClashProxyCandidatesFromConfig(content) {
  const doc = parseYaml(String(content), { maxAliasCount: 8 })
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return []
  const authentication = doc.authentication
  const requiresAuth = Array.isArray(authentication)
    ? authentication.length > 0
    : typeof authentication === 'string' && authentication.trim().length > 0
  return [
    ['mixed-port', 'socks5'],
    ['socks-port', 'socks5'],
    ['port', 'http'],
  ].flatMap(([field, protocol]) => {
    const port = portOf(doc[field])
    return port ? [{ protocol, host: '127.0.0.1', port, requiresAuth }] : []
  })
}

export function flClashProxyFromConfig(content) {
  return flClashProxyCandidatesFromConfig(content)[0] || null
}

function checkLoopback(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(CONNECT_TIMEOUT_MS)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export async function discoverFlClashProxy(options = {}) {
  const currentPlatform = options.platform || platform()
  if (currentPlatform !== 'win32') {
    return {
      ok: true, found: false, status: 'windows_only',
      note: '本机自动发现只支持 Windows 进程；WSL、Linux 和 Android 不会猜测 Windows 代理端口。',
      tunRequired: false,
    }
  }
  const appData = options.appData === undefined ? process.env.APPDATA : options.appData
  const filePaths = Array.isArray(options.filePaths) ? options.filePaths
    : appData ? CONFIG_RELATIVE_PATHS.map((parts) => win32.join(String(appData), ...parts)) : []
  let configFound = false
  let portFound = false
  let requiresAuth = false
  const probe = typeof options.probe === 'function' ? options.probe : checkLoopback
  for (const file of filePaths.slice(0, 2)) {
    try {
      if (!existsSync(file)) continue
      const stat = statSync(file)
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_CONFIG_BYTES) continue
      configFound = true
      const endpoints = flClashProxyCandidatesFromConfig(readFileSync(file, 'utf8'))
      if (endpoints.length === 0) continue
      portFound = true
      for (const endpoint of endpoints) {
        requiresAuth = requiresAuth || endpoint.requiresAuth
        if (!await probe(endpoint.port)) continue
        return {
          ok: true, found: true, status: endpoint.requiresAuth ? 'authentication_required' : 'loopback_listening',
          endpoint: { type: endpoint.protocol, server: endpoint.host, port: endpoint.port },
          requiresAuth: endpoint.requiresAuth,
          loopbackListening: true,
          identityVerified: false,
          upstreamVerified: false,
          tunRequired: false,
        }
      }
    } catch { /* A stale/invalid local config must not become a guessed endpoint. */ }
  }
  return {
    ok: true, found: false,
    status: !configFound ? 'config_not_found' : !portFound ? 'no_proxy_port' : 'listener_unavailable',
    requiresAuth, loopbackListening: false,
    identityVerified: false, upstreamVerified: false,
    tunRequired: false,
  }
}
