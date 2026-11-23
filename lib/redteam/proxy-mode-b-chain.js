/**
 * Opt-in Mode B proxy chain for plugin-owned HTTP(S) requests.
 * The caller supplies exactly airport, VPS1, [VPS2], in order.
 * No proxy groups, direct fallback, external providers, or host routing.
 */
import { isIP } from 'node:net'

const LABELS = Object.freeze(['airport-entry', 'vps1', 'vps2'])
const REMOTE_TYPES = new Set(['vless', 'vmess', 'ss', 'trojan'])
const FORBIDDEN = new Set([
  'dialer-proxy', 'proxy', 'proxy-group', 'proxy-groups',
  'chain', 'chaining', 'underlying-proxy', 'parent-proxy',
  'proxy-provider', 'proxy-providers', 'rule-provider', 'rule-providers',
  'script', 'url', 'interface-name', 'routing-mark',
])

function copyPlain(value, depth = 0, active = new WeakSet()) {
  if (depth > 12) throw new Error('链式节点结构过深')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!value || typeof value !== 'object') throw new Error('链式节点字段无效')
  if (active.has(value)) throw new Error('链式节点存在循环引用')
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error('链式节点必须是普通对象')
  }
  active.add(value)
  let result
  if (Array.isArray(value)) {
    result = value.map((item) => copyPlain(item, depth + 1, active))
  } else {
    result = Object.create(null)
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('链式节点字段无效')
      result[key] = copyPlain(item, depth + 1, active)
    }
  }
  active.delete(value)
  return result
}

export function normalizeModeBChain(raw) {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 3) {
    throw new Error('模式 B 需要机场 + VPS1，或机场 + VPS1 + VPS2')
  }
  const nodes = raw.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('链式节点必须是对象')
    const node = copyPlain(item)
    const name = LABELS[i]
    if (node.name !== undefined && node.name !== name) throw new Error('链式节点名称与顺序不匹配')
    for (const key of FORBIDDEN) {
      if (!Object.hasOwn(node, key)) continue
      // Persisted profiles already carry the exact generated dialer chain.
      if (key === 'dialer-proxy' && i > 0 && node[key] === LABELS[i - 1]) continue
      throw new Error('链式节点不能自定义拨号链或系统出口')
    }
    if (node['skip-cert-verify'] === true || node.skip_cert_verify === true) {
      throw new Error('模式 B 不允许跳过 TLS 证书验证')
    }
    const type = typeof node.type === 'string' ? node.type.toLowerCase() : ''
    const host = typeof node.server === 'string' ? node.server.trim() : ''
    const port = Number(node.port)
    if (!host || host.length > 255 || /[\s/@]/.test(host)
        || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('模式 B 节点服务器或端口无效')
    }
    if (i === 0 && type !== 'socks5' && type !== 'http') {
      throw new Error('模式 B 机场入口须使用 SOCKS5 或 HTTP 代理')
    }
    if (i > 0 && !REMOTE_TYPES.has(type)) {
      throw new Error('模式 B VPS 节点仅支持已明确检查的 TCP 代理协议')
    }
    if (i > 0 && !isIP(host)) {
      throw new Error('模式 B VPS 节点需使用实际 IPv4/IPv6 地址，避免未经验证的 DNS 出口')
    }
    if (i > 0 && type === 'vless' && (typeof node.uuid !== 'string' || !node.uuid.trim())) {
      throw new Error('VLESS 节点缺少 UUID')
    }
    node.name = name
    node.type = type
    node.server = host
    node.port = port
    if (i > 0) node['dialer-proxy'] = LABELS[i - 1]
    return node
  })
  if (nodes.length === 3 && nodes[1].server === nodes[2].server) {
    throw new Error('VPS1 和 VPS2 必须是独立节点')
  }
  return nodes
}

export function modeBChainPublic(nodes) {
  const normalized = normalizeModeBChain(nodes)
  return {
    hopCount: normalized.length,
    mode: 'B',
    finalExit: normalized.length === 3 ? 'vps2_configured_unverified' : 'vps1_configured_unverified',
    verification: 'not_tested',
  }
}
