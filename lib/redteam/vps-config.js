/**
 * Optional VPS address profile.
 *
 * SSH login identity, DNS/IP host and key path have different consumers:
 * - SSH uses user@host and the private-key *file path*.
 * - HTTP/FRP/Chisel host fields must NEVER contain an SSH username.
 * - A hostname with A + AAAA records is the portable dual-stack option.
 * Two literal addresses alone do not imply automatic failover.
 */
import { isIP } from 'node:net'

export const VPS_ADDRESS_MODES = Object.freeze(['auto', 'domain', 'ipv4', 'ipv6'])

export function splitLegacyVpsHost(input) {
  const raw = String(input || '').trim()
  const at = raw.lastIndexOf('@')
  const user = at >= 0 ? raw.slice(0, at) : ''
  let host = at >= 0 ? raw.slice(at + 1) : raw
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  return { user, host }
}

export function normalizeVpsConfig(input, env = {}) {
  const explicit = input && typeof input === 'object' && !Array.isArray(input)
  const legacy = splitLegacyVpsHost(env.REDTEAM_VPS_HOST)
  const host = legacy.host
  const source = explicit ? input : {}
  const val = (field, fallback = '') => typeof source[field] === 'string'
    ? source[field].trim() : fallback
  return {
    user: val('user', String(env.REDTEAM_VPS_USER || legacy.user || 'ubuntu').trim()),
    domain: val('domain', !explicit && host && !isIP(host) ? host : ''),
    ipv4: val('ipv4', !explicit && isIP(host) === 4 ? host : ''),
    ipv6: val('ipv6', !explicit && isIP(host) === 6 ? host : ''),
    addressMode: VPS_ADDRESS_MODES.includes(source.addressMode) ? source.addressMode : 'auto',
    identityFile: val('identityFile', String(env.REDTEAM_VPS_KEY || '').trim()),
  }
}

export function validateVpsConfig(input) {
  const vps = normalizeVpsConfig(input)
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(vps.user)) return 'VPS SSH 用户名无效'
  if (vps.ipv4 && isIP(vps.ipv4) !== 4) return 'VPS IPv4 地址无效'
  if (vps.ipv6 && isIP(vps.ipv6) !== 6) return 'VPS IPv6 地址无效（不要填写方括号或端口）'
  if (vps.domain && (vps.domain.length > 253
    || !vps.domain.split('.').every((label) =>
      label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)))) {
    return 'VPS 域名无效（填写主机名，不含协议、端口或用户名）'
  }
  if (/[\u0000-\u001f]/.test(vps.identityFile)) return 'VPS 私钥文件路径无效'
  if (vps.addressMode === 'domain' && !vps.domain) return '已选择域名优先，请填写 VPS 域名'
  if (vps.addressMode === 'ipv4' && !vps.ipv4) return '已选择 IPv4 优先，请填写 IPv4 地址'
  if (vps.addressMode === 'ipv6' && !vps.ipv6) return '已选择 IPv6 优先，请填写 IPv6 地址'
  return null
}

export function selectedVpsAddress(input) {
  const vps = normalizeVpsConfig(input)
  const selected = {
    domain: vps.domain,
    ipv4: vps.ipv4,
    ipv6: vps.ipv6,
  }
  // Auto prefers the DNS name (OS resolves A/AAAA), then IPv4, then IPv6.
  const order = vps.addressMode === 'auto'
    ? ['domain', 'ipv4', 'ipv6']
    : [vps.addressMode]
  for (const key of order) if (selected[key]) return { address: selected[key], kind: key }
  return { address: '', kind: null }
}

/**
 * A local preflight is not an SSH probe. Keep host/key completeness separate
 * from real connectivity, and never include a private-key path or secret.
 */
export function vpsPreflightState(hostInput, keyPresent) {
  const rawHost = String(hostInput || '').trim()
  const parsedHost = splitLegacyVpsHost(rawHost).host
  const hostConfigured = Boolean(parsedHost)
    && validateVpsConfig(normalizeVpsConfig(null, { REDTEAM_VPS_HOST: rawHost })) === null
  const hasKey = Boolean(keyPresent)
  return {
    status: !hostConfigured ? 'missing_host' : !hasKey ? 'missing_key' : 'configured_unverified',
    hostConfigured,
    keyPresent: hasKey,
    sshVerified: false,
  }
}

/** Legacy environment variable bridge for existing tools and setup helpers. */
export function vpsLegacyEnvironment(input) {
  const vps = normalizeVpsConfig(input)
  return {
    REDTEAM_VPS_HOST: selectedVpsAddress(vps).address,
    REDTEAM_VPS_USER: vps.user,
    REDTEAM_VPS_KEY: vps.identityFile,
  }
}
