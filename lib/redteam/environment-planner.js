/**
 * Recommendation-only cross-environment planner.
 * Evidence comes from explicit server-side discovery/probe responses; the
 * planner never starts a distro, container, VM, version command or target task.
 */
import { TOOL_CATALOG, loadPlatformConfig } from './platform-config.js'
import { TASK_TOOL_PROFILES } from './task-tool-plan.js'
import { inventoryLocalCapabilities } from './capability-service.js'

const discovered = new Map()
const observed = new Map()
const keyOf = (root) => String(root || '__default__')
const probeKey = (env, tool) => env + ':' + tool
const knownTools = new Set(TOOL_CATALOG.map(item => item.id))

export function rememberEnvironmentDiscovery(root, snapshot) {
  if (!snapshot || !Array.isArray(snapshot.environments)) return
  discovered.set(keyOf(root), {
    checkedAt: snapshot.checkedAt || new Date().toISOString(),
    environments: snapshot.environments
      .filter(e => e && typeof e.id === 'string' && typeof e.kind === 'string')
      .map(({ id, kind, label, state, discovery }) =>
        ({ id, kind, label, state, discovery: discovery?.state || null })),
  })
}

export function rememberEnvironmentProbe(root, result) {
  if (!result || !knownTools.has(result.toolId) || !result.environmentId) return
  const environmentId = String(result.environmentId)
  const snapshot = discovered.get(keyOf(root))
  if (environmentId !== 'local' &&
    !snapshot?.environments.some(e => e.id === environmentId)) return
  const key = keyOf(root)
  if (!observed.has(key)) observed.set(key, new Map())
  observed.get(key).set(probeKey(environmentId, result.toolId), {
    status: String(result.status || 'unknown'),
    checkedAt: result.probe?.checkedAt || new Date().toISOString(),
    version: result.version || null,
    error: result.probe?.error || result.error || null,
  })
}

function candidateScore(candidate, preferredEnvironmentId, preferredToolId) {
  const reasons = []
  let score
  if (candidate.status === 'probe_verified') {
    score = 80
    reasons.push('用户显式版本探针已成功')
  } else if (candidate.status === 'located') {
    score = 45
    reasons.push('本机已定位程序路径，尚未验证版本')
  } else if (candidate.status === 'degraded') {
    score = -40
    reasons.push('最近的显式版本探针失败')
  } else if (candidate.status === 'missing') {
    score = -60
    reasons.push('未定位该工具的本机文件')
  } else {
    score = 0
    reasons.push('环境存在，但还没有该工具的可用性证据')
  }
  const positive = score > 0
  if (positive && candidate.environmentId === preferredEnvironmentId) {
    score += 25
    reasons.push('用户选择的环境')
  }
  if (positive && candidate.toolId === preferredToolId) {
    score += 15
    reasons.push('已保存的任务首选工具')
  }
  if (positive && candidate.environmentId === 'local') {
    score += 5
    reasons.push('当前宿主可直接访问')
  }
  if (candidate.sourceProviderId === 'artex:local') {
    reasons.push('程序来自 ARTEX 本地工具目录，不是远端 ARTEX 执行')
  }
  return { ...candidate, score, reasons }
}

export function planObservedEnvironmentTask(task, options = {}) {
  const profile = TASK_TOOL_PROFILES.find(p => p.id === task)
  if (!profile) return { ok: false, task, error: '未知任务类型' }
  const root = keyOf(options.root)
  const cfg = options.config || loadPlatformConfig(options.root)
  const environmentSnapshot = discovered.get(root)
  const environments = environmentSnapshot?.environments || [{ id: 'local', kind: 'local', label: '当前主机' }]
  const known = new Map(inventoryLocalCapabilities({ ...options, config: cfg })
    .map(c => [c.toolId, c]))
  const userSelectedEnvironment = String(options.preferredEnvironmentId || '').trim()
  const preferredEnvironmentId = environments.some(e => e.id === userSelectedEnvironment)
    ? userSelectedEnvironment : null
  const preferredToolId = cfg.planning?.preferredToolByTask?.[task] || null
  const seen = observed.get(root) || new Map()
  const ranked = []
  for (const environment of environments) {
    for (const toolId of profile.toolIds) {
      const local = environment.id === 'local' ? known.get(toolId) : null
      const probe = seen.get(probeKey(environment.id, toolId))
      let status = environment.id === 'local'
        ? local?.status || 'missing' : 'unknown'
      if (probe) {
        status = probe.status === 'probe_verified' ? 'probe_verified'
          : probe.status === 'located' ? 'located' : 'degraded'
      }
      const candidate = {
        environmentId: environment.id, environmentKind: environment.kind,
        environmentLabel: environment.label || environment.id,
        toolId, toolLabel: TOOL_CATALOG.find(t => t.id === toolId)?.label || toolId,
        status, version: probe?.version || null, checkedAt: probe?.checkedAt || null,
        path: local?.path || null, source: local?.source || null,
        sourceProviderId: local?.sourceProviderId || null,
        dependencyStatus: 'not-checked', capabilityVerified: false,
        executionStatus: 'not-run', lastExecution: null,
      }
      ranked.push(candidateScore(candidate, preferredEnvironmentId, preferredToolId))
    }
  }
  ranked.sort((a,b) => b.score-a.score || a.environmentId.localeCompare(b.environmentId) || a.toolId.localeCompare(b.toolId))
  const selected = ranked.find(c => c.status === 'probe_verified' || c.status === 'located') || null
  return {
    ok: true, task, selected, candidates: ranked,
    preferredEnvironmentId, preferredToolId,
    environmentDiscoveryAt: environmentSnapshot?.checkedAt || null,
    state: selected ? 'candidate-found' : 'unverified',
    note: '仅推荐；远端工具只有实际执行过明确版本探针才标记 probe_verified。未检查依赖，也不代表目标任务已执行或授权自动执行。',
  }
}
