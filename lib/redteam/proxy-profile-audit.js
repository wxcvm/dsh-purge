import { parse } from 'yaml'
import { isIP } from 'node:net'

const text = value => typeof value === 'string' ? value.trim() : ''
const loopback = host => host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host) && isIP(host) === 4
const placeholder = value => /^(?:CHANGE[_-]?ME|REPLACE[_-]?ME|YOUR[_-][\w-]+|\$\{[^}]+\}|<[^>]+>)$/i.test(value)
const credential = value => {
  const s = text(value)
  const i = s.indexOf(':')
  return i > 0 && !!s.slice(i+1).trim() && !placeholder(s.slice(i+1).trim())
}
function hostOf(value) {
  const raw = text(value)
  if (!raw) return null
  if (raw.startsWith('[')) return raw.match(/^\[([^\]]+)\]:\d+$/)?.[1] || null
  const i = raw.lastIndexOf(':')
  return i < 0 ? null : raw.slice(0,i)
}

function resolverKind(value) {
  if (typeof value !== 'string' || !value.trim()) return 'unknown'
  const endpoint = value.trim().split('#')[0]
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(endpoint)?.[1].toLowerCase()
  if (['https','tls','quic','h3'].includes(scheme)) return 'encrypted'
  if (['udp','tcp','http'].includes(scheme)) return 'plaintext'
  if (scheme || /^(?:system|dhcp|rcode)(?::|$)/i.test(endpoint)) return 'unknown'
  if (isIP(endpoint) || /^\[[0-9a-f:]+\](?::\d+)?$/i.test(endpoint) ||
      /^[a-z0-9][a-z0-9.-]*(?::\d+)?$/i.test(endpoint)) return 'plaintext'
  return 'unknown'
}
function reviewDns(cfg, add) {
  const dns = cfg.dns
  const empty = { plaintext:0, encrypted:0, unknown:0 }
  if (!dns || typeof dns !== 'object' || Array.isArray(dns)) return { state:'unspecified', mode:'unspecified', respectRules:'unspecified', groups:[], actualResolution:'not_tested' }
  const state = dns.enable === true ? 'enabled' : dns.enable === false ? 'disabled' : 'unspecified'
  const mode = ['fake-ip','redir-host'].includes(dns['enhanced-mode']) ? dns['enhanced-mode'] : 'unspecified'
  const respectRules = dns['respect-rules'] === true ? 'enabled' : dns['respect-rules'] === false ? 'disabled' : 'unspecified'
  const groups = []
  for (const name of ['nameserver','fallback','default-nameserver','proxy-server-nameserver','direct-nameserver','nameserver-policy','proxy-server-nameserver-policy']) {
    if (!Object.hasOwn(dns,name)) continue
    const value = dns[name]
    const policy = name.endsWith('-policy')
    const entries = policy && value && typeof value === 'object' && !Array.isArray(value)
      ? Object.values(value).flat() : Array.isArray(value) ? value : [value]
    const counts = {...empty}
    for (const entry of entries) counts[resolverKind(entry)]++
    groups.push({name,...counts})
  }
  if (state !== 'disabled') {
    if (groups.some(g=>g.plaintext>0)) add('dns-plaintext','warning','配置含明文 DNS 解析器；请核对实际使用场景与可信网络。加密 DNS 也不能单独证明解析结果正确。')
    if (groups.some(g=>g.unknown>0)) add('dns-transport-unknown','warning','部分 DNS 传输方式无法仅凭配置识别。系统解析器、特殊语法或未知格式需要独立核查。')
    if (respectRules === 'enabled' && !groups.some(g=>g.name==='proxy-server-nameserver' && g.plaintext+g.encrypted+g.unknown>0)) {
      add('dns-rule-dependency','warning','DNS 规则配置缺少明确的节点域名解析器；需核对当前内核的配置要求，不能判断实际解析是否可用。')
    }
  }
  return { state, mode, respectRules, groups, actualResolution:'not_tested' }
}

/** Static profile review, not a listener/firewall or remote reachability test. */
export function auditProxyProfile(input) {
  let cfg
  try { cfg = parse(String(input || ''), { maxAliasCount: 20 }) }
  catch { throw new Error('无法解析代理 YAML 配置，请检查格式（不返回配置原文）') }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('需要 YAML 配置对象')
  const findings = []
  const add = (id, level, message) => findings.push({ id, level, message })
  const lan = cfg['allow-lan'] === true
  const bind = text(cfg['bind-address'])
  const auth = Array.isArray(cfg.authentication) && cfg.authentication.length > 0 && cfg.authentication.every(credential)
  const skip = Array.isArray(cfg['skip-auth-prefixes']) && cfg['skip-auth-prefixes'].length > 0
  const exposed = lan && !loopback(bind)
  if (exposed && !auth) add('lan-no-auth','high','允许 LAN 访问但没有可用的代理入口鉴权；不需要 LAN 时关闭 allow-lan，需要时使用可信接口及强鉴权。')
  if (exposed && (!bind || ['*','0.0.0.0','::','[::]'].includes(bind))) add('lan-wildcard','warning','LAN 代理可能绑定所有接口；请核对实际监听范围和防火墙。')
  if (exposed && skip) add('lan-auth-exception','warning','存在跳过鉴权的地址范围；请核对是否仅包含可信客户端。')
  for (const key of ['external-controller','external-controller-tls']) {
    const value = text(cfg[key])
    if (!value) continue
    const host = hostOf(value)
    const secret = text(cfg.secret)
    if (host === null) add(key+'-unknown','warning','控制器监听格式未知，请手动确认。')
    else if (!loopback(host.toLowerCase()) && (!secret || placeholder(secret))) add(key+'-no-secret','high','控制器可能监听非回环接口且没有有效 Secret；建议使用本机回环或受保护的管理网络。')
    else if (!loopback(host.toLowerCase())) add(key+'-non-loopback','warning','控制器配置为非回环监听；请核对访问权限和防火墙。')
  }
  const dns = reviewDns(cfg, add)
  const compatibilityNotes = []
  if (dns.state !== 'disabled' && dns.mode === 'fake-ip') {
    compatibilityNotes.push({ id: 'fake-ip-dns-ownership', message: '配置使用 Fake-IP（或已声明该模式）。若同时运行独立 DNS 过滤器或 DoH 客户端，请核对两者的解析入口、Fake-IP 地址处理及 VPN 路由，避免互相接管。仅凭此配置无法确认其他软件正在运行或存在冲突；实际解析未测试。' })
  }
  return { ok: true, scope:'config-only', actualReachability:'not_tested', findings, dns, compatibilityNotes,
    note:'仅检查所选配置文本；不证明实际运行配置、端口监听、VPS 防火墙或公网可达性。无发现不代表安全。' }
}
