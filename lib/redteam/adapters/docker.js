/**
 * Docker CLI environment inventory and explicit version-only checks.
 *
 * Discovery only lists already-running containers in the user's current
 * Docker context; no start/pull/create. Version probes require a container
 * ID just returned by a fresh listing and built-in tool names/flags.
 */
import { execFile } from 'node:child_process'
import { TOOL_CATALOG } from '../platform-config.js'

const LIST_TIMEOUT = 7000
const PROBE_TIMEOUT = 14000
const MAX_ROWS = 50
const RUNNER = (timeout) => ({
  timeout, windowsHide: true, shell: false, encoding: 'utf8', maxBuffer: 128 * 1024,
})

function invokeDocker(args, options = {}, timeout = LIST_TIMEOUT) {
  const runner = options.execFileFn || execFile
  return new Promise((resolve) => {
    try {
      runner(options.dockerPath || 'docker', args, RUNNER(timeout), (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout || '').slice(0, 128 * 1024),
          stderr: String(stderr || '').slice(0, 128 * 1024),
          errorCode: error?.code || null,
          error: error ? String(stderr || error.message || 'Docker 命令失败').slice(0, 400) : null,
        })
      })
    } catch (error) {
      resolve({ ok: false, stdout: '', stderr: '', errorCode: error?.code || null, error: String(error.message || error) })
    }
  })
}

export function parseDockerPs(output) {
  const environments = []
  const seen = new Set()
  let rejected = 0
  for (const raw of String(output || '').split(/\r?\n/)) {
    if (!raw.trim()) continue
    let row
    try { row = JSON.parse(raw) } catch { rejected++; continue }
    if (!row || typeof row !== 'object' || Array.isArray(row)) { rejected++; continue }
    const id = String(row.ID || row.Id || '').trim().toLowerCase()
    const state = String(row.State || '').toLowerCase()
    // Accept only IDs from the actual daemon listing. Never accept user paths,
    // container names or arbitrary strings as the docker exec target.
    if (!/^[0-9a-f]{12,64}$/.test(id) || (state && state !== 'running')
      || /\(paused\)/i.test(String(row.Status || ''))) {
      rejected++
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    const name = String(row.Names || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160)
    const image = String(row.Image || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 180)
    environments.push({
      id: 'docker:' + id, kind: 'docker', containerId: id,
      label: 'Docker · ' + (name || id.slice(0, 12)),
      image: image || null, os: 'unknown', state: 'running',
      reachable: null,
      discovery: {
        state: 'listed',
        detail: 'Docker 当前 context 报告正在运行；尚未执行工具版本探针。',
      },
    })
    if (environments.length >= MAX_ROWS) break
  }
  return { environments, rejected }
}

export async function discoverDockerEnvironments(options = {}) {
  const run = await invokeDocker(
    ['ps', '--no-trunc', '--filter', 'status=running', '--format', '{{json .}}'], options)
  if (!run.ok) {
    const missing = run.errorCode === 'ENOENT'
    return {
      ok: false, state: 'unavailable', environments: [],
      note: missing ? '未找到 Docker CLI；其他环境功能不受影响。'
        : 'Docker 当前 context 无法列出容器：' + run.error,
    }
  }
  const parsed = parseDockerPs(run.stdout)
  if (parsed.rejected) {
    return {
      ok: parsed.environments.length > 0,
      state: parsed.environments.length ? 'partial' : 'unparsed',
      environments: parsed.environments,
      note: 'Docker 容器列表中有无法识别的条目；有效容器仍可单独验证，结果可能不完整。',
    }
  }
  return {
    ok: true, state: parsed.environments.length ? 'listed' : 'empty',
    environments: parsed.environments,
    note: parsed.environments.length
      ? '发现 ' + parsed.environments.length + ' 个当前 Docker context 已运行容器；尚未检测工具。'
      : 'Docker 当前 context 没有运行中的容器。',
  }
}

export async function probeDockerTool(containerId, id, options = {}) {
  const definition = TOOL_CATALOG.find((entry) => entry.id === id)
  if (!definition) return { ok: false, toolId: id, status: 'unknown', error: '未知工具标识' }
  if (!Array.isArray(definition.probeArgs) || !definition.probeArgs.length) {
    return { ok: false, toolId: id, status: 'unsupported', error: '该工具没有可靠的版本探针' }
  }
  const binaries = definition.names.filter((name) =>
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !/\.exe$|\.py$/i.test(name))
  if (!binaries.length || definition.probeArgs.some((flag) => !/^(?:--?[A-Za-z][A-Za-z0-9_-]*|version)$/.test(flag))) {
    return { ok: false, toolId: id, status: 'unsupported', error: '没有可信的容器内版本命令' }
  }
  const list = await discoverDockerEnvironments(options)
  if (!list.ok) return { ok: false, toolId: id, status: list.state, error: list.note }
  const environment = list.environments.find((item) => item.containerId === containerId)
  if (!environment) {
    return {
      ok: false, toolId: id, status: 'environment-missing',
      error: '容器不在当前 Docker context 的运行中列表；请重新发现后选择。',
    }
  }
  let binary = binaries[0]
  let probe
  for (const candidate of binaries) {
    binary = candidate
    probe = await invokeDocker(
      ['exec', environment.containerId, candidate, ...definition.probeArgs], options, PROBE_TIMEOUT)
    if (probe.ok || probe.errorCode === 'ETIMEDOUT') break
  }
  const version = probe.ok
    ? ([probe.stdout, probe.stderr].map((output) => output.split(/\r?\n/).find((line) => line.trim())?.trim())
      .find(Boolean)?.slice(0, 180) || '版本命令成功')
    : null
  return {
    ok: probe.ok, toolId: id, environmentId: environment.id, containerId: environment.containerId,
    binary, status: probe.ok ? 'probe_verified' : 'degraded',
    version, error: probe.error,
    probe: {
      status: probe.ok ? 'runnable' : 'failed',
      checkedAt: new Date().toISOString(), error: probe.error,
    },
    dependencyStatus: 'not-checked', capabilityVerified: false,
    executionStatus: 'not-run', lastExecution: null,
    limitations: ['仅在已有运行容器中执行固定版本命令，未扫描目标或验证工具依赖。'],
  }
}
