/**
 * ARTEX contributes local binary candidates; it is NOT a remote executor.
 * Its backend health, credentials and tasks are deliberately not consulted.
 */
import { ARTEX_SHARED_TOOLS, artexToolRoots, findArtexTool } from '../../artex-integration.js'

export function discoverArtexLocalProvider(options = {}) {
  const env = options.env || process.env
  const platform = options.platform || process.platform
  const checkedAt = options.checkedAt || new Date().toISOString()
  const tools = ARTEX_SHARED_TOOLS.map((toolId) => {
    const path = findArtexTool(toolId, { env, platform })
    return path ? {
      toolId, path, source: 'artex', environmentId: 'local',
      status: 'located', dependencyStatus: 'not-checked',
      capabilityVerified: false, executionStatus: 'not-run',
    } : null
  }).filter(Boolean)
  return {
    id: 'artex:local',
    kind: 'binary-source',
    executionEnvironmentId: 'local',
    state: tools.length ? 'located' : 'absent',
    toolCount: tools.length,
    tools,
    checkedAt,
    roots: artexToolRoots(env),
    online: null,
    note: tools.length
      ? 'ARTEX 提供了本机工具文件候选；不会借 ARTEX 服务执行，也未验证程序版本、依赖或任务。'
      : '没有从当前 ARTEX 工具目录发现可复用的本机工具；不代表 ARTEX 服务不存在。',
  }
}
