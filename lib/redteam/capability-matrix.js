/**
 * Read-only cross-environment capability matrix.
 *
 * A listed remote environment does not imply any tool is installed there.
 * Only local paths are resolved here. Explicit version probes happen through
 * the existing per-environment APIs; target execution is a separate workflow.
 */
import { TOOL_CATALOG } from './platform-config.js'
import { diagnoseEnvironmentTopology } from './environment-diagnostics.js'

export function composeCapabilityMatrix(discovery, localCapabilities, options = {}) {
  const environments = Array.isArray(discovery?.environments) ? discovery.environments : []
  const local = new Map(localCapabilities.map((item) => [item.toolId, item]))
  const checkedAt = options.checkedAt || new Date().toISOString()
  const rows = TOOL_CATALOG.map((tool) => ({
    toolId: tool.id,
    label: tool.label,
    group: tool.group,
    dependencyNote: tool.dependencyNotes || null,
    cells: environments.map((environment) => {
      const isLocal = environment.id === 'local'
      const found = isLocal ? local.get(tool.id) : null
      const status = isLocal ? (found?.status || 'missing') : 'not-checked'
      return {
        environmentId: environment.id,
        toolId: tool.id,
        status,
        path: isLocal ? (found?.path || null) : null,
        source: isLocal ? (found?.source || null) : null,
        sourceProviderId: isLocal ? (found?.sourceProviderId || null) : null,
        canProbe: !!tool.probeArgs,
        probeStatus: 'not-run',
        version: null,
        dependencyStatus: 'not-checked',
        capabilityVerified: false,
        executionStatus: 'not-run',
        checkedAt: null,
      }
    }),
  }))
  const localLocated = rows.filter((row) =>
    row.cells.some((cell) => cell.environmentId === 'local' && cell.status === 'located')).length
  return {
    ok: true, checkedAt, environments, providers: discovery?.providers || {},
    topology: discovery?.topology || null,
    localDiagnostics: discovery?.localDiagnostics || null,
    rows,
    summary: {
      environments: environments.length,
      tools: TOOL_CATALOG.length,
      localLocated,
      remoteUnchecked: Math.max(0, environments.length - 1) * TOOL_CATALOG.length,
      probeVerified: 0,
      capabilityVerified: 0,
      executed: 0,
    },
    note: '只读矩阵：本机仅定位路径，远端工具均为未检查；版本探针必须手动触发。ARTEX 是本机路径来源，不是独立执行环境。',
  }
}

export async function environmentCapabilityMatrix(options = {}) {
  const discovery = await diagnoseEnvironmentTopology(options)
  return composeCapabilityMatrix(discovery, discovery.localDiagnostics.capabilities, options)
}
