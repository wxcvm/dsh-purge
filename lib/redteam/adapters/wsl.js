/**
 * WSL discovery and opt-in, version-only probes.
 *
 * Listing WSL distributions does not launch them. An explicit version probe
 * MAY start a stopped distribution, and never runs on a refresh/list request.
 * No shell is involved: every command/flag comes from the built-in catalog.
 */
import { execFile } from 'node:child_process'
import { platform as osPlatform } from 'node:os'
import { TOOL_CATALOG } from '../platform-config.js'

const DEFAULT_TIMEOUT_MS = 6500
const PROBE_TIMEOUT_MS = 15000
const RUNNER_OPTIONS = (timeout) => ({
  shell: false,
  windowsHide: true,
  timeout,
  maxBuffer: 128 * 1024,
  encoding: 'buffer',
})

/** wsl.exe commonly emits UTF-16LE, including on English-language Windows. */
export function decodeWslOutput(output) {
  if (output == null) return ''
  if (typeof output === 'string') return output.replace(/^\uFEFF/, '').replace(/\u0000/g, '')
  const bytes = Buffer.isBuffer(output) ? output : Buffer.from(output)
  const utf16 = bytes.includes(0) || (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
  return bytes.toString(utf16 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '').replace(/\u0000/g, '')
}

export function parseWslVerbose(output) {
  const lines = decodeWslOutput(output).replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)
  const distributions = []
  const seen = new Set()
  for (const line of lines) {
    const row = line.trim()
    // Anchoring on the numeric VERSION column works with non-English headers.
    const match = /^(\*)?\s*(.+?)\s+(\S+)\s+([12])$/.exec(row)
    if (!match) continue
    const distro = match[2].trim()
    if (!distro || distro.length > 160 || /[\u0000-\u001f]/.test(distro) || seen.has(distro)) continue
    seen.add(distro)
    const rawState = match[3]
    const state = /^running$/i.test(rawState) ? 'running'
      : /^stopped$/i.test(rawState) ? 'stopped' : 'unknown'
    distributions.push({
      id: 'wsl:' + distro,
      kind: 'wsl',
      label: distro + ' (WSL ' + match[4] + ')',
      os: 'linux',
      distro,
      wslVersion: Number(match[4]),
      state,
      rawState,
      isDefault: !!match[1],
      reachable: null,
      discovery: { state: 'listed', detail: '只读 WSL 发行版列表；未启动发行版，也未验证工具。' },
    })
  }
  return distributions
}

async function runWsl(args, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const runner = options.execFileFn || execFile
  const command = options.wslPath || 'wsl.exe'
  return new Promise((resolve) => {
    try {
      runner(command, args, RUNNER_OPTIONS(timeoutMs), (error, stdout, stderr) => {
        resolve({
          ok: !error,
          timeout: !!(error && (error.killed || error.code === 'ETIMEDOUT')),
          notInstalled: !!(error && error.code === 'ENOENT'),
          stdout: decodeWslOutput(stdout),
          stderr: decodeWslOutput(stderr),
        })
      })
    } catch (error) {
      resolve({
        ok: false,
        timeout: false,
        notInstalled: error && error.code === 'ENOENT',
        stdout: '',
        stderr: String(error && error.message || error),
      })
    }
  })
}

/** Only lists installed distros; no wsl --install, --update or --distribution. */
export async function discoverWslEnvironments(options = {}) {
  if ((options.platform || osPlatform()) !== 'win32') {
    return { ok: true, state: 'unsupported', environments: [], note: '当前进程不是 Windows，跳过 WSL 发现。' }
  }
  const result = await runWsl(['--list', '--verbose'], options)
  if (!result.ok) {
    return {
      ok: false,
      state: result.notInstalled ? 'unavailable' : result.timeout ? 'timeout' : 'failed',
      environments: [],
      note: result.notInstalled ? '未找到 wsl.exe' : '无法获取 WSL 发行版列表。',
    }
  }
  const environments = parseWslVerbose(result.stdout)
  // Nonempty but unparseable output is NOT proof that no distro exists.
  const state = environments.length ? 'listed' : result.stdout.trim() ? 'unparsed' : 'none'
  return {
    ok: true,
    state,
    environments,
    note: state === 'listed' ? '只读列举已注册的 WSL 发行版，不启动发行版。'
      : state === 'none' ? '未列出 WSL 发行版。'
        : 'WSL 返回了未能解析的列表；不能断定没有发行版。',
  }
}

/**
 * Runs only the known program's fixed version flags inside an installed distro.
 * User must explicitly initiate this operation; it can boot a stopped distro.
 */
export async function probeWslTool(distro, toolId, options = {}) {
  const def = TOOL_CATALOG.find((item) => item.id === toolId)
  if (!def) return { ok: false, status: 'unknown', toolId, error: '未知工具标识' }
  if (!Array.isArray(def.probeArgs) || def.probeArgs.length === 0) {
    return { ok: false, status: 'unsupported', toolId, error: '该工具没有可靠的版本检测参数' }
  }
  const installed = await discoverWslEnvironments(options)
  const environment = installed.environments.find((item) => item.distro === distro)
  if (!environment) {
    return { ok: false, status: 'environment-missing', toolId, error: '没有找到所选 WSL 发行版' }
  }
  // Try only catalogued Linux executable aliases; never accept an arbitrary UI path.
  const binaries = def.names.filter((name) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)
    && !/\.exe$/i.test(name) && !/\.py$/i.test(name))
  if (!binaries.length || def.probeArgs.some((flag) => !/^(?:--?[A-Za-z][A-Za-z0-9_-]*|version)$/.test(flag))) {
    return { ok: false, status: 'unsupported', toolId, error: '没有可信的 Linux 版本探测命令' }
  }
  let binary = binaries[0]
  let result
  for (const candidate of binaries) {
    binary = candidate
    result = await runWsl(
      ['--distribution', environment.distro, '--exec', candidate, ...def.probeArgs],
      options,
      PROBE_TIMEOUT_MS,
    )
    if (result.ok || result.timeout) break
  }
  const rawVersion = [result.stdout, result.stderr].map((v) => v.trim()).find(Boolean) || ''
  const version = rawVersion.split(/\r?\n/).find(Boolean)?.slice(0, 180) || null
  return {
    ok: result.ok,
    toolId,
    environmentId: environment.id,
    binary,
    path: null,
    source: 'wsl',
    status: result.ok ? 'probe_verified' : result.timeout ? 'timeout' : 'degraded',
    version,
    probe: { status: result.ok ? 'runnable' : result.timeout ? 'timeout' : 'failed',
      checkedAt: new Date().toISOString(), error: result.ok ? null : 'WSL 工具版本命令执行失败' },
    dependencyStatus: 'not-checked',
    capabilityVerified: false,
    executionStatus: 'not-run',
    lastExecution: null,
    limitations: ['只执行版本命令；未验证完整依赖，也未对任何目标执行任务。'],
  }
}
