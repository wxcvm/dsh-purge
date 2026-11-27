/**
 * Explicit execution adapters for the existing single-target discovery tools.
 *
 * Only Nmap and ProjectDiscovery httpx are executable here. Every remote
 * environment is re-discovered and the selected binary is version-probed
 * before the target command. No generic shell or user-supplied executable.
 */
import { execFile } from 'node:child_process'
import { loadPlatformConfig, resolveTool } from './platform-config.js'
import { probeWslTool } from './adapters/wsl.js'
import { probeDockerTool } from './adapters/docker.js'
import { inspectKaliVm, probeKaliVmTool } from './adapters/ssh-kali.js'
import { normalizeKaliVm } from './ssh-kali-config.js'
import { domainToASCII } from 'node:url'
import { isIP } from 'node:net'
import { isAbsolute, resolve } from 'node:path'

const SCAN_TOOLS = new Set(['nmap', 'httpx'])
const PASSIVE_TOOLS = new Set(['subfinder', 'dnsx', 'amass'])
const SSH_OPTIONS = [
  '-n', '-T',
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=yes',
  '-o', 'ConnectTimeout=5',
  '-o', 'ClearAllForwardings=yes',
  '-o', 'ForwardAgent=no',
  '-o', 'ForwardX11=no',
  '-o', 'NumberOfPasswordPrompts=0',
  '-o', 'PreferredAuthentications=publickey',
]
const RUN_OPTIONS = (timeout) => ({
  shell: false, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8',
})

