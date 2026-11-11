/**
 * Environment inventory. P0 exposes the current local host only; adding a
 * remote adapter must not silently start a VM, container or WSL distribution.
 */
import { localAdapter } from './adapters/local.js'
import { discoverWslEnvironments } from './adapters/wsl.js'
import { registeredKaliVm } from './adapters/ssh-kali.js'

export function listEnvironments(options = {}) {
  return {
    ok: true,
    environments: [localAdapter.discover(options)],
    checkedAt: options.checkedAt || new Date().toISOString(),
    note: '同步清单仅包含当前主机。WSL 与已配置的 SSH Kali 可通过 environmentDiscover 查看；Docker 尚未接入。',
  }
}

/** Explicit async cross-environment discovery; never runs tools in a distro. */
export async function discoverEnvironments(options = {}) {
  const local = listEnvironments(options)
  const wsl = await discoverWslEnvironments(options)
  const kali = registeredKaliVm(options)
  return {
    ...local,
    environments: local.environments.concat(wsl.environments, kali ? [kali] : []),
    providers: {
      local: { state: 'discovered' },
      wsl: { state: wsl.state, note: wsl.note },
      ssh: { state: kali ? 'configured' : 'not-configured',
        note: kali ? 'SSH Kali 已配置，尚未连接；可单独检查 SSH 身份。' : '未配置 Kali VM SSH 主机。' },
    },
    note: '只读环境发现；仅列出 SSH 配置，不连接 VM、不执行工具或目标任务。',
  }
}

export function getEnvironment(id, options = {}) {
  if (id !== 'local') return null
  return localAdapter.discover(options)
}

export const ENVIRONMENT_KINDS = Object.freeze(['local', 'wsl', 'ssh', 'docker'])
