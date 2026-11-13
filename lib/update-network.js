/** Updater-only transport discovery. No credential/config writes or global proxy mutation. */
import { execFileSync } from 'node:child_process'

const hidden = { encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 128 * 1024 }

export function gitHubCredential(run = execFileSync, env = process.env) {
  try {
    const result = run('git', ['-c', 'credential.interactive=never', 'credential', 'fill'], {
      ...hidden, input: 'protocol=https\nhost=github.com\npath=wxcvm/dsh-purge.git\n\n',
      env: { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }, stdio: ['pipe', 'pipe', 'ignore'],
    })
    const fields = Object.fromEntries(String(result).split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
    return fields.protocol === 'https' && fields.host === 'github.com' ? fields.password || '' : ''
  } catch { return '' }
}

export function parseUpdateProxy(value) {
  const raw = String(value || '').trim()
  if (!raw || raw === 'direct') return ''
  const selected = raw.includes('=') ? raw.split(';').find(p => p.trim().startsWith('https='))?.trim().slice(6) : raw
  if (!selected) return ''
  const url = new URL(selected.includes('://') ? selected : 'http://' + selected)
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol) || !url.hostname || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid update proxy configuration')
  return url.href
}

export function updateProxy({ env = process.env, platform = process.platform, run = execFileSync } = {}) {
  for (const key of ['DSH_PURGE_UPDATE_PROXY', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    if (env[key]) return parseUpdateProxy(env[key])
  }
  if (platform !== 'win32') return ''
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
    const enabled = String(run('reg.exe', ['query', key, '/v', 'ProxyEnable'], { ...hidden, stdio: ['ignore', 'pipe', 'ignore'] }))
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(enabled)) return ''
    const server = String(run('reg.exe', ['query', key, '/v', 'ProxyServer'], { ...hidden, stdio: ['ignore', 'pipe', 'ignore'] })).match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]
    return parseUpdateProxy(server)
  } catch { return '' }
}

let credentials = null
export function updateCredential() {
  const configured = String(process.env.DSH_PURGE_GITHUB_TOKEN || '').trim()
  if (configured) return { token: configured, source: 'environment' }
  if (!credentials || Date.now() - credentials.at > 30000) credentials = { token: gitHubCredential(), at: Date.now() }
  return { token: credentials.token, source: credentials.token ? 'git-helper' : 'none' }
}