function hasControl(value) { return Array.from(String(value)).some(char => char.charCodeAt(0) < 32) }
function quotePosix(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

function invoke(command, args, options = {}) {
  const runner = options.execFileFn || execFile
  let attempted = false
  return new Promise((resolve) => {
    try {
      attempted = true
      runner(command, args, RUN_OPTIONS(options.timeoutMs || 180000), (error, stdout, stderr) => {
        resolve({
          ok: !error,
          // execFile can callback with ENOENT/EACCES even though no target process ever spawned.
          attempted: attempted && !(error && ['ENOENT', 'EACCES', 'ENOEXEC', 'ENOTDIR', 'EINVAL'].includes(error.code)),
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: error ? String(error.message || error).slice(0, 500) : null,
          errorCode: error?.code || null,
          timedOut: !!(error && (error.killed || error.code === 'ETIMEDOUT')),
        })
      })
    } catch (error) {
      attempted = false
      resolve({
        ok: false, attempted: false, stdout: '', stderr: '',
        error: String(error?.message || error).slice(0, 500),
        errorCode: error?.code || null, timedOut: false,
      })
    }
  })
}

/**
 * Execute a fixed scan command in an explicitly selected environment.
 * environmentId defaults to local for backwards compatibility; remote
 * execution is never selected automatically from a recommendation.
 */
async function executeWithAllowlist({ toolId, environmentId = 'local', args, timeoutMs = 180000 }, options = {}, allowedTools = SCAN_TOOLS) {
  if (typeof environmentId !== 'string' || !environmentId.trim()) {
    return { ok: false, status: 'invalid-environment', attempted: false, error: '必须提供有效的执行环境 ID。' }
  }
  environmentId = environmentId.trim()
  timeoutMs = Number.isInteger(timeoutMs) ? Math.max(1000, Math.min(timeoutMs, 300000)) : 180000
  if (!allowedTools.has(toolId)) {
    return { ok: false, status: 'unsupported-tool', attempted: false, error: '该执行适配器不支持此工具标识。' }
  }
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string' || hasControl(value))) {
    return { ok: false, status: 'invalid-arguments', attempted: false, error: '执行参数无效。' }
  }
  const config = options.config || loadPlatformConfig(options.root)
  let command
  let invocationArgs
  let executable
  let source
  let transport = environmentId

  if (environmentId === 'local') {
    const binary = resolveTool(toolId, { ...options, config })
    if (!binary.path) return { ok: false, status: 'tool-missing', attempted: false, environmentId, error: toolId + ' executable not found' }
    command = binary.path
    invocationArgs = args
    executable = binary.path
    source = binary.source
    transport = 'local'
  } else if (environmentId.startsWith('wsl:')) {
    const distro = environmentId.slice(4)
    if (!distro || distro.length > 160 || hasControl(distro)) {
      return { ok: false, status: 'invalid-environment', attempted: false, environmentId, error: 'WSL 发行版标识无效。' }
    }
    const probe = await probeWslTool(distro, toolId, { ...options, execFileFn: options.wslExecFileFn || options.execFileFn })
    if (probe.status !== 'probe_verified') {
      return { ok: false, status: probe.status === 'environment-missing' ? 'environment-missing' : 'tool-not-runnable', attempted: false, environmentId, error: probe.error || 'WSL 工具未通过版本验证。' }
    }
    command = options.wslPath || 'wsl.exe'
    invocationArgs = ['--distribution', distro, '--exec', probe.binary, ...args]
    executable = probe.binary
    source = 'wsl'
    transport = 'wsl'
  } else if (environmentId.startsWith('docker:')) {
    const containerId = environmentId.slice(7)
    if (!/^[0-9a-f]{12,64}$/i.test(containerId)) {
      return { ok: false, status: 'invalid-environment', attempted: false, environmentId, error: 'Docker 容器标识无效。' }
    }
    const probe = await probeDockerTool(containerId, toolId, {
      ...options, execFileFn: options.dockerExecFileFn || options.execFileFn,
    })
    if (probe.status !== 'probe_verified') {
      return { ok: false, status: probe.status === 'environment-missing' ? 'environment-missing' : 'tool-not-runnable', attempted: false, environmentId, error: probe.error || 'Docker 容器中的工具未通过版本验证。' }
    }
    command = options.dockerPath || 'docker'
    invocationArgs = ['exec', probe.containerId, probe.binary, ...args]
    executable = probe.binary
    source = 'docker'
    transport = 'docker'
  } else if (environmentId === 'ssh:kali-vm') {
    const sshOptions = { ...options, execFileFn: options.sshExecFileFn || options.execFileFn }
    const identity = await inspectKaliVm(sshOptions)
    if (identity.state !== 'kali-verified') {
      return { ok: false, status: 'environment-unverified', attempted: false, environmentId, error: identity.error || 'SSH 环境未确认为 Kali。' }
    }
    const probe = await probeKaliVmTool(toolId, sshOptions)
    if (probe.status !== 'probe_verified') {
      return { ok: false, status: 'tool-not-runnable', attempted: false, environmentId, error: probe.error || 'SSH 环境中的工具未通过版本验证。' }
    }
    const vm = normalizeKaliVm(config.kaliVm)
    const sshArgs = [...SSH_OPTIONS, '-p', String(vm.port || 22)]
    if (vm.identityFile) sshArgs.push('-i', vm.identityFile)
    sshArgs.push(String(vm.user) + '@' + String(vm.host))
    // SSH transports a single remote command string. Quote each fixed argv
    // element for the remote POSIX shell; never accept a raw command string.
    sshArgs.push([probe.binary, ...args].map(quotePosix).join(' '))
    command = options.sshPath || 'ssh'
    invocationArgs = sshArgs
    executable = probe.binary
    source = 'ssh-kali'
    transport = 'ssh'
  } else {
    return { ok: false, status: 'unsupported-environment', attempted: false, environmentId, error: '不支持该执行环境；请选择 local、已发现的 WSL、Docker 或已验证的 SSH Kali。' }
  }

  const run = await invoke(command, invocationArgs, {
    execFileFn: transport === 'docker' ? (options.dockerExecFileFn || options.execFileFn)
      : transport === 'wsl' ? (options.wslExecFileFn || options.execFileFn)
        : transport === 'ssh' ? (options.sshExecFileFn || options.execFileFn) : options.execFileFn,
    timeoutMs,
  })
  return {
    ...run, status: run.error ? (run.timedOut ? 'timeout' : 'failed') : run.stdout.trim() ? 'executed' : 'empty',
    environmentId, transport, executable, source, argv: args,
  }
}


