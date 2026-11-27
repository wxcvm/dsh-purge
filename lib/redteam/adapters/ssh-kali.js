/**
 * Opt-in SSH connection checks for a user-configured Kali VM.
 *
 * No password collection, host-key enrollment, port forwarding, sudo, shell
 * from browser input, remote installation, or target scanning.
 */
import { execFile } from 'node:child_process'
import { TOOL_CATALOG, loadPlatformConfig } from '../platform-config.js'
import { normalizeKaliVm, validateKaliVm } from '../ssh-kali-config.js'

const CONNECT_TIMEOUT_MS = 10000
const VERSION_TIMEOUT_MS = 13000
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

function configuredVm(options = {}) {
  const config = options.config || loadPlatformConfig(options.root)
  return normalizeKaliVm(config.kaliVm)
}

export function registeredKaliVm(options = {}) {
  const vm = configuredVm(options)
  if (!vm.host) return null
  return {
    id: 'ssh:kali-vm', kind: 'ssh', label: 'Kali VM (' + vm.host + ')',
    os: 'unknown', distro: null,
    state: 'configured', reachable: null, host: vm.host, port: vm.port, user: vm.user,
    // Never expose the key path outside the configuration editor.
    discovery: {
      state: 'configured',
      detail: '仅保存了 SSH 主机信息，尚未连接或检查发行版。',
    },
  }
}

function sshFailure(error, stderr) {
  if (!error) return ''
  if (error.killed || error.code === 'ETIMEDOUT') return '连接或命令超时'
  if (error.code === 'ENOENT') return '本机未找到 OpenSSH ssh 命令'
  const detail = String(stderr || '')
  if (/host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|no .*host key is known/i.test(detail)) {
    return 'SSH 主机密钥未受信任或发生变化；请先在终端核对真实主机指纹'
  }
  if (/permission denied|authentication failed/i.test(detail)) {
    return 'SSH 公钥认证失败；请检查用户名、密钥或 ssh-agent'
  }
  return 'SSH 连接或远程命令失败'
}

/** A small, predictable SSH invocation with a FIXED remote command. */
async function runSsh(vm, remoteCommand, options = {}, timeoutMs = CONNECT_TIMEOUT_MS) {
  const runner = options.execFileFn || execFile
  const args = [...SSH_OPTIONS, '-p', String(vm.port)]
  if (vm.identityFile) args.push('-i', vm.identityFile)
  // Destination cannot begin with '-' because user and hostname are validated.
  args.push(vm.user + '@' + vm.host, remoteCommand)
  return new Promise((resolve) => {
    try {
      runner(options.sshPath || 'ssh', args, {
        timeout: timeoutMs, maxBuffer: 32768, windowsHide: true,
        shell: false, encoding: 'utf8',
      }, (error, stdout, stderr) => {
        resolve({
          ok: !error,
          output: String(stdout || '').slice(0, 32768),
          error: sshFailure(error, stderr),
        })
      })
    } catch (error) {
      resolve({ ok: false, output: '', error: sshFailure(error, '') })
    }
  })
}

export function parseLinuxRelease(output) {
  const parsed = {}
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = /^(ID|PRETTY_NAME|VERSION_ID)=(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    parsed[match[1]] = value.slice(0, 200)
  }
  return {
    id: parsed.ID || null,
    name: parsed.PRETTY_NAME || null,
    version: parsed.VERSION_ID || null,
    kali: parsed.ID === 'kali',
  }
}

/** Explicitly check that the registered endpoint is a Linux host. */
export async function inspectKaliVm(options = {}) {
  const vm = configuredVm(options)
  if (!vm.host) return { ok: false, state: 'not-configured', error: '请先保存 Kali VM 的 SSH 地址' }
  const invalid = validateKaliVm(vm)
  if (invalid) return { ok: false, state: 'invalid-config', error: invalid }
  const result = await runSsh(vm, 'cat /etc/os-release', options)
  if (!result.ok) return {
    ok: false, state: 'unreachable', environmentId: 'ssh:kali-vm', error: result.error,
  }
  const distro = parseLinuxRelease(result.output)
  if (!distro.id) return {
    ok: false, state: 'unverified', environmentId: 'ssh:kali-vm',
    error: 'SSH 远程命令成功，但没有识别出 Linux 发行版',
  }
  return {
    ok: true, state: distro.kali ? 'kali-verified' : 'linux-verified',
    environmentId: 'ssh:kali-vm', distro, reachable: true,
    note: distro.kali ? 'SSH 与 Kali 系统身份已确认；尚未探测工具。'
      : 'SSH 连通并识别 Linux 系统，但不是 Kali；尚未探测工具。',
  }
}

/** Only built-in tool names + fixed version flags may be used as remote commands. */
export async function probeKaliVmTool(id, options = {}) {
  const definition = TOOL_CATALOG.find((tool) => tool.id === id)
  if (!definition) return { ok: false, toolId: id, status: 'unknown', error: '未知工具标识' }
  if (!Array.isArray(definition.probeArgs) || !definition.probeArgs.length) {
    return { ok: false, toolId: id, status: 'unsupported', error: '该工具不支持可靠的版本探测' }
  }
  const vm = configuredVm(options)
  if (!vm.host) return { ok: false, toolId: id, status: 'not-configured', error: '请先配置 Kali VM' }
  const invalid = validateKaliVm(vm)
  if (invalid) return { ok: false, toolId: id, status: 'invalid-config', error: invalid }
  const binary = definition.names.find((name) =>
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !/\.exe$|\.py$/i.test(name))
  const flags = definition.probeArgs
  if (!binary || flags.some((flag) => !/^(?:--?[A-Za-z][A-Za-z0-9_-]*|version)$/.test(flag))) {
    return { ok: false, toolId: id, status: 'unsupported', error: '没有可信的 Linux 版本探测命令' }
  }
  const result = await runSsh(vm, binary + ' ' + flags.join(' '), options, VERSION_TIMEOUT_MS)
  const version = result.ok ? (result.output.split(/\r?\n/).find(Boolean)?.trim().slice(0, 180) || '版本命令成功') : null
  return {
    ok: result.ok, toolId: id, environmentId: 'ssh:kali-vm', binary,
    status: result.ok ? 'probe_verified' : 'degraded',
    version, error: result.ok ? null : result.error,
    probe: { status: result.ok ? 'runnable' : 'failed',
      checkedAt: new Date().toISOString(), error: result.ok ? null : result.error },
    dependencyStatus: 'not-checked',
    capabilityVerified: false, executionStatus: 'not-run', lastExecution: null,
    limitations: ['仅执行固定版本命令；未执行目标测试，也不代表完整依赖已验证。'],
  }
}
