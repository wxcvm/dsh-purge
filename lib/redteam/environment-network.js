import { Resolver } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'

const HOST = 'api.github.com'
const URL = 'https://' + HOST + '/'
// Native HTTPS avoids loading the optional plugin proxy transport in host profiles.
function requestDirect(url, options) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, options, response => {
      response.resume()
      resolve({ statusCode: response.statusCode })
    })
    const deadline = setTimeout(() => {
      const error = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
      req.destroy(error)
    }, options.timeout)
    req.once('response', () => clearTimeout(deadline))
    req.once('error', error => { clearTimeout(deadline); reject(error) })
    req.end()
  })
}

const codeOf = error => /^[A-Z0-9_]{1,40}$/.test(String(error?.code || '')) ? String(error.code) : 'PROBE_FAILED'

/** Explicit fixed-site diagnostic. No credentials, IP addresses or response bodies returned. */
export async function probeEnvironmentNetwork(kind, {
  resolver = new Resolver({ timeout: 3000, tries: 1 }),
  request = requestDirect,
  now = Date.now,
} = {}) {
  const started = now()
  const elapsed = () => Math.max(0, now() - started)
  if (kind === 'dns') {
    const resolve = async (method) => {
      try {
        const answers = await resolver[method](HOST)
        return { count: answers.length, status: answers.length ? 'resolved' : 'no_data' }
      } catch (error) {
        return { count: 0, status: 'failed', code: codeOf(error) }
      }
    }
    const [A, AAAA] = await Promise.all([resolve('resolve4'), resolve('resolve6')])
    const ok = A.count + AAAA.count > 0
    return { ok, kind, host: HOST, latencyMs: elapsed(), records: { A, AAAA },
      ...(!ok ? { error: 'DNS 解析失败：' + (A.code || A.status) + ' / ' + (AAAA.code || AAAA.status) } : {}) }
  }
  if (kind === 'direct') {
    try {
      const response = await request(URL, { method: 'HEAD', timeout: 8000, agent: false,
        headers: { 'user-agent': 'dsh-purge-environment-check' } })
      const statusCode = Number(response.statusCode) || 0
      const ok = statusCode >= 200 && statusCode < 600
      return { ok, kind, host: HOST, latencyMs: elapsed(), statusCode,
        ...(!ok ? { error: '未收到有效 HTTPS 响应' } : {}) }
    } catch (error) {
      return { ok: false, kind, host: HOST, latencyMs: elapsed(), error: 'HTTPS 连接失败：' + codeOf(error) }
    }
  }
  return { ok: false, error: '未知网络检测类型' }
}
