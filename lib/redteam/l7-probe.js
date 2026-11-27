/**
 * L7 应用层服务探针（L7 Service Probe）
 *
 * 为什么需要它（实测事故）：
 *   启用 TUN 类代理（如 FlClash）后，隧道对**任意** TCP 连接都回伪造 SYN-ACK：
 *     · nmap --top-ports 1000 → 1000/1000 open，延迟 0.75ms
 *     · 对照组 1.1.1.1:1 与 example.com:12345（必然关闭）同样被判 open
 *   此时 TCP 层的 "open" 没有任何鉴别力。
 *
 *   但伪造的 accept 无法完成应用层交互：
 *     · 不会主动吐 SSH / FTP / SMTP / POP3 / IMAP / MySQL / Redis banner
 *     · 不会完成 TLS 握手并返回记录层
 *     · 不会返回合法 HTTP 状态行
 *   所以「有没有真服务」只能靠 L7 交互判定，而不是靠 connect 成功与否。
 *
 * 安全属性：
 *   · 只做被动读 banner + 一次极小的探测请求（HTTP GET / 或 TLS ClientHello）
 *   · 不发送认证凭据、不尝试登录、不执行目标侧命令
 *   · 超时严格受限，串行/低并发
 */

import net from 'node:net'

/** 被动 banner 特征（按顺序匹配，前者优先） */
const BANNER_SIGNATURES = [
  { service: 'ssh', re: /^SSH-\d+\.\d+-/ },
  { service: 'mysql', re: /mysql_native_password|MariaDB|caching_sha2_password/i },
  { service: 'ftp', re: /^220[\s\S]{0,80}\bFTP\b/i },
  { service: 'smtp', re: /^220[\s\S]{0,80}\b(SMTP|ESMTP)\b/i },
  { service: 'pop3', re: /^\+OK\b/ },
  { service: 'imap', re: /^\* OK\b/i },
  { service: 'http', re: /^HTTP\/\d\.\d\s+\d{3}/ },
  { service: 'telnet', re: /login:\s*$/i },
  { service: 'smtp-greeting', re: /^220\s/ },
]

/** 允许被判定为"真服务"的 TLS 记录层首字节 */
const TLS_HANDSHAKE = 0x16

const DEFAULT_CONNECT_TIMEOUT = 8000
const DEFAULT_BANNER_WAIT = 2000
const DEFAULT_READ_TIMEOUT = 5000

function printable(buf, limit = 120) {
  return String(buf || '')
    .replace(/[^\x20-\x7e]/g, '.')
    .slice(0, limit)
}

/** 直连连接器（TUN 存在时会拿到伪造 socket，但 L7 仍可鉴别） */
export function createTcpConnector(options = {}) {
  const connectTimeout = options.connectTimeout || DEFAULT_CONNECT_TIMEOUT
  return function connect(host, port) {
    return new Promise((resolve) => {
      const sock = new net.Socket()
      let settled = false
      const done = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      sock.setTimeout(connectTimeout, () => { sock.destroy(); done(null) })
      sock.on('error', () => done(null))
      sock.connect(port, host, () => {
        sock.setTimeout(0)
        done(sock)
      })
    })
  }
}

/** SOCKS5 连接器（无认证；域名由代理解析） */
export function createSocks5Connector(proxyHost, proxyPort, options = {}) {
  const connectTimeout = options.connectTimeout || DEFAULT_CONNECT_TIMEOUT
  return function connect(host, port) {
    return new Promise((resolve) => {
      const sock = new net.Socket()
      let stage = 'greeting'
      let settled = false
      const done = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      sock.setTimeout(connectTimeout, () => { sock.destroy(); done(null) })
      sock.on('error', () => done(null))
      sock.connect(proxyPort, proxyHost, () => sock.write(Buffer.from([0x05, 0x01, 0x00])))
      sock.on('data', function onData(buf) {
        if (stage === 'greeting') {
          if (buf.length < 2 || buf[0] !== 0x05) { sock.destroy(); return done(null) }
          stage = 'reply'
          const hb = Buffer.from(host)
          sock.write(Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, hb.length]), hb,
            Buffer.from([(port >> 8) & 0xff, port & 0xff]),
          ]))
          return
        }
        if (stage === 'reply') {
          /* 应答码不可信（TUN/代理可能伪造 0x00）；拿到 socket 后靠 L7 判定。 */
          stage = 'ready'
          sock.removeListener('data', onData)
          sock.setTimeout(0)
          done(sock)
        }
      })
    })
  }
}

/** 被动读 banner */
function readBanner(sock, waitMs) {
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0)
    let done = false
    const finish = () => {
      if (done) return
      done = true
      sock.removeAllListeners('data')
      resolve(buf)
    }
    sock.on('data', (c) => {
      buf = Buffer.concat([buf, c])
      if (buf.length > 256) finish()
    })
    sock.on('error', finish)
    setTimeout(finish, waitMs)
  })
}

/** 主动探测：HTTP GET 或 TLS ClientHello，看是否有合法应用层响应 */
function activeProbe(sock, host, mode, readTimeout) {
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0)
    let done = false
    const finish = () => {
      if (done) return
      done = true
      sock.removeAllListeners('data')
      resolve(buf)
    }
    sock.on('data', (c) => {
      buf = Buffer.concat([buf, c])
      if (buf.length >= 12) finish()
    })
    sock.on('error', finish)
    try {
      if (mode === 'tls') {
        /* 最小 TLS1.2 ClientHello 记录头：够触发服务端握手响应即可 */
        sock.write(Buffer.from('16030100a5010000a10303', 'hex'))
      } else {
        sock.write('GET / HTTP/1.0\r\nHost: ' + host + '\r\nUser-Agent: l7-probe\r\n\r\n')
      }
    } catch { finish() }
    setTimeout(finish, readTimeout)
  })
}

