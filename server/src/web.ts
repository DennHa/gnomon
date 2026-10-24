// The web app's sessions (/app: the Mac app's interface in the browser, docs/accounts-design.md section 3b).
//
// Signing in with email and password makes a device of the person's (client 'web', "Browser · Safari"), so it's
// listed on the account page and "Sign out everywhere" ends it like any other device. Its key lives only in a cookie
// that scripts can't read (HttpOnly), that is sent only over HTTPS and only to this server (__Host-, Secure, Path=/)
// and never with requests started by other sites (SameSite=Strict). On top of that, every request made with the
// cookie needs the CSRF token in a header, which other sites can't read or guess: a hash of the key, handed to the
// page when it signs in or loads. And when the browser says where a request comes from (Origin, Sec-Fetch-Site), it
// must be this server.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const WEB_COOKIE = '__Host-gnomon_session';
export const CSRF_HEADER = 'x-gnomon-csrf';
/** The cookie lasts 30 days and starts over each time the app loads, so it ends after 30 days unused. */
const WEB_SESSION_SECONDS = 30 * 86_400;

/** The session's key from the request's cookies, or ''. */
export function sessionCookie(req: IncomingMessage): string {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === WEB_COOKIE) return part.slice(i + 1).trim();
  }
  return '';
}

export const setSessionCookie = (key: string) => `${WEB_COOKIE}=${key}; Path=/; Max-Age=${WEB_SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
export const clearSessionCookie = () => `${WEB_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

/** The CSRF token that belongs to a session key. */
export const csrfFor = (key: string) => createHash('sha256').update(`gnomon-csrf:${key}`).digest('base64url');

export function csrfOk(req: IncomingMessage, key: string): boolean {
  const given = Buffer.from(String(req.headers[CSRF_HEADER] ?? ''));
  const want = Buffer.from(csrfFor(key));
  return given.length === want.length && timingSafeEqual(given, want);
}

/** False when the browser says the request comes from another site. */
export function sameOrigin(req: IncomingMessage): boolean {
  const site = String(req.headers['sec-fetch-site'] ?? '');
  if (site && site !== 'same-origin') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
  } catch {
    return false;
  }
}

/** "Browser · Safari": how a web session is listed among the person's devices. */
export function webDeviceName(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'web app';
  return `Browser · ${browser}`;
}
