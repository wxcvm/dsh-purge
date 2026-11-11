/**
 * Environment inventory. P0 exposes the current local host only; adding a
 * remote adapter must not silently start a VM, container or WSL distribution.
 */
import { localAdapter } from './adapters/local.js'

export function listEnvironments(options = {}) {
  return {
    ok: true,
    environments: [localAdapter.discover(options)],
    checkedAt: options.checkedAt || new Date().toISOString(),
    note: '仅发现当前主机。WSL、SSH Kali 和 Docker 尚未接入，不代表它们不存在。',
  }
}

export function getEnvironment(id, options = {}) {
  if (id !== 'local') return null
  return localAdapter.discover(options)
}

export const ENVIRONMENT_KINDS = Object.freeze(['local', 'wsl', 'ssh', 'docker'])
