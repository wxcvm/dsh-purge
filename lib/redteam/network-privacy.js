import { networkInterfaces } from 'node:os'
import { getServers } from 'node:dns'
import { isIP } from 'node:net'

// Local host observation only. No socket, DNS query, subprocess or config writes.
const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY']
function familyOf(value) {
  return value === 4 || value === 'IPv4' ? 4 : value === 6 || value === 'IPv6' ? 6 : 0
}
function readOrUnknown(read, summarize) {
  try { return { status: 'observed', ...summarize(read()) } }
  catch { return { status: 'unknown' } }
}
export function collectNetworkPrivacy({
  interfaces = networkInterfaces, servers = getServers, env = process.env,
  now = () => new Date(), platform = process.platform,
} = {}) {
  const interfaceState = readOrUnknown(interfaces, (value) => {
    const counts = { ipv4: 0, ipv6: 0, internal: 0 }
    if (!value || typeof value !== 'object') throw new Error('invalid interfaces')
    for (const entries of Object.values(value)) {
      for (const entry of entries || []) {
        const family = familyOf(entry.family)
        if (!family) continue
        if (entry.internal) counts.internal++
        else counts[family === 4 ? 'ipv4' : 'ipv6']++
      }
    }
    return counts
  })
  const dns = readOrUnknown(servers, (value) => {
    if (!Array.isArray(value)) throw new Error('invalid DNS servers')
    const counts = { ipv4: 0, ipv6: 0, other: 0 }
    for (const raw of value) {
      // Node getServers() may include a non-default port. Do not return addresses.
      const host = String(raw).replace(/^\[([^\]]+)\](?::\d+)?$/, '$1')
        .replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1').split('%')[0]
      const family = isIP(host)
      counts[family === 4 ? 'ipv4' : family === 6 ? 'ipv6' : 'other']++
    }
    return counts
  })
  return {
    ok: true, observedAt: now().toISOString(), platform,
    interfaces: interfaceState, dns,
    proxyEnvironment: PROXY_KEYS.map((name) => ({
      name, configured: Boolean(env[name] || env[name.toLowerCase()]),
    })),
    egress: { ipv4: 'not_tested', ipv6: 'not_tested' },
    actualDns: 'not_tested', browserWebRtc: 'not_tested',
    scope: 'host_local_snapshot',
  }
}
