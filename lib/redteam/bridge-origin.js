/**
 * Browser origin checks for the local red-team HTTP bridge.
 * Cross-site and opaque ("null") origins are not trusted.
 *
 * Harness Desktop renders from dsh-app://app, then its main-process forwarder
 * removes Origin and attaches the private dsh-desktop-session cookie before
 * sending the request to the Host. That cookie is the only no-Origin desktop
 * compatibility path; a sandboxed iframe's Origin: null is never equivalent.
 */
function hasDesktopSessionCookie(req) {
  const cookie = typeof req?.headers?.cookie === 'string' ? req.headers.cookie : '';
  return cookie.split(';').some((part) => {
    const separator = part.indexOf('=');
    return separator > 0
      && part.slice(0, separator).trim() === 'dsh-desktop-session'
      && part.slice(separator + 1).trim().length > 0;
  });
}

export function allowedBridgeOrigin(req) {
  const remote = String(req?.socket?.remoteAddress || '');
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const host = typeof req?.headers?.host === 'string' ? req.headers.host : '';
  const hostLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const origin = req?.headers?.origin;

  if (loopback && hostLocal) {
    if (origin === undefined || origin === '') return hasDesktopSessionCookie(req);
    if (origin === 'null') return false;
    // Only the established Harness legacy renderer origin is allowed here.
    // Arbitrary app:// origins must not gain the local token-free browser exception.
    if (typeof origin === 'string' && origin.toLowerCase() === 'app://dsh') return true;
  }
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
