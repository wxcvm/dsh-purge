/**
 * Docker environment adapter: list running containers, then explicitly probe
 * built-in tools by their fixed version flags. No shell, docker run/start,
 * image pulls, daemon configuration, privileged mode or target operations.
 *
 * The Docker CLI uses the operator's currently selected Docker context.
 */
import { execFile } from 'node:child_process'
import { TOOL_CATALOG } from '../platform-config.js'

const LIST_TIMEOUT_MS = 6500
const PROBE_TIMEOUT_MS = 15000
const ID_PATTERN = /^[a-f0-9]{12,64}$/i

async function invokeDocker(args, options = {}, timeoutMs = LIST_TIMEOUT_MS) {
  const runner = options.dockerExecFileFn || options.execFileFn || execFile
  return new Promise((resolve) => {
    try {
      runner(options.dockerPath || 'docker', args, {
        shell: false,
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 256 * 1024,
        encoding: 'utf8',
      }, (error, stdout, stderr) => {
        resolve({
          ok: !error,
          notInstalled: !!(error && error.code === 'ENOENT'),
          timeout: !!(error && (error.killed || error.code === 'ETIMEDOUT')),
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        })
      })
    } catch (error) {
      resolve({
        ok: false,
        notInstalled: error && error.code === 'ENOENT',
        timeout: false,
        stdout: '',
        stderr: '',
      })
    }
  })
}

export function parseRunningContainers(output) {
  const containers = []
  const seen = new Set()
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    const id = String(row && row.ID || '').trim()
    if (!ID_PATTERN.test(id) || seen.has(id)) continue
    // Docker ps normally lists running containers. Skip nonrunning entries
    // even if a wrapper or alternative CLI returns them.
    if (String(row.State || '').toLowerCase() !== 'running') continue
    if (/\(paused\)/i.test(String(row.Status || ''))) continue
    seen.add(id)
    const name = String(row.Names || '').slice(0, 120)
    const image = String(row.Image || '').slice(0, 180)
    containers.push({
      id: 'docker:' + id,
      kind: 'docker',
      label: name || id.slice(0, 12),
      containerId: id,
      image,
      state: 'running',
      os: 'unknown',
      reachable: null,
      discovery: {
        state: 'listed',
        detail: 'Docker 当前上下文列出的运行中容器；未验证容器内的工具。',
      },
    })
    if (containers.length >= 100) break
  }
  return containers
}

/** Read-only CLI listing. Does not connect to or start a container process. */
export async function discoverDockerEnvironments(options = {}) {
  const listed = await invokeDocker(
    ['container', 'ls', '--no-trunc', '--filter', 'status=running', '--format', '{{json .}}'],
    options,
  )
  if (!listed.ok) {
    return {
      ok: false,
      state: listed.notInstalled ? 'unavailable' : listed.timeout ? 'timeout' : 'failed',
      environments: [],
      note: listed.notInstalled ? '本机未找到 Docker CLI。'
        : listed.timeout ? 'Docker 容器列表读取超时。'
          : '无法查询当前 Docker 上下文；请检查 Docker Desktop/守护进程及权限。',
    }
  }
  const environments = parseRunningContainers(listed.stdout)
  const state = environments.length ? 'listed' : listed.stdout.trim() ? 'unparsed' : 'none'
  return {
    ok: true, state, environments,
    note: state === 'listed' ? '已列出当前 Docker 上下文的运行中容器，尚未执行容器内命令。'
      : state === 'none' ? '当前 Docker 上下文没有运行中的容器。'
        : 'Docker 列表格式未能解析；不能据此认定没有容器。',
  }
}

/**
 * A single opt-in fixed version command. Validate against the *current*
 * running-container list so an arbitrary browser-supplied ID is never used.
 */
export async function probeDockerTool(containerId, toolId, options = {}) {
  const tool = TOOL_CATALOG.find((entry) => entry.id === toolId)
  if (!tool) return { ok: false, toolId, status: 'unknown', error: '未知工具标识' }
  if (!tool.probeArgs || tool.probeArgs.length === 0) {
    return { ok: false, toolId, status: 'unsupported', error: '该工具没有可靠的版本检测参数' }
  }
  if (typeof containerId !== 'string' || !ID_PATTERN.test(containerId)) {
    return { ok: false, toolId, status: 'invalid-container', error: '无效的容器 ID' }
  }
  const listed = await discoverDockerEnvironments(options)
  if (!listed.ok) return {
    ok: false, toolId, status: listed.state, error: listed.note,
  }
  const container = listed.environments.find((item) => item.containerId === containerId)
  if (!container) {
    return { ok: false, toolId, status: 'container-missing', error: '容器已停止或不在当前 Docker 上下文' }
  }
  // Linux executable names from the catalog, not an arbitrary input path.
  const binary = tool.names.find((name) =>
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !/\.exe$|\.py$/i.test(name))
  if (!binary) return { ok: false, toolId, status: 'unsupported', error: '没有已知的容器内执行名' }
  const probe = await invokeDocker(
    ['container', 'exec', container.containerId, binary, ...tool.probeArgs],
    options, PROBE_TIMEOUT_MS,
  )
  const version = [probe.stdout, probe.stderr].map((value) =>
    value.split(/\r?\n/).find((line) => line.trim())?.trim() || '').find(Boolean)?.slice(0, 180) || null
  const status = probe.ok ? 'probe_verified' : probe.timeout ? 'timeout' : 'degraded'
  return {
    ok: probe.ok, toolId, environmentId: container.id,
    binary, source: 'docker', path: null, status,
    version,
    probe: {
      status: probe.ok ? 'runnable' : probe.timeout ? 'timeout' : 'failed',
      checkedAt: new Date().toISOString(),
      error: probe.ok ? null : '容器内版本命令执行失败（可能未安装工具或容器已停止）。',
    },
    dependencyStatus: 'not-checked',
    capabilityVerified: false, executionStatus: 'not-run', lastExecution: null,
    limitations: ['仅显式执行固定版本参数；未检查完整依赖，也未执行目标任务。'],
  }
}
