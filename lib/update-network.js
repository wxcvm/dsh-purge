/** Updater-only transport discovery. No credential/config writes or global proxy mutation. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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

export function publicUpstreamRefs(source, { run = execFileSync, proxyUrl, env: sourceEnv = process.env } = {}) {
  if (!['mmparko/dsh-purge', 'deepseek-ai/deepseek-harness'].includes(source.repository)) throw new Error('unsupported public upstream')
  const selectedProxy = proxyUrl === undefined ? updateProxy({ env: sourceEnv }) : parseUpdateProxy(proxyUrl)
  // Run outside the caller's repository with empty system/global Git config.
  // Public upstream lookups must never inherit private-repo auth, askpass,
  // extra Authorization headers, local repo config or proxy environment.
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'dsh-purge-public-upstream-'))
  const emptyConfig = path.join(cwd, 'empty.gitconfig')
  writeFileSync(emptyConfig, '', { mode: 0o600 })
  const env = {
    ...sourceEnv,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: emptyConfig,
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CEILING_DIRECTORIES: cwd,
    GIT_CONFIG_COUNT: '4',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'http.proxy',
    GIT_CONFIG_VALUE_1: selectedProxy,
    GIT_CONFIG_KEY_2: 'http.extraHeader',
    GIT_CONFIG_VALUE_2: '',
    GIT_CONFIG_KEY_3: 'http.https://github.com/.extraHeader',
    GIT_CONFIG_VALUE_3: '',
  }
  for (const key of [
    'DSH_PURGE_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN',
    'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_ASKPASS_REQUIRE',
    'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR',
    'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_SSL_NO_VERIFY', 'GIT_PROXY_SSL_NO_VERIFY', 'GIT_SSL_CERT', 'GIT_SSL_KEY',
    'GIT_PROXY_SSL_CERT', 'GIT_PROXY_SSL_KEY',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy',
  ]) delete env[key]
  try {
    const result = run('git', ['-c', 'credential.interactive=never', 'ls-remote', '--refs',
      'https://github.com/' + source.repository + '.git', 'refs/heads/master',
      ...(source.releasePrefix ? ['refs/tags/' + source.releasePrefix + '*'] : [])], {
      ...hidden, timeout: 15000, env, cwd, stdio: ['ignore', 'pipe', 'ignore'],
    })
    const rows = String(result).trim().split(/\r?\n/).map(l => l.split(/\s+/))
    const head = rows.find(r => r[1] === 'refs/heads/master')?.[0]
    if (!/^[a-f\d]{40}$/i.test(head || '')) throw new Error('upstream head not observed')
    return { head, branch: 'master', tags: rows.filter(r => r[1]?.startsWith('refs/tags/')).map(r => r[1].slice(10)) }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}
