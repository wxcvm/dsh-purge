/**
 * Environment inventory. P0 exposes the current local host only; adding a
 * remote adapter must not silently start a VM, container or WSL distribution.
 */
import { localAdapter } from './adapters/local.js'
import { discoverWslEnvironments } from './adapters/wsl.js'
import { registeredKaliVm } from './adapters/ssh-kali.js'
import { discoverDockerEnvironments } from './adapters/docker.js'
import { discoverArtexLocalProvider } from './adapters/artex-local.js'
import { loadPlatformConfig, artexLocalEnv } from './platform-config.js'

export function listEnvironments(options = {}) {
  return {
    ok: true,
    environments: [localAdapter.discover(options)],
    checkedAt: options.checkedAt || new Date().toISOString(),
    note: '同步清单仅包含当前主机。WSL、已配置 SSH Kali 和 Docker 可通过 environmentDiscover 查看。',
  }
}

/** Explicit async cross-environment discovery; never runs tools in a distro. */
export async function discoverEnvironments(options = {}) {
  const local = listEnvironments(options)
  const [wsl, docker] = await Promise.all([
    discoverWslEnvironments(options),
    discoverDockerEnvironments({ ...options, execFileFn: options.dockerExecFileFn }),
  ])
  const kali = registeredKaliVm(options)
  const artex = discoverArtexLocalProvider({ ...options, env: artexLocalEnv(options.config || loadPlatformConfig(options.root), options.env) })
  return {
    ...local,
    environments: local.environments.concat(wsl.environments, kali ? [kali] : [], docker.environments),
    providers: {
      local: { state: 'discovered' },
      wsl: { state: wsl.state, note: wsl.note },
      ssh: { state: kali ? 'configured' : 'not-configured',
        note: kali ? 'SSH Kali 已配置，尚未连接；可单独检查 SSH 身份。' : '未配置 Kali VM SSH 主机。' },
      docker: { state: docker.state, note: docker.note },
      artex,
    },
    note: '发现 WSL、SSH 配置与 Docker 运行容器；ARTEX 仅作为本地工具来源，不是远端执行环境。',
  }
}

export function getEnvironment(id, options = {}) {
  if (id !== 'local') return null
  return localAdapter.discover(options)
}

export const ENVIRONMENT_KINDS = Object.freeze(['local', 'wsl', 'ssh', 'docker'])
