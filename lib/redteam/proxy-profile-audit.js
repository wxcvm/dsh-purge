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
  return { ok: true, scope:'config-only', actualReachability:'not_tested', findings,
    note:'仅检查所选配置文本；不证明实际运行配置、端口监听、VPS 防火墙或公网可达性。无发现不代表安全。' }
}
