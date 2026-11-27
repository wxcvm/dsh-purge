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

const SUPPORTED_TOOLS = new Set(['nmap', 'httpx'])
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
          attempted,
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
export async function executeToolInEnvironment({ toolId, environmentId = 'local', args, timeoutMs = 180000 }, options = {}) {
  if (typeof environmentId !== 'string' || !environmentId.trim()) {
    return { ok: false, status: 'invalid-environment', attempted: false, error: '必须提供有效的执行环境 ID。' }
  }
  environmentId = environmentId.trim()
  timeoutMs = Number.isInteger(timeoutMs) ? Math.max(1000, Math.min(timeoutMs, 300000)) : 180000
  if (!SUPPORTED_TOOLS.has(toolId)) {
    return { ok: false, status: 'unsupported-tool', attempted: false, error: '该执行适配器仅支持 Nmap 与 ProjectDiscovery httpx。' }
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
