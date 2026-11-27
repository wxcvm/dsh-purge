/**
 * Local execution-environment adapter.
 *
 * Discovery and tool location are read-only. Version probes are opt-in and
 * retain the existing execFile({ shell: false }) implementation.
 */
import { arch, platform as osPlatform } from 'node:os'
import { TOOL_CATALOG, resolveTool } from '../platform-config.js'
import { probeInstalledTool } from '../tool-health.js'

export function discoverLocalEnvironment(options = {}) {
  const native = options.platform || osPlatform()
  const os = native === 'win32' ? 'windows' : native === 'linux' ? 'linux' : 'unknown'
  return {
    id: 'local',
    kind: 'local',
    label: os === 'windows' ? 'Windows 本机' : os === 'linux' ? 'Linux 本机' : '当前主机',
    os,
    distro: null,
    architecture: options.arch || arch(),
    reachable: true,
    privilege: 'unknown',
    discovery: {
      state: 'discovered',
      checkedAt: options.checkedAt || new Date().toISOString(),
      detail: '仅识别当前 Node 进程所在主机；未检查任何目标网络或远端环境。',
    },
  }
}

export function locateLocalTool(toolId, options = {}) {
  return resolveTool(toolId, options)
}

export async function probeLocalTool(toolId, options = {}) {
  if (!TOOL_CATALOG.some((item) => item.id === toolId)) {
    return { ok: false, id: toolId, status: 'unknown', error: '未知工具标识' }
  }
  return probeInstalledTool(toolId, options)
}

export const localAdapter = Object.freeze({
  kind: 'local',
  discover: discoverLocalEnvironment,
  locateTool: locateLocalTool,
  probeTool: probeLocalTool,
})