function classifyBanner(buf) {
  const text = buf.toString('latin1')
  for (const sig of BANNER_SIGNATURES) {
    if (sig.re.test(text)) return { service: sig.service, evidence: printable(text) }
  }
  return null
}

/**
 * 探测单个端口上的真实应用层服务
 *
 * @param {Object} options
 * @param {string} options.host
 * @param {number} options.port
 * @param {Function} [options.connect]  连接器，默认直连
 * @param {number} [options.bannerWait]
 * @param {number} [options.readTimeout]
 * @returns {Promise<{port:number, verdict:string, service:string|null, evidence:string, note:string|null}>}
 */
export async function probeL7(options = {}) {
  const host = String(options.host || '')
  const port = Number(options.port)
  const connect = options.connect || createTcpConnector({ connectTimeout: options.connectTimeout })
  const bannerWait = options.bannerWait || DEFAULT_BANNER_WAIT
  const readTimeout = options.readTimeout || DEFAULT_READ_TIMEOUT

  if (!host) throw new Error('host required')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be 1-65535')

  const sock = await connect(host, port)
  if (!sock) {
    return { port, verdict: 'UNREACHABLE', service: null, evidence: '', note: '连接未建立' }
  }

  try {
    // 1) 先被动等 banner（SSH/FTP/SMTP/MySQL 等会主动打招呼）
    const banner = await readBanner(sock, bannerWait)
    if (banner.length > 0) {
      const hit = classifyBanner(banner)
      if (hit) return { port, verdict: 'REAL_SERVICE', service: hit.service, evidence: hit.evidence, note: null }
      // 有字节但认不出：仍说明对面真的在说话，只是非已知协议
      return {
        port, verdict: 'REAL_SERVICE', service: 'unknown',
        evidence: printable(banner), note: '收到数据但不匹配已知 banner 特征',
      }
    }
  } finally {
    try { sock.destroy() } catch { /* ignore */ }
  }

  // 2) 无 banner：主动发 HTTP
  const httpSock = await connect(host, port)
  if (httpSock) {
    try {
      const resp = await activeProbe(httpSock, host, 'http', readTimeout)
      const text = resp.toString('latin1')
      if (/^HTTP\/\d\.\d\s+\d{3}/.test(text)) {
        return { port, verdict: 'REAL_SERVICE', service: 'http', evidence: printable(text), note: null }
      }
    } finally {
      try { httpSock.destroy() } catch { /* ignore */ }
    }
  }

  // 3) 再试 TLS
  const tlsSock = await connect(host, port)
  if (tlsSock) {
    try {
      const resp = await activeProbe(tlsSock, host, 'tls', readTimeout)
      if (resp.length > 0 && resp[0] === TLS_HANDSHAKE) {
        return { port, verdict: 'REAL_SERVICE', service: 'tls', evidence: 'TLS record layer 0x16', note: null }
      }
      if (resp.length > 0) {
        return {
          port, verdict: 'REAL_SERVICE', service: 'unknown-binary',
          evidence: printable(resp), note: '有应用层响应但非 HTTP/TLS',
        }
      }
    } finally {
      try { tlsSock.destroy() } catch { /* ignore */ }
    }
  }

  return {
    port, verdict: 'FAKE_OR_SILENT', service: null, evidence: '',
    note: '连接成功但无任何应用层响应——在 TUN 伪造环境下这是假 open 的典型特征',
  }
}

/**
 * 批量探测（低并发，保持顺序输出）
 *
 * @param {Object} options
 * @param {string} options.host
 * @param {number[]} options.ports
 * @param {number} [options.concurrency=4]
 * @returns {Promise<{host:string, tested:number, real_services:Array, fake_or_silent:number[], unreachable:number[]}>}
 */
export async function probeL7Batch(options = {}) {
  const host = String(options.host || '')
  const ports = Array.isArray(options.ports) ? options.ports : []
  const concurrency = Math.min(Math.max(Number(options.concurrency) || 4, 1), 16)
  if (!host) throw new Error('host required')
  if (ports.length === 0) throw new Error('ports required')

  const results = new Array(ports.length)
  let cursor = 0

  const worker = async () => {
    for (;;) {
      const index = cursor++
      if (index >= ports.length) return
      try {
        results[index] = await probeL7({ ...options, host, port: ports[index] })
      } catch (error) {
        results[index] = {
          port: ports[index], verdict: 'UNREACHABLE', service: null,
          evidence: '', note: String(error && error.message || error).slice(0, 120),
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ports.length) }, worker))

  const real = results.filter((r) => r.verdict === 'REAL_SERVICE')
  return {
    host,
    tested: ports.length,
    real_services: real,
    fake_or_silent: results.filter((r) => r.verdict === 'FAKE_OR_SILENT').map((r) => r.port),
    unreachable: results.filter((r) => r.verdict === 'UNREACHABLE').map((r) => r.port),
    results,
  }
}

/** 常用高价值端口清单（L7 探测用，不是全量扫描） */
export const L7_DEFAULT_PORTS = Object.freeze([
  21, 22, 23, 25, 80, 110, 143, 443, 445, 993, 995, 1433, 3000, 3306, 3389, 5432, 5601, 5900,
  6379, 7001, 8009, 8080, 8081, 8161, 8443, 8848, 8888, 9000, 9040, 9090, 9200, 11211, 15672, 27017,
])