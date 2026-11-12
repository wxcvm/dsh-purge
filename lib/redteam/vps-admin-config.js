/**
 * Management-only SSH route preferences. No network activity or credentials.
 * Aliases refer to operator-owned entries in the local OpenSSH configuration.
 */
import { buildAdminProbeArgs } from '../../scripts/vps-admin-check.mjs'

export function normalizeAdminRoute(input) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  return {
    target: typeof value.target === 'string' ? value.target.trim() : '',
    jumps: Array.isArray(value.jumps) ? value.jumps.map((item) => typeof item === 'string' ? item.trim() : '') : [],
  }
}

export function validateAdminRoute(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.target !== 'string' || !Array.isArray(input.jumps) ||
      input.jumps.some((item) => typeof item !== 'string')) {
    return 'SSH 管理路径格式无效'
  }
  const route = normalizeAdminRoute(input)
  if (!route.target && route.jumps.length === 0) return null
  try {
    buildAdminProbeArgs(route.target, route.jumps)
    return null
  } catch {
    return 'SSH 管理路径无效：填写目标别名及最多四个不重复的跳板别名（字母、数字、点、下划线、连字符）'
  }
}
