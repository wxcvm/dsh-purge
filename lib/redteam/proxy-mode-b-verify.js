/**
 * Operator-triggered exit-IP check for an already configured Purge Mode B
 * chain. Never initiates an unproxied network request or changes pool settings.
 */
import { isIP } from 'node:net'
import { redteamRoot } from './platform-config.js'
import { proxyPoolSnapshot, requestWithProxyPool } from './proxy-pool.js'

const CHECK_URL = 'https://api4.ipify.org/'

export function isPublicIPv4(value) {
  if (typeof value !== 'string' || isIP(value) !== 4) return false
  const [a, b, c] = value.split('.').map(Number)
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99)) return false
  if (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

export async function verifyModeBExit(expectedExitIp, options = {}) {
  if (!isPublicIPv4(expectedExitIp)) throw new Error('预期出口必须是真实公网 IPv4 地址')
  const root = options.root || redteamRoot()
  const snapshot = options.snapshot || proxyPoolSnapshot(root)
  const active = Array.isArray(snapshot.profiles)
    ? snapshot.profiles.find((profile) => profile.id === snapshot.activeId)
    : null
  if (!snapshot.enabled || !snapshot.strictEgress || active?.kind !== 'mihomo-chain'
      || active?.hopCount !== 3 || active?.enabled === false) {
    throw new Error('需要已启用的三跳模式 B 节点与严格出口，不能用两跳或普通代理冒充')
  }
  const request = options.request || requestWithProxyPool
  const result = await request(root, CHECK_URL, { requireProxy: true, timeout: 15000 })
  if (result?.statusCode !== 200) throw new Error('代理出口 IP 查询失败')
  const observed = typeof result.body === 'string' ? result.body.trim() : ''
  if (!isPublicIPv4(observed)) throw new Error('代理出口未返回有效公网 IPv4')
  if (observed !== expectedExitIp) throw new Error('实际出口与预期 VPS2 IP 不一致')
  return {
    ok: true,
    verification: 'exit_ip_matched',
    scope: 'purge_plugin_http_only',
    upstreamHops: 'not_tested',
    observedAt: new Date().toISOString(),
  }
}
