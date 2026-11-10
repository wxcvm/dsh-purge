/** Authorization of the DSH Purge HTTP bridge, independent from Origin/Host CSRF checks. */
import { createHash, timingSafeEqual } from 'node:crypto'

export function isLocalBridgePeer(req) {
  const remote = String(req.socket?.remoteAddress || '')
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
  const host = typeof req.headers?.host === 'string' ? req.headers.host : ''
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)
  // Proxies may connect from loopback. Presence of forwarded metadata must
  // not accidentally activate the local-only authentication exemption.
  const forwarded = req.headers?.['x-forwarded-for'] || req.headers?.forwarded || ''
  return loopback && localHost && !String(forwarded).trim()
}

function matchesToken(provided, expected) {
  if (!provided || !expected) return false
  // Hash both inputs so constant-time comparison works for differing lengths.
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Local desktop traffic remains compatible by default.
 * Non-local API traffic requires an explicitly configured secret.
 * Set DSH_PURGE_BRIDGE_TOKEN to allow authenticated remote access; optionally
 * set DSH_PURGE_REQUIRE_LOCAL_TOKEN=1 to require it even on loopback.
 */
export function authorizeBridgeRequest(req, options = {}) {
  const local = isLocalBridgePeer(req)
  const requireLocalToken = options.requireLocalToken ?? process.env.DSH_PURGE_REQUIRE_LOCAL_TOKEN === '1'
  if (local && !requireLocalToken) return { ok: true, local: true }

  const expected = options.token ?? process.env.DSH_PURGE_BRIDGE_TOKEN ?? ''
  if (!expected) {
    return { ok: false, status: 403, error: 'bridge_remote_not_configured' }
  }
  const provided = req.headers?.['x-dsh-purge-token']
  if (typeof provided !== 'string' || provided === '') {
    return { ok: false, status: 401, error: 'bridge_token_required' }
  }
  if (!matchesToken(provided, expected)) {
    return { ok: false, status: 401, error: 'bridge_token_invalid' }
  }
  return { ok: true, local, tokenAuthenticated: true }
}

/**
 * Read-only, non-sensitive snapshot of the management bridge posture.
 * This does not inspect DSH's bound sockets or test public reachability.
 */
export function bridgePrivacyPosture(req, env = process.env, servicePort) {
  const socket = req.socket || {}
  const acceptedAddress = typeof socket.localAddress === 'string' ? socket.localAddress : null
  const acceptedPort = Number(socket.localPort)
  const configuredPort = Number(servicePort)
  return {
    localPeer: isLocalBridgePeer(req),
    remoteTokenConfigured: Boolean(env.DSH_PURGE_BRIDGE_TOKEN),
    localTokenRequired: env.DSH_PURGE_REQUIRE_LOCAL_TOKEN === '1',
    // This is the address on which the current connection was accepted.
    // It is not necessarily the address on which the server socket was bound.
    acceptedAddress,
    acceptedPort: Number.isInteger(acceptedPort) && acceptedPort > 0 && acceptedPort <= 65535 ? acceptedPort : null,
    configuredPort: Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535 ? configuredPort : null,
    publicReachability: 'not_tested',
    listenerScope: 'not_inspected',
  }
}
