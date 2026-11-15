/**
 * Explicit cross-environment diagnosis: combines existing provider discovery
 * and local path inventory, never probes tool versions or target networks.
 */
import { discoverEnvironments } from './environment-registry.js'
import { diagnoseLocalEnvironment } from './capability-service.js'

export async function diagnoseEnvironmentTopology(options = {}) {
  const discovered = await discoverEnvironments(options)
  const localDiagnostics = diagnoseLocalEnvironment(options)
  const providers = discovered.providers || {}
  return {
    ...discovered,
    localDiagnostics,
    topology: {
      discoveredEnvironments: discovered.environments.length,
      localLocated: localDiagnostics.summary.located,
      localTotal: localDiagnostics.summary.total,
      providers: Object.fromEntries(
        Object.entries(providers).map(([name, provider]) => [
          name, { state: provider.state, note: provider.note || null },
        ])
      ),
      versionProbeState: 'not-checked',
      dependencyState: 'not-checked',
      taskExecutionState: 'not-checked',
    },
    note: '只读拓扑与本机路径诊断；不执行远端工具版本命令或目标任务。现有扫描执行记录须单独查 scanHistory。',
  }
}
