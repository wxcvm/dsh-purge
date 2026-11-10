/** Authorization of the DSH Purge HTTP bridge, independent from Origin/Host CSRF checks. */
import { createHash, timingSafeEqual } from 'node:crypto'

export function isLocalBridgePeer(req) {
  const remote = String(req.socket?.remoteAddress || '')
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
  const host = typeof req.headers?.host === 'string' ? req.headers.host : ''
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)
  // When a reverse proxy forwards requests, its remote address may be local;
  // a non-local Host still requires authentication.
  return loopback && localHost
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
