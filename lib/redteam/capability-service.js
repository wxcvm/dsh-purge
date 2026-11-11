/**
 * Read-only capability inventory for the current execution environment.
 *
 * Path located != version probe passed != dependencies checked != task run.
 * A version probe is only performed by the explicit probeLocalCapability API.
 */
import { TOOL_CATALOG, loadPlatformConfig } from './platform-config.js'
import { localAdapter } from './adapters/local.js'
import { listEnvironments } from './environment-registry.js'

const known = new Map(TOOL_CATALOG.map((item) => [item.id, item]))

export function inventoryLocalCapabilities(options = {}) {
  const config = options.config || loadPlatformConfig(options.root)
  return TOOL_CATALOG.map((definition) => {
    const found = localAdapter.locateTool(definition.id, { ...options, config })
    return {
      toolId: definition.id,
      label: definition.label,
      environmentId: 'local',
      path: found.path || null,
      source: found.source,
      status: found.path ? 'located' : 'missing',
      version: null,
      canProbe: !!definition.probeArgs,
      probe: null,
      dependencies: [],
      dependencyStatus: 'not-checked',
      capabilityVerified: false,
      executionStatus: 'not-run',
      lastExecution: null,
      limitations: found.path
        ? ['已定位文件，未执行版本检测或依赖验证。']
        : ['未定位工具文件。'],
    }
  })
}

export async function probeLocalCapability(id, options = {}) {
  if (!known.has(id)) return { ok: false, toolId: id, environmentId: 'local', status: 'unknown', error: '未知工具标识' }
  const probe = await localAdapter.probeTool(id, options)
  const status = probe.status === 'runnable' ? 'probe_verified'
    : probe.status === 'path-only' ? 'located'
      : probe.status === 'missing' ? 'missing' : 'degraded'
  return {
    ok: probe.ok,
    toolId: id,
    environmentId: 'local',
    path: probe.path || null,
    source: probe.source || 'missing',
    status,
    version: probe.version || null,
    probe: {
      status: probe.status,
      checkedAt: new Date().toISOString(),
      error: probe.error || null,
    },
    dependencies: [],
    dependencyStatus: 'not-checked',
    capabilityVerified: false,
    executionStatus: 'not-run',
    lastExecution: null,
    limitations: status === 'probe_verified'
      ? ['版本命令已成功；尚未检查完整依赖，未执行目标任务。']
      : [probe.note || probe.error || '工具尚未通过版本检测。'],
  }
}

export function diagnoseLocalEnvironment(options = {}) {
  const environments = listEnvironments(options)
  const capabilities = inventoryLocalCapabilities(options)
  const located = capabilities.filter((item) => item.status === 'located').length
  const missing = capabilities.length - located
  return {
    ok: true,
    environments: environments.environments,
    capabilities,
    summary: {
      total: capabilities.length,
      located,
      missing,
      probeVerified: 0,
      capabilityVerified: 0,
      executed: 0,
    },
    issues: missing ? [{ code: 'tools_missing', count: missing,
      message: '部分工具尚未定位；可设置工具目录或使用已有 ARTEX 工具路径。' }] : [],
    note: '这是一份只读路径诊断，不会运行版本命令、依赖测试或目标扫描；不存在已验证或已执行的推断。',
  }
}
