/** Authorization of the DSH Purge HTTP bridge, independent from Origin/Host CSRF checks. */
import { createHash, timingSafeEqual } from 'node:crypto'
import { allowedBridgeOrigin } from './bridge-origin.js'

export function isLocalBridgePeer(req) {
  const remote = String(req.socket?.remoteAddress || '')
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
  const host = typeof req.headers?.host === 'string' ? req.headers.host : ''
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)
  // Reverse proxies may connect from loopback and expose the original peer
  // through forwarding headers. Any recognized proxy metadata disables the
  // local-desktop exemption, even when the proxy rewrites Host to localhost.
  const forwarded = Object.entries(req.headers || {}).some(([name, value]) =>
    /^(?:forwarded|via|x-forwarded-[a-z0-9-]+|x-real-ip|x-client-ip|x-cluster-client-ip|cf-connecting-ip|true-client-ip|x-original-host|x-original-forwarded-for)$/i
      .test(name) && String(value || '').trim())
  return loopback && localHost && !forwarded
}

/**
 * Local-only writes require a same-origin browser request or the private
 * Desktop Host cookie. This also rejects opaque origins and loopback proxies.
 */
export function isTrustedLocalRequest(req) {
  return isLocalBridgePeer(req) && allowedBridgeOrigin(req)
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
 * Read-only snapshot of the management bridge posture.
 * Node's accepted socket can expose the owning server's actual bound address.
 * This says nothing about reverse proxies, firewall rules or Internet reachability.
 */
export function bridgePrivacyPosture(req, env = process.env, servicePort) {
  const socket = req.socket || {}
  const acceptedAddress = typeof socket.localAddress === 'string' ? socket.localAddress : null
  const acceptedPort = Number(socket.localPort)
  const configuredPort = Number(servicePort)
  // localAddress identifies this accepted connection; server.address() identifies
  // the HTTP server's actual bind, which can be 0.0.0.0 even for loopback peers.
  let binding
  try { binding = socket.server?.address?.() } catch { /* Cannot inspect the owning server. */ }
  const boundAddress = binding && typeof binding === 'object' && typeof binding.address === 'string'
    ? binding.address : null
  const boundPort = Number(binding && typeof binding === 'object' ? binding.port : null)
  const listenerScope = boundAddress == null ? 'not_inspected'
    : boundAddress === '0.0.0.0' || boundAddress === '::' ? 'all_interfaces'
      : boundAddress === '::1' || /^127\./.test(boundAddress) || /^::ffff:127\./i.test(boundAddress)
        ? 'loopback_bound' : 'specific_interface'
  return {
    localPeer: isLocalBridgePeer(req),
    remoteTokenConfigured: Boolean(env.DSH_PURGE_BRIDGE_TOKEN),
    localTokenRequired: env.DSH_PURGE_REQUIRE_LOCAL_TOKEN === '1',
    // This is the address on which the current connection was accepted.
    // It is not necessarily the address on which the server socket was bound.
    acceptedAddress,
    acceptedPort: Number.isInteger(acceptedPort) && acceptedPort > 0 && acceptedPort <= 65535 ? acceptedPort : null,
    configuredPort: Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535 ? configuredPort : null,
    boundAddress,
    boundPort: Number.isInteger(boundPort) && boundPort > 0 && boundPort <= 65535 ? boundPort : null,
    publicReachability: 'not_tested',
    listenerScope,
  }
}
