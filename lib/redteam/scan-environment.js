/**
 * 扫描环境守卫（Scan Environment Guard）
 *
 * 背景（实测事故）：
 *   本机启用 FlClash TUN 后，隧道对**任意** TCP 连接都回伪造 SYN-ACK。
 *   nmap --top-ports 1000 得到 1000/1000 open、延迟 0.75ms；
 *   裸 SOCKS5 CONNECT 得到 128/128 open；连 1.1.1.1:1 和 example.com:12345
 *   这类必然关闭的端口也被判为 open。
 *
 * 结论：只要流量被 TUN 接管，端口 STATE 一律不可信。扫描器不该在这种环境下
 * 静默产出假数据——必须提前识别并拒绝，或要求操作者显式知情后放行。
 *
 * 判定依据（均为本地只读观察，不发网络请求）：
 *   1. 网卡名命中已知隧道前缀（tun/tap/utun/wg/ppp/clash/meta/sing/v2ray/xray）
 *   2. 网卡上出现 fake-ip 网段地址（198.18.0.0/15，Clash/Mihomo 默认）
 *   3. 显式代理环境变量指向本机回环（仅作提示，不单独判定为隧道）
 */

import { networkInterfaces } from 'node:os'

/** 已知隧道网卡名前缀 */
const TUNNEL_NAME_PATTERNS = [
  /^tun\d*/i, /^tap\d*/i, /^utun\d*/i, /^wg\d*/i, /^ppp\d*/i,
  /^clash/i, /^meta/i, /^sing-?box/i, /^v2ray/i, /^xray/i, /^wireguard/i,
  /tunnel/i, /^tailscale/i, /^zerotier/i, /^nebula/i,
]

/** fake-ip 网段：Clash/Mihomo 默认 198.18.0.0/15 */
function isFakeIp(addr) {
  const m = /^(\d+)\.(\d+)\./.exec(String(addr || ''))
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 198 && (b === 18 || b === 19)
}

/**
 * 检测本机是否存在会干扰端口扫描的隧道网卡
 *
 * @param {Object} options
 * @param {Function} options.interfaces  注入用，默认 os.networkInterfaces
 * @param {Object} options.env           注入用，默认 process.env
 * @returns {{ tunneled: boolean, evidence: string[], adapters: string[], proxyHint: string|null }}
 */
export function detectScanTunnel(options = {}) {
  const readInterfaces = options.interfaces || networkInterfaces
  const env = options.env || process.env

  const evidence = []
  const adapters = []

  let nets = {}
  try { nets = readInterfaces() || {} } catch { nets = {} }

  for (const [name, entries] of Object.entries(nets)) {
    const list = Array.isArray(entries) ? entries : []
    if (list.length === 0) continue

    const nameHit = TUNNEL_NAME_PATTERNS.some((re) => re.test(name))
    const fakeIpHit = list.some((e) => isFakeIp(e && e.address))

    if (nameHit) {
      adapters.push(name)
      evidence.push('网卡名符合隧道特征: ' + name)
    }
    if (fakeIpHit) {
      if (!adapters.includes(name)) adapters.push(name)
      evidence.push('网卡持有 fake-ip 地址(198.18.0.0/15): ' + name)
    }
  }

  // 本机代理仅作提示：它本身不必然导致端口伪造，但与 TUN 同时出现时是强信号
  let proxyHint = null
  const proxyVars = ['ALL_PROXY', 'all_proxy', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']
  for (const key of proxyVars) {
    const value = String(env[key] || '').trim()
    if (!value) continue
    if (/^socks5?h?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])/i.test(value) || /^https?:\/\/(?:127\.0\.0\.1|localhost)/i.test(value)) {
      proxyHint = key + '=' + value
      break
    }
  }

  return {
    tunneled: adapters.length > 0,
    evidence,
    adapters: [...new Set(adapters)],
    proxyHint,
  }
}

/**
 * 扫描前守卫：隧道存在且未显式放行时拒绝执行
 *
 * @param {Object} options
 * @param {boolean} options.allowTunnelScan  操作者显式知情放行
 * @returns {{ ok: boolean, status?: string, error?: string, detection: Object }}
 */
export function guardScanEnvironment(options = {}) {
  const detection = detectScanTunnel(options)
  if (!detection.tunneled) return { ok: true, detection }

  if (options.allowTunnelScan === true) {
    return {
      ok: true,
      detection,
      warning: '已获操作者显式放行：隧道仍在接管流量，扫描结果的端口状态可能全部为伪造 open，不得作为结论使用。',
    }
  }

  return {
    ok: false,
    status: 'tunnel-detected',
    error: '检测到隧道网卡（' + detection.adapters.join(', ') + '）：隧道会对任意 TCP 连接伪造成功，'
      + '端口扫描结果不可信（实测出现过 1000/1000 open、0.75ms 延迟）。'
      + '请先关闭 TUN 或改用应用层(L7)探针；确需在此环境扫描时显式传 allow_tunnel_scan=true，'
      + '且结果不得当作真实端口状态。',
    detection,
  }
}