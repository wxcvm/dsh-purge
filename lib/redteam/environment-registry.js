/**
 * Environment inventory. P0 exposes the current local host only; adding a
 * remote adapter must not silently start a VM, container or WSL distribution.
 */
import { localAdapter } from './adapters/local.js'
import { discoverWslEnvironments } from './adapters/wsl.js'

export function listEnvironments(options = {}) {
  return {
    ok: true,
    environments: [localAdapter.discover(options)],
    checkedAt: options.checkedAt || new Date().toISOString(),
    note: '同步清单仅包含当前主机。WSL 可通过 environmentDiscover 显式发现；SSH Kali 和 Docker 尚未接入。',
  }
}

/** Explicit async cross-environment discovery; never runs tools in a distro. */
export async function discoverEnvironments(options = {}) {
  const local = listEnvironments(options)
  const wsl = await discoverWslEnvironments(options)
  return {
    ...local,
    environments: local.environments.concat(wsl.environments),
    providers: { local: { state: 'discovered' }, wsl: { state: wsl.state, note: wsl.note } },
    note: '只读环境发现；未启动 WSL、VM 或容器，未执行工具或目标任务。',
  }
}

export function getEnvironment(id, options = {}) {
  if (id !== 'local') return null
  return localAdapter.discover(options)
}

export const ENVIRONMENT_KINDS = Object.freeze(['local', 'wsl', 'ssh', 'docker'])
