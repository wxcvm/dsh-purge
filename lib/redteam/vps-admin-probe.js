import { authorizeBridgeRequest, bridgePrivacyPosture } from './bridge-auth.js'
import { readSavedAdminRoute, checkAdminRoute } from '../../scripts/vps-admin-check.mjs'

// A browser bridge must not become a general SSH execution interface.
// Require an explicit host-side opt-in, a local-only listener/peer and a token.
// Remote access, unknown listener scope and forwarded requests fail closed.
export function authorizeAdminProbe(req, env = process.env) {
  if (env.DSH_PURGE_LOCAL_SSH_CHECK !== '1') {
    return { ok: false, status: 403, error: '本机 SSH 检测未启用；可继续使用本机终端命令' }
  }
  const posture = bridgePrivacyPosture(req, env)
  if (!posture.localPeer || posture.listenerScope !== 'loopback_bound' ||
      Object.keys(req.headers || {}).some((key) => /^(forwarded|x-forwarded-|x-real-ip|via)/i.test(key))) {
    return { ok: false, status: 403, error: 'SSH 检测仅允许未转发的本机回环管理接口' }
  }
  const auth = authorizeBridgeRequest(req, { requireLocalToken: true, token: env.DSH_PURGE_BRIDGE_TOKEN || '' })
  if (!auth.ok) return auth
  return { ok: true }
}

let running = false

export async function probeSavedAdminRoute(root, options = {}) {
  if (running) return { ok: false, error: '已有 SSH 管理检测正在运行' }
  let route
  try { route = readSavedAdminRoute(root) }
  catch (error) { return { ok: false, error: error.message } }
  running = true
  try {
    const result = await checkAdminRoute(route.target, route.jumps, options.runner)
    return { ...result, checkedAt: new Date().toISOString() }
  } catch {
    return { ok: false, error: 'SSH 管理检测无法启动' }
  } finally {
    running = false
  }
}
