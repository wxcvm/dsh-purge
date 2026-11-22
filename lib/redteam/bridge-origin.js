/**
 * Browser origin checks for the local red-team HTTP bridge.
 * Cross-site and opaque ("null") origins are not trusted.
 *
 * Harness Desktop renders from dsh-app://app, then its main-process forwarder
 * removes Origin and attaches the Host authentication cookie. Current Desktop
 * versions use dsh-desktop-session; rc.5 uses the authority-bound
 * dsh-auth-<sha256(host)> cookie. Neither credential is exposed to page JS.
 */
import { createHash } from 'node:crypto'

function hasDesktopForwardingCookie(req) {
  const cookie = typeof req?.headers?.cookie === 'string' ? req.headers.cookie : '';
  const host = typeof req?.headers?.host === 'string' ? req.headers.host : '';
  let legacyCookieName = '';
  try {
    // Match Harness rc.5's requestAudience()/cookieName() spelling exactly:
    // HTTP cookies are bound to URL.host (including a non-default port).
    const authority = new URL(`http://${host}`).host;
    legacyCookieName = 'dsh-auth-' + createHash('sha256').update(authority).digest('base64url');
  } catch {
    // Invalid Host values cannot establish the legacy Desktop forwarding path.
  }
  return cookie.split(';').some((part) => {
    const separator = part.indexOf('=');
    if (separator <= 0) return false;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    return value.length > 0
      && (name === 'dsh-desktop-session' || (legacyCookieName !== '' && name === legacyCookieName));
  });
}

export function allowedBridgeOrigin(req) {
  const remote = String(req?.socket?.remoteAddress || '');
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const host = typeof req?.headers?.host === 'string' ? req.headers.host : '';
  const hostLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const origin = req?.headers?.origin;

  if (loopback && hostLocal) {
    if (origin === undefined || origin === '') return hasDesktopForwardingCookie(req);
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
