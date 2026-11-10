/**
 * Browser origin checks for the local red-team HTTP bridge.
 * This prevents cross-site browser POSTs; it is NOT user authentication.
 */
export function allowedBridgeOrigin(req) {
  const remote = String(req.socket?.remoteAddress || '')
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
  const host = typeof req.headers?.host === 'string' ? req.headers.host : ''
  const hostLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)
  const origin = req.headers?.origin

  // The desktop app uses app:// or file:// (Origin: null); accept these
  // only when BOTH the peer and Host actually point at a local endpoint.
  if (loopback && hostLocal) {
    if (origin === undefined || origin === '' || origin === 'null') return true
    if (typeof origin === 'string' && /^app:/i.test(origin)) return true
  }
  if (typeof origin !== 'string' || origin === '') return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch {
    return false
  }
}