function normalizePassiveDomain(value) {
  const raw = String(value || '').trim().replace(/\.$/, '')
  if (/[\\s/\\\\:@?#%*\\u0000-\\u001f]/.test(raw)) throw new Error('必须提供单个有效的根域名')
  const domain = domainToASCII(raw).toLowerCase()
  if (!domain || domain.length > 253 || isIP(domain) || !domain.includes('.')
    || !domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error('必须提供单个有效的根域名')
  }
  return domain
}

/** Existing active-scan adapter remains restricted to Nmap and ProjectDiscovery httpx. */
export function executeToolInEnvironment(request, options = {}) {
  return executeWithAllowlist(request, options, SCAN_TOOLS)
}

/**
 * Passive subdomain discovery. The caller cannot supply argv, sources, wordlists,
 * active mode or proxy settings; only the root domain and an explicitly selected
 * execution environment are variable.
 */
export async function executeSubfinderInEnvironment({ domain, environmentId = 'local', timeoutMs = 75000 } = {}, options = {}) {
  let target
  try { target = normalizePassiveDomain(domain) }
  catch (error) {
    return { ok: false, status: 'invalid-target', attempted: false, error: error.message }
  }
  const args = ['-d', target, '-silent', '-timeout', '10', '-max-time', '1',
    '-rl', '10', '-mr', '100', '-duc']
  return executeWithAllowlist({
    toolId: 'subfinder', environmentId, args, timeoutMs,
  }, options, PASSIVE_TOOLS)
}

/**
 * Amass is deliberately local-only until output-file transfer is implemented
 * for remote environments. Its fixed mode is strictly passive.
 */
export async function executeAmassPassiveInLocal({ domain, outputFile, environmentId = 'local', timeoutMs = 75000 } = {}, options = {}) {
  if (environmentId !== 'local') {
    return { ok: false, status: 'unsupported-environment', attempted: false,
      error: 'Amass 被动输出文件目前仅支持 local 环境；不会自动切换环境。' }
  }
  let target
  try { target = normalizePassiveDomain(domain) }
  catch (error) {
    return { ok: false, status: 'invalid-target', attempted: false, error: error.message }
  }
  const file = resolve(String(outputFile || ''))
  if (!outputFile || !isAbsolute(file)) {
    return { ok: false, status: 'invalid-arguments', attempted: false, error: 'Amass 临时输出文件路径无效。' }
  }
  const args = ['enum', '-passive', '-d', target, '-timeout', '1', '-o', file]
  return executeWithAllowlist({
    toolId: 'amass', environmentId: 'local', args, timeoutMs,
  }, options, PASSIVE_TOOLS)
}

/**
 * Resolve only a supplied file of already-collected hostnames. No domain
 * enumeration, wordlist, AXFR, tracing, wildcard brute force or raw argv.
 */
export async function executeDnsxInLocal({ inputFile, environmentId = 'local', timeoutMs = 45000 } = {}, options = {}) {
  if (environmentId !== 'local') {
    return { ok: false, status: 'unsupported-environment', attempted: false,
      error: 'dnsx 批量解析目前仅支持 local；不会自动切换环境。' }
  }
  const file = resolve(String(inputFile || ''))
  if (!inputFile || !isAbsolute(file)) {
    return { ok: false, status: 'invalid-arguments', attempted: false, error: 'dnsx 输入文件路径无效。' }
  }
  const args = ['-l', file, '-silent', '-a', '-aaaa', '-cname', '-json',
    '-rl', '10', '-t', '5', '-timeout', '2', '-retry', '1', '-duc', '-auth=false']
  return executeWithAllowlist({
    toolId: 'dnsx', environmentId: 'local', args, timeoutMs,
  }, options, PASSIVE_TOOLS)
}
