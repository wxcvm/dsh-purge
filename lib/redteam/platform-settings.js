/** Common, credential-free configuration responses for Web/Desktop and local dispatch. */
import { statSync } from 'node:fs'
import {
  assertPlatformRevision, assignToolkitFolder, loadPlatformConfig, PlatformConfigError, platformSummary,
  platformUiProjection, savePlatformConfig,
} from './platform-config.js'

export function platformConfigFailure(error, fallback = '无法读取环境检查结果，请重试。') {
  if (!(error instanceof PlatformConfigError)) return { ok: false, code: 'config_operation_failed', error: fallback }
  return { ok: false, code: error.code, error: error.message,
    ...(error.configRevision === undefined ? {} : { configRevision: error.configRevision }) }
}

function isDirectory(path) {
  try { return statSync(path).isDirectory() } catch { return false }
}

export function handlePlatformSettingsOp(root, request = {}) {
  const { op, expectedRevision } = request
  try {
    switch (op) {
      case 'platformConfigGet':
        return platformUiProjection(platformSummary(root))
      case 'platformConfigSave': {
        const persisted = savePlatformConfig(request.config ?? {}, root, { expectedRevision })
        return platformUiProjection(platformSummary(root, persisted))
      }
      case 'platformAssignToolkit':
        return platformUiProjection(assignToolkitFolder(request.dir, root, { expectedRevision }))
      case 'platformConfigCheck': {
        const config = loadPlatformConfig(root)
        assertPlatformRevision(config, expectedRevision)
        const summary = platformSummary(root, config)
        return {
          ok: true, configRevision: config.configRevision, checkedAt: new Date().toISOString(), environmentId: 'local',
          configExists: config.exists,
          toolkitDirectoryOk: isDirectory(summary.toolkitDir),
          toolkitDirectoryConfigured: !!config.toolkitDir,
          missingBinDirs: config.binDirs.filter(dir => !isDirectory(dir)),
          located: summary.tools.found, total: summary.tools.total,
        }
      }
      default:
        return undefined
    }
  } catch (error) {
    return platformConfigFailure(error, '环境配置操作未能完成，请刷新读回后再试。')
  }
}
