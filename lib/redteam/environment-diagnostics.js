/**
 * Explicit cross-environment diagnosis: combines existing provider discovery
 * and local path inventory, never probes tool versions or target networks.
 */
import { discoverEnvironments } from './environment-registry.js'
import { diagnoseLocalEnvironment } from './capability-service.js'
import { rememberEnvironmentDiscovery } from './environment-planner.js'
import { assertPlatformRevision, loadPlatformConfig } from './platform-config.js'
import { platformConfigFailure } from './platform-settings.js'

/** Observe the saved configuration without rereading settings inside a provider. */
export async function observeEnvironmentConfig(root, expectedRevision, observe, onFresh) {
  try {
    const config = loadPlatformConfig(root)
    assertPlatformRevision(config, expectedRevision)
    const result = await observe({ root, config })
    assertPlatformRevision(loadPlatformConfig(root), config.configRevision)
    onFresh?.(result)
    return { ...result, configRevision: config.configRevision, checkedAt: result.checkedAt || new Date().toISOString() }
  } catch (error) {
    return platformConfigFailure(error)
  }
}

export async function diagnoseEnvironmentTopology(options = {}) {
  const config = options.config || loadPlatformConfig(options.root)
  if (config.error) return { ok: false, code: 'config_unavailable', error: config.error }
  const scope = { ...options, config }
  const discovered = await discoverEnvironments(scope)
  const localDiagnostics = diagnoseLocalEnvironment(scope)
  const providers = discovered.providers || {}
  const result = {
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
  // Report one coherent snapshot and don't publish an already superseded one.
  if (config.configRevision === undefined || loadPlatformConfig(options.root).configRevision === config.configRevision) {
    rememberEnvironmentDiscovery(options.root, result)
  }
  return result
}
