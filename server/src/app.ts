// HTTP handling: auth, body parsing, the API (the Mac app's own router from src/api.ts plus a few server-only
// routes for the phone and for syncing), and the static web app.
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { handleApiRequest, type ApiRequest, type ApiResponse } from '../../src/api';
import { phoneApi } from '../../src/phone';
import type { Data, Entry, Settings } from '../../src/types';
import { ACCOUNT_SETTINGS, type AccountSettings, type RemoteAccount } from '../../src/sync';
import { KINDS, keyOf, type Device, type Kind, type Store } from './store';
import { currentRelease, githubRelease, looksLikeDmg, peekGithubRelease, pickLang, readRelease, releasePage } from './releases';
import type { Backups } from './backups';
import type { Encryption } from './open-store';
import { VERSION } from './version';
import { roadmapFeedback } from './roadmap';
import { applyConfigUpdate, companyHours, mobileconfig, parseEmailSettings, testFloat, testPersonio, type Company } from './company';
import { randomBytes } from 'node:crypto';
import { clearSessionCookie, csrfFor, csrfOk, sameOrigin, sessionCookie, setSessionCookie, webDeviceName } from './web';
import { resetEmail, testEmail, type Lang } from './emails';
import { invitePeople, sendInvitation, type InviteDeps } from './invites';
import { MailError, type Transport } from './mail';
import { importPeople, MAX_BATCH, MAX_IMPORT, parsePeopleList, previewImport } from './people-import';

const MB = 1024 * 1024;
const PAIR_MAX_FAILURES = 10;
const PAIR_LOCK_MS = 15 * 60_000;

/** releasesDir: optional folder with version.json and the .dmg for /latest (see releases.ts). */
/** company: the setup wizard's settings and secrets (company.ts); without it, /setup and /admin aren't served. */
/** demoDir: optional folder with the web demo (npm run build:demo in the repo root), served at /example. */
/** siteDir: optional folder with the one-page site (site/ in the repo), served at /about. */
/** roadmapDir: the roadmap page built from docs/ROADMAP.md (dist/roadmap), served at /roadmap. */
/** mail: how to send email instead of the one set up in Settings → Email (tests use a fake one). */
/** backups: the nightly encrypted backups (backups.ts), shown and set on the setup page. */
/** macAppDir: where an uploaded Mac app is kept (the data folder's releases/). */
/** encryption: whether the data is encrypted at rest (open-store.ts), for the setup and Admin pages. */
/** https: how the install script set up HTTPS (GNOMON_HTTPS: caddy, proxy, tunnel or local), shown on the setup page. */
export type AppOptions = {
  store: Store;
  webDir?: string;
  releasesDir?: string;
  company?: Company;
  demoDir?: string;
  siteDir?: string;
  roadmapDir?: string;
  mail?: Transport;
  backups?: Backups;
  macAppDir?: string;
  https?: string;
  encryption?: () => Encryption;
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
};

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.jpeg': 'image/jpeg',
};

// The web app (/app): like the phone app's, without the camera; forms only post to this server.
const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

// The web demo (/example) is the Mac app's own interface, which sets some styles inline; it never talks to the server.
// The one-page site (/about): static, nothing inline, nothing from elsewhere.
const SITE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

// On a computer, the phone view sits in a phone-shaped frame of its own page, so framing by itself is allowed.
const DEMO_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const bad = (message: string) => new HttpError(422, 'invalid', message);
/** A plausible email address, lowercase, or a 422. */
function validEmail(v: unknown): string {
  const email = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw bad('Enter an email address like name@example.com');
  return email;
}
function validPassword(v: unknown): string {
  const pw = typeof v === 'string' ? v : '';
  if (pw.length < 10 || pw.length > 200) throw bad('The password needs at least 10 characters');
  return pw;
}

/** Who's asking, for rate limits: behind Cloudflare or a proxy its header, otherwise the connection. */
function clientAddress(req: IncomingMessage): string {
  // Which header to believe is set by the install script (GNOMON_TRUST_PROXY): `cloudflare` (a tunnel: Cloudflare sets
  // CF-Connecting-IP), `proxy` (Caddy or the company's proxy, which adds the client last to X-Forwarded-For), `none`
  // (nothing in front, so headers could be made up). Unset: either header, as before.
  const trust = process.env.GNOMON_TRUST_PROXY?.trim();
  const socket = req.socket.remoteAddress || 'unknown';
  if (trust === 'none') return socket;
  if (trust === 'cloudflare') return String(req.headers['cf-connecting-ip'] ?? '').trim() || socket;
  if (trust === 'proxy') return String(req.headers['x-forwarded-for'] ?? '').split(',').pop()!.trim() || socket;
  const fwd = String(req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return fwd || socket;
}

/** Names that say nothing about which device it is; a device's own description replaces them when it connects. */
const GENERIC_NAMES = new Set(['', 'phone', 'iphone', 'ipad', 'mac', 'macbook', 'device', 'browser', 'handy', 'gerät']);

/** "iPhone · Safari", "iPhone · home screen app", "Mac · Chrome": what connected, from its browser. */
export function describeDevice(ua: string, standalone = false): string {
  const model = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android phone' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux PC' : 'Browser';
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${model} · ${standalone ? 'home screen app' : browser}`;
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(json), ...headers });
  res.end(json);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'too_large', `The body can be at most ${limit / MB} MB`));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const RESET_MINUTES = 30;

/** The page shows its own text for `code` (with `host` and `detail`); `message` is the same in English, for scripts. */
export type AddressCheck = { ok: boolean; code: 'ok' | 'ok_local' | 'not_https' | 'dns' | 'refused' | 'timeout' | 'certificate' | 'other_server' | 'invalid'; message: string; host?: string; detail?: string };

/**
 * Whether the server's public address really leads back to this server over HTTPS with a valid certificate: it asks
 * `<url>/.well-known/gnomon-check/<nonce>`, which only this process answers with 200. Node checks the certificate the
 * way browsers do (a company's own certificate authority needs NODE_EXTRA_CA_CERTS, see docs/admin-guide.md).
 */
async function checkAddress(url: string, nonce: string): Promise<AddressCheck> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, code: 'invalid', message: 'That isn’t an address like https://gnomon.example.com' };
  }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return { ok: false, code: 'not_https', message: 'The address has to start with https://' };
  try {
    const res = await fetch(new URL(`/.well-known/gnomon-check/${nonce}`, u), { signal: AbortSignal.timeout(10_000), redirect: 'manual', headers: { 'User-Agent': 'Gnomon server (address check)' } });
    if (res.status === 200 && (await res.json().catch(() => null))?.gnomon === nonce) {
      return local && u.protocol === 'http:'
        ? { ok: true, code: 'ok_local', message: 'Reachable, but only on this machine and without HTTPS: fine for a test.' }
        : { ok: true, code: 'ok', message: 'Reachable over HTTPS with a valid certificate, and it’s this server.' };
    }
    return { ok: false, code: 'other_server', detail: String(res.status), message: `The address answers (${res.status}), but not as this Gnomon server. Check that the proxy or tunnel forwards it here.` };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const code = err.cause?.code ?? '';
    if (err.name === 'TimeoutError') return { ok: false, code: 'timeout', message: 'No answer within 10 seconds. A firewall, or the server can’t reach its own public address from inside (try it in a browser too).' };
    if (/ENOTFOUND|EAI_AGAIN/.test(code)) return { ok: false, code: 'dns', host: u.hostname, message: `The name ${u.hostname} isn’t found in DNS (yet).` };
    if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/.test(code)) return { ok: false, code: 'refused', message: 'Nothing answers on that address. Is the proxy or tunnel running?' };
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME|TLS|SSL/i.test(code + (err.cause?.message ?? ''))) return { ok: false, code: 'certificate', host: u.hostname, detail: code || 'TLS', message: `The certificate isn’t valid for ${u.hostname} (${code || 'TLS error'}).` };
    return { ok: false, code: 'refused', detail: err.cause?.message ?? err.message, message: `Couldn’t reach the address: ${err.cause?.message ?? err.message}` };
  }
}

export function createApp({ store, webDir, releasesDir, company, demoDir, siteDir, roadmapDir, mail, backups, macAppDir, https, encryption }: AppOptions) {
  let pairFailures = 0;
  let pairLockedUntil = 0;

  // ---- Email: invitations and password resets (docs/accounts-design.md, section 3b) ---------------

  const transport = (): Transport | undefined => mail ?? company?.mailTransport();
  /** The server's own address for links in emails: only the one set up, never a request's Host header (which anyone can fake). */
  const publicBase = () => (company?.get().company.publicUrl || process.env.GNOMON_PUBLIC_URL?.trim() || '').replace(/\/+$/, '');
  const serverName = () => company?.get().company.name || 'Gnomon';
  /** Email can go out: a way to send and an address for the links. */
  const canEmail = () => Boolean(transport() && publicBase());
  /** The language for an email: the server's, or else the asking browser's. */
  const langFor = (req: IncomingMessage): Lang => {
    const l = company?.get().company.language;
    return l === 'en' || l === 'de' ? l : pickLang(req.headers['accept-language']);
  };
  /** Counts within a time window, in memory, for rate limits: true while under `max`. */
  const windows = new Map<string, number[]>();
  function allow(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const recent = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return (windows.set(key, recent), false);
    windows.set(key, [...recent, now]);
    if (windows.size > 10_000) for (const [k, v] of windows) if (!v.some((t) => now - t < 3_600_000)) windows.delete(k);
    return true;
  }
  /** Send a password reset link to an active person with an email. Throws a MailError when it doesn't go out. */
  async function sendReset(req: IncomingMessage, personId: string) {
    const person = store.person(personId);
    const send = transport();
    if (!person?.email || person.status !== 'active' || !send || !publicBase()) return;
    const token = store.createReset(person.id, RESET_MINUTES);
    await send(resetEmail({ lang: langFor(req), to: person.email, server: serverName(), link: `${publicBase()}/account/reset#token=${token}` }));
  }

  /**
   * Everything a request may touch, for the person whose device is asking: their data through the shared router
   * (src/api.ts) and the phone's routes (src/phone.ts). There is no way from here to anyone else's records.
   */
  function scoped(personId: string) {
    const ctx = { get: () => store.get(personId), commit: (d: Data) => void store.commit(d, undefined, personId) };
    const api = (method: string, p: string, query: Record<string, string> = {}, body: unknown = undefined): ApiResponse => handleApiRequest(ctx, { method, path: p, query, body } satisfies ApiRequest);
    return { api, phone: phoneApi(ctx, () => ({ cursor: store.cursor() })) };
  }

  // ---- Server-only routes -------------------------------------------------------------------

  function pull(query: Record<string, string>, personId: string) {
    const since = Number(query.since ?? '0');
    if (!Number.isInteger(since) || since < 0) throw bad('since must be a cursor (a whole number) from an earlier response');
    const limit = Math.min(Number(query.limit ?? '5000') || 5000, 5000);
    const changes = store.changesSince(since, limit + 1, personId);
    const more = changes.length > limit;
    const page = changes.slice(0, limit);
    return { cursor: page.length ? page[page.length - 1].seq : Math.max(since, 0), more, changes: page.map(({ seq: _seq, ...c }) => c), account: remoteAccount(personId), ...companyPart() };
  }

  // The company's choices every device follows (src/corridor.ts): balance or corridor, and the corridor's zones.
  // Only settings, the same for everyone; nothing about anyone's times goes the other way.
  const companyPart = () => (company ? { company: { hours: companyHours(company.get()) } } : {});

  // Account settings (src/sync.ts): the person's targets, schedule, balance, language…, the same on every device. Kept
  // with the time they last changed; also put into the person's Data, so the phone and the API use the same targets.
  function remoteAccount(personId: string): RemoteAccount | null {
    const raw = store.getMeta(`account:${personId}`);
    return raw ? (JSON.parse(raw) as RemoteAccount) : null;
  }

  /** Pushed account settings, checked: only the known keys. */
  function validAccount(a: unknown): RemoteAccount {
    if (!isObj(a) || !isObj(a.values) || typeof a.updatedAt !== 'string' || Number.isNaN(Date.parse(a.updatedAt))) throw bad('account must be { values, updatedAt }');
    const updatedAt = new Date(a.updatedAt).toISOString();
    if (updatedAt > new Date(Date.now() + 5 * 60_000).toISOString()) throw bad('account.updatedAt is in the future; check the device clock');
    const values: Record<string, unknown> = {};
    for (const k of ACCOUNT_SETTINGS) if (a.values[k] !== undefined) values[k] = a.values[k];
    const weeks = a.values.reviewedWeeks;
    if (weeks !== undefined) {
      if (!Array.isArray(weeks) || weeks.length > 5000 || !weeks.every((w) => typeof w === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w))) throw bad('account.values.reviewedWeeks must be dates (YYYY-MM-DD)');
      values.reviewedWeeks = weeks;
    }
    if (JSON.stringify(values).length > 64 * 1024) throw bad('account.values is too large');
    return { values: values as AccountSettings, updatedAt };
  }

  /** Take account settings if they're newer than the server's (last writer wins, like records). */
  function pushAccount({ values, updatedAt }: RemoteAccount, personId: string) {
    const current = remoteAccount(personId);
    if (current && current.updatedAt >= updatedAt) return;
    store.setMeta(`account:${personId}`, JSON.stringify({ values, updatedAt }));
    const { reviewedWeeks: _w, ...settings } = values;
    const d = store.get(personId);
    store.commit({ ...d, settings: { ...d.settings, ...settings } as Settings }, undefined, personId);
  }

  function validRecord(kind: Kind, id: string, data: unknown): boolean {
    if (!isObj(data)) return false;
    const iso = (v: unknown) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
    const s = (v: unknown, max = 2000) => typeof v === 'string' && v.length <= max;
    if (kind === 'workdays') return data.date === id && /^\d{4}-\d{2}-\d{2}$/.test(id) && iso(data.start) && (data.end === undefined || iso(data.end)) && Array.isArray(data.breaks);
    if (data.id !== id) return false;
    if (kind === 'entries') return iso(data.start) && (data.end === undefined || iso(data.end)) && (data.description === undefined || s(data.description));
    return s(data.name, 200) && (data.color === undefined || (typeof data.color === 'string' && /^#([0-9a-fA-F]{3}){1,2}$/.test(data.color)));
  }

  /**
   * Apply changes from a syncing client. Each change wins only if it is newer than what the server has
   * (last writer wins, per record), so pushing the same batch twice is harmless.
   */
  function push(body: unknown, personId: string) {
    if (!isObj(body) || !Array.isArray(body.changes)) throw bad('Send { "changes": [ { kind, id, updatedAt, deleted, data } ] }');
    if (body.changes.length > 20_000) throw bad('At most 20000 changes per request');
    const account = body.account !== undefined ? validAccount(body.account) : undefined;
    const d = store.get(personId);
    const lists = Object.fromEntries(KINDS.map((k) => [k, new Map((d[k] as { id?: string; date?: string }[]).map((r) => [keyOf(k, r as never), r]))])) as Record<Kind, Map<string, unknown>>;
    const stamps = new Map<string, string>();
    const skipped: { kind: string; id: string; reason: string }[] = [];
    let applied = 0;
    body.changes.forEach((c: unknown, i: number) => {
      if (!isObj(c)) throw bad(`changes[${i}] must be an object`);
      const kind = c.kind as Kind;
      const id = c.id;
      if (!KINDS.includes(kind)) throw bad(`changes[${i}].kind must be one of ${KINDS.join(', ')}`);
      if (typeof id !== 'string' || !id || id.length > 200) throw bad(`changes[${i}].id must be a string`);
      if (typeof c.updatedAt !== 'string' || Number.isNaN(Date.parse(c.updatedAt))) throw bad(`changes[${i}].updatedAt must be an ISO date-time`);
      const updatedAt = new Date(c.updatedAt).toISOString();
      if (updatedAt > new Date(Date.now() + 5 * 60_000).toISOString()) throw bad(`changes[${i}].updatedAt is in the future; check the device clock`);
      if (!c.deleted && !validRecord(kind, id, c.data)) throw bad(`changes[${i}].data is not a valid ${kind.slice(0, -1)} with id ${id}`);
      const current = stamps.get(`${kind}:${id}`) ?? store.updatedAt(kind, id, personId);
      if (current && current > updatedAt) return void skipped.push({ kind, id, reason: 'server_newer' });
      if (c.deleted) lists[kind].delete(id);
      else lists[kind].set(id, c.data);
      stamps.set(`${kind}:${id}`, updatedAt);
      applied++;
    });
    let next = { ...d, ...Object.fromEntries(KINDS.map((k) => [k, [...lists[k].values()]])) } as Data;
    next = oneRunningTimer(next, stamps);
    store.commit(next, (kind, id) => stamps.get(`${kind}:${id}`) ?? new Date().toISOString(), personId);
    if (account) pushAccount(account, personId);
    return { applied, skipped, cursor: store.cursor(), account: remoteAccount(personId), ...companyPart() };
  }

  /** Two devices may each have started a timer while offline: keep the newest, end the others when it began. */
  function oneRunningTimer(d: Data, stamps: Map<string, string>): Data {
    const running = d.entries.filter((e) => !e.end).sort((a, b) => b.start.localeCompare(a.start));
    if (running.length < 2) return d;
    const keep = running[0];
    const now = new Date().toISOString();
    return {
      ...d,
      entries: d.entries.map((e): Entry => {
        if (e.end || e.id === keep.id) return e;
        stamps.set(`entries:${e.id}`, now);
        return { ...e, end: keep.start > e.start ? keep.start : now };
      }),
    };
  }

  // Votes, comments and ideas on the roadmap (roadmap.ts).
  const roadmap = roadmapFeedback(store, roadmapDir, VERSION, (status, code, message) => new HttpError(status, code, message));

  function serverRoute(method: string, p: string, query: Record<string, string>, body: unknown, device: Device): ApiResponse | undefined {
    const rm = roadmap.route(method, p, body, device.personId);
    if (rm) return rm;
    if (method === 'GET' && p === '/me') return { status: 200, body: { id: device.id, name: device.name } };
    // Whose account this device is signed in to, for "Signed in as …" on the Mac.
    if (method === 'GET' && p === '/me/account') {
      const x = store.person(device.personId)!;
      return { status: 200, body: { name: x.name, email: x.email, role: x.role } };
    }
    // Your own devices (never anyone else's), e.g. so the Mac knows whether a phone is connected yet.
    if (method === 'GET' && p === '/me/devices')
      return { status: 200, body: store.listDevices().filter((d) => !d.revokedAt && d.personId === device.personId).map((d) => ({ id: d.id, name: d.name, client: d.client ?? null, lastSeenAt: d.lastSeenAt, current: d.id === device.id })) };
    if (method === 'DELETE' && p === '/me') {
      store.revokeDevice(device.id);
      return { status: 200, body: { revoked: device.id } };
    }
    if (method === 'POST' && p === '/pair-codes') {
      // A signed-in device (the Mac, or a phone) invites another one, e.g. by showing this code as a QR code.
      // Without a name, the device names itself when it connects (see describeDevice).
      const name = isObj(body) && typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
      // Up to 60 minutes, for handing the connection over to the home-screen app (added a bit later).
      const ttl = isObj(body) && typeof body.minutes === 'number' ? Math.min(60, Math.max(1, Math.round(body.minutes))) : 10;
      const code = store.createPairCode(name, ttl, device.personId); // the new device joins the same person
      return { status: 201, body: { code: `${code.slice(0, 4)}-${code.slice(4)}`, name, expiresAt: new Date(Date.now() + ttl * 60_000).toISOString() } };
    }
    if (method === 'POST' && (p === '/admin-link' || p === '/account-link')) {
      // A signed-in device opens its person's account page, or (for an admin) the Admin page, in the browser,
      // already signed in: a one-time link for 5 minutes.
      if (isObj(body) && body.client === 'mac') store.setDeviceClient(device.id, 'mac');
      const admin = p === '/admin-link';
      if (admin && store.person(device.personId)?.role !== 'admin') throw new HttpError(403, 'not_admin', 'Only admins can open the Admin page.');
      const code = store.createAdminCode(`${admin ? 'admin' : 'account'}:${device.personId}`, 5);
      if (admin) company?.save(company.get(), `Admin page opened from ${device.name}`);
      return { status: 201, body: { path: `/${admin ? 'admin' : 'account'}#code=${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() } };
    }
    if (method === 'GET' && p === '/sync') return { status: 200, body: pull(query, device.personId) };
    if (method === 'POST' && p === '/sync') return { status: 200, body: push(body, device.personId) };
    // The phone's own routes (state, attendance corrections, breaks, activities) are shared with the web demo.
    return scoped(device.personId).phone.route(method, p, body, device);
  }

  // ---- Request entry point ----------------------------------------------------------------------

  // ---- Setup wizard and Admin page (docs/company-setup.md) --------------------------------------
  // Access: the admin password (set once, see below), or a one-time code (from the server log, `gnomon-admin admin-link`
  // or the Mac's "Open server admin"), traded for a session that lives in memory for two hours after the last request.
  // A restart signs the admin out.
  // Browser sessions (Admin page and account page): always a person's, kept in memory for two hours after the last
  // request; a restart signs everyone out of the browser (devices keep their keys).
  const sessions = new Map<string, { personId: string; until: number }>();
  // Open address checks (checkAddress): /.well-known/gnomon-check/<nonce> answers only these.
  const checkNonces = new Set<string>();
  const ADMIN_SESSION_MS = 2 * 3_600_000;
  let adminFailures = 0;
  let adminLockedUntil = 0;
  // Wrong passwords: five tries per address, then 15 minutes of nothing (also for the right one), against guessing.
  const loginFails = new Map<string, { n: number; until: number }>();
  function loginGuard(address: string) {
    const f = loginFails.get(address);
    if (f && f.until > Date.now()) throw new HttpError(429, 'too_many_attempts', 'Too many wrong passwords. Try again in 15 minutes.');
  }
  function loginFailed(address: string): never {
    const f = loginFails.get(address);
    const n = (f && f.until <= Date.now() && f.until !== 0 ? 0 : (f?.n ?? 0)) + 1;
    loginFails.set(address, { n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + PAIR_LOCK_MS : 0 });
    throw new HttpError(401, 'wrong_password', 'That email or password isn’t right');
  }
  /** Email and password → the person, for anyone who may sign in (not invited-only, pending or disabled). */
  function checkLogin(req: IncomingMessage, email: unknown, password: unknown, adminWithoutEmail = false) {
    const address = clientAddress(req);
    loginGuard(address);
    const pw = typeof password === 'string' && password.length <= 200 ? password : '';
    const em = typeof email === 'string' ? email.trim().toLowerCase() : '';
    // The owner from before people existed may not have an email yet: on the Admin page, the password alone.
    const owner = store.person(store.ownerId)!;
    const person = em ? store.personByEmail(em) : adminWithoutEmail && !owner.email ? owner : undefined;
    if (!person || !pw || person.status !== 'active' || !store.checkPassword(person.id, pw)) loginFailed(address);
    loginFails.delete(address);
    return person;
  }
  // Feedback limits, in memory (a restart forgets them, which is fine for spam protection).
  const feedbackLog = new Map<string, number[]>();
  let feedbackDay: number[] = [];
  function feedbackAllowed(address: string, isNew = true): boolean {
    const now = Date.now();
    const key = `${isNew ? 'new' : 'more'}:${address}`; // new conversations and follow-ups count separately
    const mine = (feedbackLog.get(key) ?? []).filter((t) => now - t < 3_600_000);
    feedbackDay = feedbackDay.filter((t) => now - t < 86_400_000);
    if (mine.length >= (isNew ? 5 : 20) || feedbackDay.length >= 200) return false;
    feedbackLog.set(key, [...mine, now]);
    feedbackDay.push(now);
    return true;
  }
  const newSession = (personId: string) => {
    const token = randomBytes(24).toString('base64url');
    sessions.set(token, { personId, until: Date.now() + ADMIN_SESSION_MS });
    return token;
  };
  const bearer = (req: IncomingMessage) => {
    const auth = String(req.headers.authorization ?? '');
    return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  };

  /** The person a browser session belongs to (and still may sign in), or undefined. */
  function sessionPerson(req: IncomingMessage) {
    const token = bearer(req);
    const sess = sessions.get(token);
    if (!sess || sess.until < Date.now()) return undefined;
    const person = store.person(sess.personId);
    if (!person || person.status !== 'active') return undefined;
    sess.until = Date.now() + ADMIN_SESSION_MS;
    return person;
  }

  /** Sign a person out of every browser and every device. */
  function signOutEverywhere(personId: string) {
    for (const [token, sess] of sessions) if (sess.personId === personId) sessions.delete(token);
    for (const d of store.listDevices()) if (!d.revokedAt && d.personId === personId) store.revokeDevice(d.id);
  }

  function adminState(meId: string) {
    const me = store.person(meId)!;
    const c = company!.get();
    // Where /latest gets the Mac app (releases.ts); GitHub's answer is the cached one, so this never waits for it.
    const from = releasesDir ? 'folder' : c.macApp.source;
    const release = from === 'github' ? peekGithubRelease() : readRelease(from === 'folder' ? releasesDir : macAppDir);
    return {
      version: VERSION,
      https: https ?? null,
      config: { ...c, audit: c.audit.slice(-20).reverse() },
      secrets: { float: company!.hasSecret('float'), personio: company!.hasSecret('personio'), email: company!.hasSecret('email') },
      // Whether email goes out (set up, and the server knows its address for links), for invitations and resets.
      email: { ready: canEmail(), publicUrl: Boolean(publicBase()) },
      keySource: company!.keySource,
      release: release ? { version: release.version, size: release.size, date: release.date ?? null } : null,
      macApp: { from, upload: macAppDir ? readRelease(macAppDir)?.version ?? null : null },
      backups: backups ? backups.status() : null,
      encryption: encryption ? encryption() : null,
      devices: store.listDevices().filter((d) => !d.revokedAt).length,
      passwordSet: store.hasPassword(me.id),
      feedbackUnread: store.listFeedback().filter((t) => t.unread).length,
      roadmapWaiting: roadmap.waiting(),
      me: { id: me.id, email: me.email, name: me.name },
      registration: store.registration(),
      pending: store.listPeople().filter((x) => x.status === 'pending').length,
    };
  }

  /**
   * The Admin page's home: how many people are in, what needs attention and whether the server is healthy. Counts and
   * statuses only: admins never see anyone's times.
   */
  async function adminOverview(meId: string) {
    const c = company!.get();
    const people = store.listPeople();
    const now = Date.now();
    const expired = people.filter((x) => x.status === 'invited' && Date.parse(store.inviteExpiresAt(x.id) ?? '') < now).length;
    const count = (status: string) => people.filter((x) => x.status === status).length;
    const counts = { active: count('active'), invited: count('invited') - expired, expired, pending: count('pending'), disabled: count('disabled'), admins: people.filter((x) => x.role === 'admin' && x.status === 'active').length, devices: store.listDevices().filter((d) => !d.revokedAt).length };
    // A newer official release than this server: GitHub's answer is cached for an hour, so this waits at most once.
    const latest = peekGithubRelease() ?? (await Promise.race([githubRelease(), new Promise<null>((r) => setTimeout(() => r(null), 2500).unref())]));
    const newer = (a: string, b: string) => {
      const [x, y] = [a, b].map((v) => v.split(/[-+]/)[0].split('.').map(Number));
      const i = x.findIndex((n, k) => n !== y[k]);
      return /^\d+\.\d+\.\d+/.test(a) && /^\d+\.\d+\.\d+/.test(b) && i >= 0 && x[i] > y[i];
    };
    const update = latest && newer(latest.version, VERSION) ? { version: latest.version, date: latest.date ?? null } : null;
    const b = backups?.status();
    const lastOk = b?.files[0]?.at ?? null;
    let disk: { free: number; total: number } | null = null;
    try {
      const st = backups && fs.statfsSync(path.dirname(backups.dir));
      if (st) disk = { free: st.bavail * st.bsize, total: st.blocks * st.bsize };
    } catch {
      disk = null;
    }
    const attention: { code: string; n?: number; at?: string; error?: string; version?: string; files?: string[] }[] = [];
    const enc = encryption ? encryption() : null;
    if (counts.pending) attention.push({ code: 'pending', n: counts.pending });
    if (expired) attention.push({ code: 'invitesExpired', n: expired });
    if (!canEmail()) attention.push({ code: transport() ? 'addressMissing' : 'emailMissing' });
    if (enc && !enc.encrypted) attention.push({ code: 'notEncrypted' });
    if (enc?.plainCopies.length) attention.push({ code: 'plainCopies', n: enc.plainCopies.length, files: enc.plainCopies });
    if (b && !b.keySet) attention.push({ code: 'backupNoPassword' });
    else if (b?.last && !b.last.ok) attention.push({ code: 'backupFailed', at: b.last.at, error: b.last.error });
    else if (b && !b.enabled) attention.push({ code: 'backupsOff' });
    else if (b && (!lastOk || now - Date.parse(lastOk) > 2 * 86_400_000) && now - Date.parse(b.keySetAt ?? '') > 2 * 86_400_000) attention.push({ code: 'backupOld', at: lastOk ?? undefined });
    if (disk && (disk.free < 1024 * MB || disk.free / disk.total < 0.05)) attention.push({ code: 'diskLow' });
    if (update) attention.push({ code: 'update', version: update.version });
    if (!store.hasPassword(meId)) attention.push({ code: 'adminPassword' });
    const unread = store.listFeedback().filter((t) => t.unread).length;
    if (unread) attention.push({ code: 'feedback', n: unread });
    if (roadmap.waiting()) attention.push({ code: 'roadmap', n: roadmap.waiting() });
    return {
      counts,
      attention,
      health: {
        version: VERSION,
        update,
        https: https ?? null,
        keySource: company!.keySource,
        email: { ready: canEmail(), provider: c.email?.provider ?? null, tested: c.email?.tested ?? null },
        backups: b ? { enabled: b.enabled, hour: b.hour, keySet: b.keySet, last: b.last ?? null, newest: lastOk, count: b.files.length } : null,
        disk,
        // Whether the database is encrypted at rest (open-store.ts); null when this server wasn't told.
        encryption: enc,
        startedAt: new Date(now - process.uptime() * 1000).toISOString(),
      },
    };
  }

  /**
   * Everyone's own account (docs/accounts-design.md, section 3): registering (with an invitation, or as this server
   * allows), signing in, signing in a device with email and password, and the account page's own routes.
   */
  function accountRoute(req: IncomingMessage, method: string, p: string, body: unknown): [number, unknown] {
    const b = isObj(body) ? body : {};
    const meOut = (personId: string) => {
      const x = store.person(personId)!;
      return {
        me: { id: x.id, name: x.name, email: x.email, role: x.role },
        devices: store.listDevices().filter((d) => !d.revokedAt && d.personId === x.id).map(({ id, name, client, lastSeenAt, createdAt }) => ({ id, name, client, lastSeenAt, createdAt })),
      };
    };
    const signInDevice = (personId: string) => {
      const ua = String(req.headers['user-agent'] ?? '');
      const client = b.client === 'mac' ? 'mac' : /iPhone|iPad|Android|Mobile/i.test(ua) ? 'phone' : 'web';
      const name = typeof b.deviceName === 'string' && b.deviceName.trim() ? b.deviceName.trim().slice(0, 60) : describeDevice(ua, b.standalone === true);
      const { device, key } = store.addDevice(name, client, personId);
      return { key, device: { id: device.id, name: device.name } };
    };
    if (method === 'GET' && p === '/account/config') return [200, { registration: store.registration(), name: company?.get().company.name || null, email: canEmail() }];
    if (method === 'POST' && p === '/account/forgot') {
      // The same answer whether the email has an account or not, so nobody can find out who's here. The email goes
      // out in the background, so the time to answer doesn't tell either. Limits: 5 requests per address in 15
      // minutes (answered as such), and at most 3 emails per account an hour (silently).
      const address = clientAddress(req);
      if (!allow(`forgot:${address}`, 5, 15 * 60_000)) throw new HttpError(429, 'too_many', 'Too many requests. Try again in 15 minutes.');
      const email = validEmail(b.email);
      if (!canEmail()) throw new HttpError(503, 'no_email', 'This server can’t send email yet. Ask its admin for help.');
      const person = store.personByEmail(email);
      if (person && person.status === 'active' && allow(`forgot-mail:${person.id}`, 3, 3_600_000))
        sendReset(req, person.id).catch((err) => console.error(`Password reset email to ${email} failed: ${(err as Error).message}`));
      return [202, { sent: true, minutes: RESET_MINUTES }];
    }
    if (method === 'POST' && p === '/account/reset/check') {
      // Opening the link: whose it is, before a new password is chosen (the token stays usable).
      const person = typeof b.token === 'string' && b.token.length <= 100 ? store.resetFor(b.token) : undefined;
      if (!person || person.status !== 'active') throw new HttpError(404, 'invalid_reset', 'This link is wrong, used or expired. Ask for a new one.');
      return [200, { email: person.email }];
    }
    if (method === 'POST' && p === '/account/reset') {
      const password = validPassword(b.password); // checked first, so a too-short password doesn't use the link up
      const person = typeof b.token === 'string' && b.token.length <= 100 ? store.useReset(b.token) : undefined;
      if (!person || person.status !== 'active') throw new HttpError(404, 'invalid_reset', 'This link is wrong, used or expired. Ask for a new one.');
      store.setPassword(person.id, password);
      // Other devices stay signed in unless the person asks to sign them out (e.g. the password may have leaked).
      if (b.signOutOthers === true) signOutEverywhere(person.id);
      loginFails.delete(clientAddress(req));
      company?.save(company.get(), `${person.email} reset their password${b.signOutOthers === true ? ' and signed out everywhere' : ''}`);
      return [200, { token: newSession(person.id), ...meOut(person.id) }];
    }
    const inv = p.match(/^\/account\/invite\/([A-Za-z0-9-]{4,20})$/);
    if (method === 'GET' && inv) {
      const person = store.inviteFor(inv[1]);
      if (!person || person.status !== 'invited') throw new HttpError(404, 'invalid_invite', 'This invitation is wrong, used or expired. Ask for a new one.');
      return [200, { email: person.email, name: person.name }];
    }
    if (method === 'POST' && p === '/account/register') {
      loginGuard(clientAddress(req));
      const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : '';
      if (!name) throw bad('Enter your name');
      const password = validPassword(b.password);
      const invite = typeof b.invite === 'string' && b.invite.trim() ? b.invite.trim() : '';
      let person;
      if (invite) {
        const invited = store.inviteFor(invite);
        if (!invited || invited.status !== 'invited') throw new HttpError(404, 'invalid_invite', 'This invitation is wrong, used or expired. Ask for a new one.');
        // The invitation says who it's for; the email comes from it (it's the proof of the address).
        const email = invited.email ?? validEmail(b.email);
        store.updatePerson(invited.id, { name, email, status: 'active' });
        store.useInvite(invite);
        person = store.person(invited.id)!;
      } else {
        const mode = store.registration();
        if (mode === 'invite') throw new HttpError(403, 'invite_only', 'This server only takes invited people. Ask its admin for an invitation.');
        const email = validEmail(b.email);
        if (store.personByEmail(email)) throw new HttpError(409, 'exists', 'There’s already an account with this email. Sign in instead.');
        person = store.addPerson({ email, name, status: mode === 'open' ? 'active' : 'pending' });
      }
      store.setPassword(person.id, password);
      company?.save(company.get(), `${person.email} signed up`);
      if (person.status === 'pending') return [202, { pending: true }];
      // Signing up from the Mac or the phone signs that device in at once; from the browser, a session.
      return [201, b.device === true ? signInDevice(person.id) : { token: newSession(person.id), ...meOut(person.id) }];
    }
    if (method === 'POST' && p === '/account/login') {
      const person = checkLogin(req, b.email, b.password);
      return [201, { token: newSession(person.id), ...meOut(person.id) }];
    }
    if (method === 'POST' && p === '/account/device') {
      // The Mac or the phone signs in with email and password and gets its own device key.
      const person = checkLogin(req, b.email, b.password);
      return [201, signInDevice(person.id)];
    }
    if (method === 'POST' && p === '/account/session') {
      // A one-time link from a signed-in device ("Manage account" on the Mac).
      const code = typeof b.code === 'string' && b.code.length <= 20 ? b.code : '';
      const purpose = code ? store.redeemAdminCode(code) : undefined;
      const personId = purpose?.startsWith('account:') ? purpose.slice(8) : undefined;
      if (!personId || store.person(personId)?.status !== 'active') throw new HttpError(401, 'invalid_code', 'This link is wrong, was used already, or has expired');
      return [201, { token: newSession(personId), ...meOut(personId) }];
    }
    const me = sessionPerson(req);
    if (!me) throw new HttpError(401, 'unauthorized', 'Sign in again');
    if (method === 'GET' && p === '/account/me') return [200, meOut(me.id)];
    if (method === 'PATCH' && p === '/account/me') {
      const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : undefined;
      let email: string | undefined;
      if (b.email !== undefined) {
        email = validEmail(b.email);
        // Until the server can send a confirmation (email server, step 3), changing it needs the password.
        if (email !== me.email && !(typeof b.password === 'string' && store.checkPassword(me.id, b.password))) throw new HttpError(403, 'password_needed', 'Enter your password to change your email');
        const other = store.personByEmail(email);
        if (other && other.id !== me.id) throw bad('Another account already has this email');
      }
      store.updatePerson(me.id, { name, email });
      return [200, meOut(me.id)];
    }
    if (method === 'POST' && p === '/account/password') {
      if (store.hasPassword(me.id) && !(typeof b.current === 'string' && store.checkPassword(me.id, b.current))) throw new HttpError(403, 'wrong_password', 'Your current password isn’t right');
      store.setPassword(me.id, validPassword(b.password));
      return [200, meOut(me.id)];
    }
    const dev = p.match(/^\/account\/devices\/([\w-]{1,64})$/);
    if (method === 'DELETE' && dev) {
      const d = store.listDevices().find((x) => x.id === dev[1] && x.personId === me.id && !x.revokedAt);
      if (!d) throw new HttpError(404, 'not_found', 'No such device');
      store.revokeDevice(d.id);
      return [200, meOut(me.id)];
    }
    if (method === 'DELETE' && p === '/account/session') {
      sessions.delete(bearer(req));
      return [200, { signedOut: true }];
    }
    if (method === 'POST' && p === '/account/signout-everywhere') {
      signOutEverywhere(me.id);
      return [200, { signedOut: true }];
    }
    throw new HttpError(404, 'not_found', 'Unknown account route');
  }

  async function adminRoute(req: IncomingMessage, method: string, p: string, body: unknown): Promise<[number, unknown]> {
    if (!company) throw new HttpError(404, 'not_found', 'Company setup isn’t available on this server');
    // Before signing in: whether any admin can sign in with a password, and whether the owner still has no email.
    const admins = store.listPeople().filter((x) => x.role === 'admin' && x.status === 'active');
    if (method === 'GET' && p === '/admin/status') return [200, { passwordSet: admins.some((x) => store.hasPassword(x.id)), emailless: !store.person(store.ownerId)!.email }];
    if (method === 'POST' && p === '/admin/login') {
      const person = checkLogin(req, isObj(body) ? body.email : undefined, isObj(body) ? body.password : undefined, true);
      if (person.role !== 'admin') throw new HttpError(403, 'not_admin', 'This account isn’t an admin. Your own account is at /account.');
      return [201, { token: newSession(person.id), ...adminState(person.id) }];
    }
    if (method === 'POST' && p === '/admin/session') {
      if (Date.now() < adminLockedUntil) throw new HttpError(429, 'too_many_attempts', 'Too many wrong codes. Try again in 15 minutes.');
      const code = isObj(body) && typeof body.code === 'string' && body.code.length <= 20 ? body.code : '';
      const purpose = code ? store.redeemAdminCode(code) : undefined;
      // Codes from the log or the command line are the owner's; links from a device name their person.
      const personId = purpose === 'setup' || purpose === 'admin' ? store.ownerId : purpose?.startsWith('admin:') ? purpose.slice(6) : undefined;
      if (!purpose || !personId || store.person(personId)?.role !== 'admin' || (purpose === 'setup' && company.get().setupDone)) {
        if (++adminFailures >= PAIR_MAX_FAILURES) {
          adminFailures = 0;
          adminLockedUntil = Date.now() + PAIR_LOCK_MS;
          store.clearAdminCodes();
        }
        throw new HttpError(401, 'invalid_code', 'This link is wrong, was used already, or has expired');
      }
      adminFailures = 0;
      return [201, { token: newSession(personId), ...adminState(personId) }];
    }
    const me = sessionPerson(req);
    if (!me) throw new HttpError(401, 'unauthorized', 'Sign in again');
    if (me.role !== 'admin') throw new HttpError(403, 'not_admin', 'Only admins can use this page.');
    if (method === 'DELETE' && p === '/admin/session') {
      sessions.delete(bearer(req));
      return [200, { signedOut: true }];
    }
    if (method === 'POST' && p === '/admin/password') {
      // Your own password; being signed in is the proof (a link from the Mac or the log works if it's forgotten).
      const password = isObj(body) && typeof body.password === 'string' ? body.password : '';
      if (password.length < 10 || password.length > 200) throw bad('The password needs at least 10 characters');
      store.setPassword(me.id, password);
      company.save(company.get(), `${me.name} changed their password`);
      return [200, adminState(me.id)];
    }

    if (method === 'POST' && p === '/admin/account') {
      // The setup page's first step: the admin's own sign-in (name, email, password) in one go.
      const b = isObj(body) ? body : {};
      const email = validEmail(b.email);
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
      const password = typeof b.password === 'string' ? b.password : '';
      if (!name) throw bad('Enter your name');
      if (password.length < 10 || password.length > 200) throw bad('The password needs at least 10 characters');
      if (store.listPeople().some((x) => x.email === email && x.id !== me.id)) throw bad('Another person already has this email');
      store.updatePerson(me.id, { email, name });
      store.setPassword(me.id, password);
      company.save(company.get(), `${name} set up their admin account`);
      return [200, adminState(me.id)];
    }

    const c = company.get();
    if (method === 'GET' && p === '/admin/state') return [200, adminState(me.id)];
    if (method === 'GET' && p === '/admin/overview') return [200, await adminOverview(me.id)];
    if (method === 'POST' && p === '/admin/check-address') {
      const url = isObj(body) && typeof body.url === 'string' ? body.url.trim().replace(/\/+$/, '') : '';
      const nonce = randomBytes(12).toString('base64url');
      checkNonces.add(nonce);
      try {
        return [200, await checkAddress(url, nonce)];
      } finally {
        checkNonces.delete(nonce);
      }
    }
    if (method === 'GET' && p === '/admin/mac-app') {
      // What /latest hands out now, asking GitHub if that's the source (cached for an hour).
      const r = await currentRelease({ releasesDir, uploadDir: macAppDir, source: c.macApp.source });
      return [200, { from: r.from, release: r.release && { version: r.release.version, date: r.release.date ?? null, size: r.release.size, file: r.release.file } }];
    }
    // Encryption at rest (data-key.ts): whether the data is encrypted, where the key comes from, unencrypted copies left.
    if (method === 'GET' && p === '/admin/encryption') return [200, encryption ? encryption() : { encrypted: false, keySource: null, plainCopies: [] }];
    // Backups (backups.ts): the nightly schedule, the password (only its public key is kept), and making one now.
    if (p === '/admin/backups' || p.startsWith('/admin/backups/')) {
      if (!backups) throw new HttpError(404, 'not_found', 'Backups aren’t available on this server');
      const b = isObj(body) ? body : {};
      try {
        if (method === 'GET' && p === '/admin/backups') return [200, backups.status()];
        if (method === 'PUT' && p === '/admin/backups') {
          const s = backups.saveSettings(b);
          company.save(c, `Backups: ${s.enabled ? `nightly at ${s.hour}:00, keeping ${s.keep}` : 'off'}`);
          return [200, backups.status()];
        }
        if (method === 'POST' && p === '/admin/backups/password') {
          backups.setPassword(typeof b.password === 'string' ? b.password : '', typeof b.current === 'string' ? b.current : undefined);
          company.save(c, `${me.name} set the backup password`);
          return [200, backups.status()];
        }
        if (method === 'POST' && p === '/admin/backups/run') {
          await backups.run('manual');
          company.save(c, `${me.name} made a backup`);
          return [200, backups.status()];
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw bad((e as Error).message);
      }
    }
    if (method === 'PUT' && p === '/admin/config') {
      if (!isObj(body)) throw bad('Send the settings as an object');
      try {
        company.save(applyConfigUpdate(c, body), `Changed ${Object.keys(body).join(', ')}`);
      } catch (err) {
        throw bad((err as Error).message);
      }
      return [200, adminState(me.id)];
    }
    if (method === 'POST' && p === '/admin/float') {
      const token = isObj(body) && typeof body.token === 'string' ? body.token.trim() : '';
      if (!token || token.length > 500) throw bad('Paste the Float API token');
      const r = await testFloat(token);
      if (!r.ok) throw new HttpError(422, 'test_failed', r.error);
      company.setSecret('float', token);
      company.save({ ...c, float: { tested: new Date().toISOString(), people: r.people } }, 'Connected Float');
      return [200, adminState(me.id)];
    }
    if (method === 'POST' && p === '/admin/personio') {
      const id = isObj(body) && typeof body.clientId === 'string' ? body.clientId.trim() : '';
      const secret = isObj(body) && typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
      if (!id || !secret || id.length > 300 || secret.length > 500) throw bad('Enter the client ID and secret');
      const r = await testPersonio(id, secret);
      if (!r.ok) throw new HttpError(422, 'test_failed', r.error);
      company.setSecret('personio', JSON.stringify({ clientId: id, clientSecret: secret }));
      // Full-day absence types become days off by default; hourly ones stay manual.
      const dayOffTypes = c.personio.dayOffTypes ?? r.absenceTypes.filter((t) => t.unit !== 'HOUR').map((t) => t.id);
      company.save({ ...c, personio: { tested: new Date().toISOString(), people: r.people, absenceTypes: r.absenceTypes, dayOffTypes } }, 'Connected Personio');
      return [200, { ...adminState(me.id), morePeople: r.morePeople }];
    }
    const which = p.match(/^\/admin\/(float|personio)$/)?.[1] as 'float' | 'personio' | undefined;
    if (method === 'DELETE' && which) {
      company.setSecret(which, null);
      company.save({ ...c, [which]: {} }, `Disconnected ${which === 'float' ? 'Float' : 'Personio'}`);
      return [200, adminState(me.id)];
    }
    // Email (Settings → Email): SMTP or Microsoft 365. The password or client secret is stored encrypted and never
    // sent back; leaving it empty keeps the stored one.
    if (method === 'PUT' && p === '/admin/email') {
      if (!isObj(body)) throw bad('Send the email settings as an object');
      let parsed;
      try {
        parsed = parseEmailSettings(body);
      } catch (err) {
        throw bad((err as Error).message);
      }
      const before = c.email;
      const sameAccount = before && before.provider === parsed.config.provider && (before.provider === 'graph' ? before.clientId === (parsed.config as typeof before).clientId : before.user === (parsed.config as { user: string }).user);
      const needsSecret = parsed.config.provider === 'graph' || parsed.config.user;
      if (parsed.secret) company.setSecret('email', parsed.secret);
      else if (!sameAccount) {
        if (needsSecret) throw bad(parsed.config.provider === 'graph' ? 'Paste the client secret' : 'Enter the password');
        company.setSecret('email', null);
      }
      company.save({ ...c, email: parsed.config }, `Set up email (${parsed.config.provider === 'graph' ? 'Microsoft 365' : 'SMTP'})`);
      return [200, adminState(me.id)];
    }
    if (method === 'POST' && p === '/admin/email/test') {
      const send = transport();
      if (!send) throw bad('Set up email first');
      const to = isObj(body) && typeof body.to === 'string' && body.to.trim() ? validEmail(body.to) : me.email;
      if (!to) throw bad('Enter an address to send the test to');
      try {
        await send(testEmail({ lang: langFor(req), to, server: serverName() }));
      } catch (err) {
        throw new HttpError(422, 'test_failed', err instanceof MailError ? err.message : `Sending failed: ${(err as Error).message}`);
      }
      if (c.email) company.save({ ...c, email: { ...c.email, tested: new Date().toISOString() } }, `Sent a test email to ${to}`);
      return [200, { ...adminState(me.id), sentTo: to }];
    }
    if (method === 'DELETE' && p === '/admin/email') {
      company.setSecret('email', null);
      company.save({ ...c, email: undefined }, 'Turned off email');
      return [200, adminState(me.id)];
    }
    if (method === 'GET' && p === '/admin/profile') {
      if (!c.company.publicUrl) throw bad('Enter the server’s address first');
      company.save(c, 'Downloaded the settings profile');
      return [200, { filename: 'Gnomon.mobileconfig', profile: mobileconfig(c) }];
    }
    if (method === 'POST' && p === '/admin/invite') {
      // Until company sign-in exists, people connect with a personal one-time link (a pairing code, 7 days).
      const name = isObj(body) && typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : 'Mac';
      const code = store.createPairCode(name, 7 * 24 * 60);
      const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
      company.save(c, `Invited ${name}`);
      return [201, { name, code: formatted, link: c.company.publicUrl ? `${c.company.publicUrl}/#pair=${formatted}` : null, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() }];
    }
    // Devices: who is connected, renaming, disconnecting, the right to open this page, and adding a phone by QR code.
    if (method === 'GET' && p === '/admin/devices') return [200, { devices: store.listDevices().filter((d) => !d.revokedAt) }];
    const dev = p.match(/^\/admin\/devices\/([\w-]{1,64})$/)?.[1];
    if (method === 'PATCH' && dev) {
      const name = isObj(body) && typeof body.name === 'string' ? body.name.trim().slice(0, 60) : undefined;
      if (!name) throw bad('A device needs a name');
      const d = store.updateDevice(dev, { name });
      if (!d) throw new HttpError(404, 'not_found', 'No such device');
      company.save(c, `Renamed a device to ${name}`);
      return [200, { devices: store.listDevices().filter((x) => !x.revokedAt) }];
    }
    if (method === 'DELETE' && dev) {
      const d = store.revokeDevice(dev);
      if (!d) throw new HttpError(404, 'not_found', 'No such device');
      company.save(c, `Disconnected ${d.name}`);
      return [200, { devices: store.listDevices().filter((x) => !x.revokedAt) }];
    }
    if (method === 'PATCH' && p === '/admin/me') {
      // The owner from before people existed has no email yet: asked once, then it's their sign-in.
      const email = validEmail(isObj(body) ? body.email : undefined);
      const name = isObj(body) && typeof body.name === 'string' ? body.name.trim().slice(0, 80) : undefined;
      if (store.listPeople().some((x) => x.email === email && x.id !== me.id)) throw bad('Another person already has this email');
      store.updatePerson(me.id, { email, ...(name && { name }) });
      company.save(c, `${name || me.name} set their email`);
      return [200, adminState(me.id)];
    }
    // People: everyone with an account, their devices, invitations, approvals, roles; who may register.
    const peopleList = () => {
      const devices = store.listDevices().filter((d) => !d.revokedAt);
      return store.listPeople().map((x) => ({ ...x, owner: x.id === store.ownerId, hasPassword: store.hasPassword(x.id), inviteExpiresAt: x.status === 'invited' ? store.inviteExpiresAt(x.id) : null, devices: devices.filter((d) => d.personId === x.id).map(({ id, name, client, lastSeenAt, createdAt }) => ({ id, name, client, lastSeenAt, createdAt })) }));
    };
    // Invitations: emailed when email is set up, otherwise (or when sending fails) a link to pass on by hand. The
    // link's address is the server's own, or the one the admin is using.
    const inviteDeps = (): InviteDeps => ({
      store,
      transport: canEmail() ? transport() : undefined,
      baseUrl: publicBase() || `https://${String(req.headers.host ?? 'localhost')}`,
      server: serverName(),
      inviter: me.name,
      lang: langFor(req),
    });
    const peopleOut = () => ({ people: peopleList(), registration: store.registration(), inviteDays: store.inviteDays(), email: canEmail() });
    if (method === 'GET' && p === '/admin/people') return [200, peopleOut()];
    if (method === 'POST' && p === '/admin/people') {
      const email = validEmail(isObj(body) ? body.email : undefined);
      const name = isObj(body) && typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined;
      const role = isObj(body) && body.role === 'admin' ? 'admin' : 'member';
      if (store.personByEmail(email)) throw bad('There’s already an account with this email');
      const [invite] = await invitePeople(inviteDeps(), [{ email, name, role }]);
      company.save(c, `Invited ${email}${invite.sent ? ' by email' : ''}`);
      return [201, { ...peopleOut(), invite }];
    }
    // Inviting from a list: a preview first (nothing changes), then the new people in batches, by email or as links.
    if (method === 'POST' && p === '/admin/people/import/preview') {
      const text = isObj(body) && typeof body.text === 'string' ? body.text : '';
      const rows = parsePeopleList(text);
      if (!rows.length) throw bad('The list is empty');
      if (rows.length > MAX_IMPORT) throw bad(`A list can have up to ${MAX_IMPORT} people`);
      return [200, { ...previewImport(store, rows), email: canEmail(), inviteDays: store.inviteDays() }];
    }
    if (method === 'POST' && p === '/admin/people/import') {
      const list = isObj(body) && Array.isArray(body.people) ? body.people : [];
      if (!list.length || list.length > MAX_BATCH) throw bad(`Send 1 to ${MAX_BATCH} people at a time`);
      const byEmail = isObj(body) && body.by === 'email';
      if (byEmail && !canEmail()) throw bad('Set up email first (Settings → Email)');
      const people = list.map((x) => ({ email: isObj(x) && typeof x.email === 'string' ? x.email : '', name: isObj(x) && typeof x.name === 'string' ? x.name : undefined }));
      const results = await importPeople({ ...inviteDeps(), transport: byEmail ? transport() : undefined }, people, isObj(body) && body.again === true);
      const done = results.filter((r) => r.expiresAt).length;
      if (done) company.save(c, `Invited ${done} ${done === 1 ? 'person' : 'people'} from a list${byEmail ? ' by email' : ''}`);
      return [200, { results }];
    }
    const pid = p.match(/^\/admin\/people\/([\w-]{36})(\/invite|\/reset)?$/);
    if (pid) {
      const target = store.person(pid[1]);
      if (!target) throw new HttpError(404, 'not_found', 'No such person');
      const otherAdmins = store.listPeople().filter((x) => x.role === 'admin' && x.status === 'active' && x.id !== target.id).length;
      if (method === 'POST' && pid[2] === '/invite') {
        if (target.status !== 'invited') throw bad('This person has already signed up');
        const invite = await sendInvitation(inviteDeps(), target);
        company.save(c, `Invited ${target.email} again${invite.sent ? ' by email' : ''}`);
        return [201, { ...peopleOut(), invite }];
      }
      if (method === 'POST' && pid[2] === '/reset') {
        // A reset link goes to the person's own email, never to the admin: admins don't get into anyone's account.
        if (!canEmail()) throw bad('Set up email first (Settings → Email)');
        if (target.status !== 'active' || !target.email) throw bad('Only active accounts with an email can reset their password');
        try {
          await sendReset(req, target.id);
        } catch (err) {
          throw new HttpError(422, 'send_failed', err instanceof MailError ? err.message : `Sending failed: ${(err as Error).message}`);
        }
        company.save(c, `Sent ${target.email} a password reset link`);
        return [200, { ...peopleOut(), resetSentTo: target.email }];
      }
      if (method === 'PATCH' && !pid[2]) {
        const role = isObj(body) && (body.role === 'admin' || body.role === 'member') ? body.role : undefined;
        const status = isObj(body) && (body.status === 'active' || body.status === 'disabled') ? body.status : undefined;
        const name = isObj(body) && typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : undefined;
        if ((role === 'member' || status === 'disabled') && target.role === 'admin' && otherAdmins === 0) throw bad('At least one admin must stay');
        if (status === 'active' && target.status === 'invited') throw bad('An invited person becomes active when they sign up');
        store.updatePerson(target.id, { role, status, name });
        if (status === 'disabled') signOutEverywhere(target.id);
        company.save(c, `${status === 'disabled' ? 'Disabled' : status === 'active' ? (target.status === 'pending' ? 'Approved' : 'Enabled') : 'Changed'} ${target.email ?? target.name}`);
        return [200, peopleOut()];
      }
      if (method === 'DELETE' && !pid[2]) {
        if (target.id === me.id) throw bad('You can’t remove yourself');
        if (target.id === store.ownerId) throw bad('The server’s first account stays');
        signOutEverywhere(target.id);
        store.removePerson(target.id);
        company.save(c, `Removed ${target.email ?? target.name} and their data`);
        return [200, peopleOut()];
      }
    }
    if (method === 'PUT' && p === '/admin/registration') {
      // Who may register, and how many days an invitation is valid.
      const mode = isObj(body) ? body.mode : undefined;
      const days = isObj(body) ? body.inviteDays : undefined;
      if (mode !== undefined && mode !== 'invite' && mode !== 'approval' && mode !== 'open') throw bad('mode must be invite, approval or open');
      if (days !== undefined && !(typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= 90)) throw bad('An invitation is valid for 1 to 90 days');
      if (mode) store.setRegistration(mode);
      if (days !== undefined) store.setInviteDays(days);
      company.save(c, [mode && `Registration: ${mode}`, days !== undefined && `Invitations valid for ${days} days`].filter(Boolean).join(', '));
      return [200, peopleOut()];
    }
    // Roadmap: suggestions to approve, comments to remove, the export (roadmap.ts).
    const rmAdmin = roadmap.adminRoute(method, p, body);
    if (rmAdmin) return rmAdmin;
    // Feedback inbox: conversations, reading one marks it seen, replies, status, deleting.
    if (method === 'GET' && p === '/admin/feedback') return [200, { threads: store.listFeedback() }];
    const fid = p.match(/^\/admin\/feedback\/([\w-]{36})(\/reply)?$/);
    if (fid) {
      const thread = store.feedbackThread(fid[1]);
      if (!thread) throw new HttpError(404, 'not_found', 'No such conversation');
      if (method === 'GET' && !fid[2]) {
        store.markFeedbackSeen(fid[1]);
        return [200, store.feedbackThread(fid[1])];
      }
      if (method === 'POST' && fid[2]) {
        const text = isObj(body) && typeof body.text === 'string' ? body.text.trim() : '';
        if (!text || text.length > 5000) throw bad('Write between 1 and 5000 characters');
        store.addFeedbackMessage(fid[1], 'admin', text);
        return [200, store.feedbackThread(fid[1])];
      }
      if (method === 'PATCH' && !fid[2]) {
        const status = isObj(body) ? body.status : undefined;
        if (status !== 'new' && status !== 'open' && status !== 'done') throw bad('status must be new, open or done');
        store.setFeedbackStatus(fid[1], status);
        return [200, store.feedbackThread(fid[1])];
      }
      if (method === 'DELETE' && !fid[2]) {
        store.deleteFeedback(fid[1]);
        return [200, { threads: store.listFeedback() }];
      }
    }
    if (method === 'POST' && p === '/admin/devices/cleanup') {
      // Old pairings nobody uses: not seen for 30 days, or never used and older than a day. Admins stay.
      const cutoff = Date.now() - 30 * 86_400_000;
      const old = store.listDevices().filter((d) => !d.revokedAt && !d.admin && (d.lastSeenAt ? Date.parse(d.lastSeenAt) < cutoff : Date.parse(d.createdAt) < Date.now() - 86_400_000));
      for (const d of old) store.revokeDevice(d.id);
      if (old.length) company.save(c, `Removed ${old.length} unused device${old.length === 1 ? '' : 's'}`);
      return [200, { removed: old.length, devices: store.listDevices().filter((x) => !x.revokedAt) }];
    }
    if (method === 'POST' && p === '/admin/pair') {
      // A code for a new device, for 10 minutes; the page shows it as a QR code with the server's address.
      const name = isObj(body) && typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
      const code = store.createPairCode(name, 10);
      const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
      company.save(c, `Created a pairing code for ${name}`);
      return [201, { name: name || null, code: formatted, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }];
    }
    if (method === 'POST' && p === '/admin/finish') {
      store.clearAdminCodes('setup'); // the setup link from the log stops working
      company.save({ ...c, setupDone: true }, 'Finished the setup');
      return [200, adminState(me.id)];
    }
    throw new HttpError(404, 'not_found', 'Unknown admin route');
  }

  /**
   * The Admin page's files, which aren't JSON: downloading a backup (still encrypted), and uploading the Mac app
   * (a .dmg of up to 1 GB, streamed to the data folder).
   */
  async function adminFiles(req: IncomingMessage, res: ServerResponse, method: string, p: string, url: URL): Promise<boolean> {
    const name = p.match(/^\/admin\/backups\/files\/([\w.-]{1,80})$/)?.[1];
    const upload = p === '/admin/mac-app' && method === 'PUT';
    if (!(name && method === 'GET') && !upload) return false;
    const me = sessionPerson(req);
    if (!me) throw new HttpError(401, 'unauthorized', 'Sign in again');
    if (me.role !== 'admin') throw new HttpError(403, 'not_admin', 'Only admins can use this page.');
    if (name) {
      const file = backups?.file(name);
      if (!file) throw new HttpError(404, 'not_found', 'No such backup');
      const size = fs.statSync(file).size;
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
      return true;
    }
    if (!macAppDir || !company) throw new HttpError(404, 'not_found', 'Uploads aren’t available on this server');
    const version = (url.searchParams.get('version') ?? '').trim();
    if (!/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(version)) throw bad('Give the version, like 1.2.3');
    const length = Number(req.headers['content-length'] ?? 0);
    if (length > 1024 * MB) throw new HttpError(413, 'too_large', 'The file can be at most 1 GB');
    fs.mkdirSync(macAppDir, { recursive: true, mode: 0o700 });
    const tmp = path.join(macAppDir, '.upload.dmg');
    await new Promise<void>((resolve, reject) => {
      let size = 0;
      const out = fs.createWriteStream(tmp, { mode: 0o600 });
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 1024 * MB) {
          req.destroy();
          out.destroy();
          reject(new HttpError(413, 'too_large', 'The file can be at most 1 GB'));
        }
      });
      req.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      req.on('error', reject);
    });
    if (!looksLikeDmg(tmp)) {
      fs.rmSync(tmp, { force: true });
      throw bad('That isn’t a .dmg disk image');
    }
    const file = `Gnomon-${version}.dmg`;
    for (const f of fs.readdirSync(macAppDir)) if (/\.dmg$/i.test(f) && !f.startsWith('.')) fs.rmSync(path.join(macAppDir, f), { force: true });
    fs.renameSync(tmp, path.join(macAppDir, file));
    fs.writeFileSync(path.join(macAppDir, 'version.json'), JSON.stringify({ version, date: new Date().toISOString().slice(0, 10), notes: [], file }, null, 2));
    const c = company.get();
    company.save({ ...c, macApp: { source: 'upload' } }, `${me.name} uploaded the Mac app ${version}`);
    send(res, 200, adminState(me.id));
    return true;
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
    const p = url.pathname.slice('/api/v1'.length) || '/';
    const method = req.method ?? 'GET';
    if (company && p.startsWith('/admin/') && (await adminFiles(req, res, method, p, url))) return;
    let body: unknown;
    if (method !== 'GET' && method !== 'DELETE' && method !== 'HEAD') {
      const raw = await readBody(req, p === '/sync' ? 20 * MB : MB);
      if (raw.length) {
        if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json');
        try {
          body = JSON.parse(raw);
        } catch {
          throw new HttpError(400, 'invalid_json', 'The body is not valid JSON');
        }
      }
    }

    // Pairing is the one route without a key: the phone trades a one-time code for its own key.
    // Feedback from the app (src/views/About.tsx): no sign-in needed, so a Mac that isn't connected can write too.
    // Limits against spam: per address 5 new conversations an hour, 200 a day for the whole server, 5000 characters.
    const fb = p.match(/^\/feedback(?:\/([\w-]{36}))?$/);
    if (fb) {
      const text = isObj(body) && typeof body.text === 'string' ? body.text.trim() : '';
      const opt = (k: string, max: number) => (isObj(body) && typeof body[k] === 'string' && body[k] ? String(body[k]).trim().slice(0, max) : undefined);
      if (!fb[1] && method === 'POST') {
        if (!text || text.length > 5000) throw bad('Write between 1 and 5000 characters');
        if (!feedbackAllowed(clientAddress(req))) throw new HttpError(429, 'too_many', 'Too much feedback at once. Please try again in an hour.');
        const t = store.createFeedback(text, { sender: opt('sender', 80), appVersion: opt('appVersion', 40), os: opt('os', 80) });
        return send(res, 201, { id: t.id, secret: t.secret });
      }
      const id = fb[1];
      const secret = String(req.headers['x-feedback-secret'] ?? '');
      if (!id || !store.feedbackSecretOk(id, secret)) throw new HttpError(404, 'not_found', 'No such conversation');
      if (method === 'GET') {
        const t = store.feedbackThread(id)!;
        return send(res, 200, { id, status: t.status, messages: t.messages });
      }
      if (method === 'POST') {
        if (!text || text.length > 5000) throw bad('Write between 1 and 5000 characters');
        if (!feedbackAllowed(clientAddress(req), false)) throw new HttpError(429, 'too_many', 'Too many messages at once. Please try again in an hour.');
        store.addFeedbackMessage(id, 'user', text);
        const t = store.feedbackThread(id)!;
        return send(res, 201, { id, status: t.status, messages: t.messages });
      }
      throw new HttpError(405, 'method_not_allowed', 'GET or POST');
    }

    if (method === 'POST' && p === '/pair') {
      if (Date.now() < pairLockedUntil) throw new HttpError(429, 'too_many_attempts', 'Too many wrong codes. Create a new code and try again in 15 minutes.');
      const code = isObj(body) && typeof body.code === 'string' ? body.code : '';
      // What connected, for the device list in the Admin page: the Mac says so; a phone's browser shows it in its user agent.
      const ua = String(req.headers['user-agent'] ?? '');
      const client = isObj(body) && body.client === 'mac' ? 'mac' : /iPhone|iPad|Android|Mobile/i.test(ua) ? 'phone' : 'web';
      // The name: what the inviter typed, unless that says nothing ("iPhone"); then the device's own: the Mac sends its
      // name from macOS, a phone is described from its browser.
      const own = isObj(body) && typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : describeDevice(ua, isObj(body) && body.standalone === true);
      const paired = code.length <= 20 ? store.redeemPairCode(code, client, (given) => (GENERIC_NAMES.has(given.trim().toLowerCase()) ? own : given)) : undefined;
      if (!paired) {
        if (++pairFailures >= PAIR_MAX_FAILURES) {
          pairFailures = 0;
          pairLockedUntil = Date.now() + PAIR_LOCK_MS;
          store.clearPairCodes();
        }
        throw new HttpError(401, 'invalid_code', 'This code is wrong or has expired');
      }
      pairFailures = 0;
      return send(res, 201, { key: paired.key, device: { id: paired.device.id, name: paired.device.name } });
    }

    // The setup wizard and Admin page have their own sign-in (a one-time admin code, then a short session).
    if (p === '/admin' || p.startsWith('/admin/')) return send(res, ...(await adminRoute(req, method, p, body)));
    if (p.startsWith('/account/')) return send(res, ...accountRoute(req, method, p, body));
    if (p.startsWith('/web/')) return webRoute(req, res, method, p, body);

    // Devices send their key; the web app's session cookie works for the same routes, with the CSRF checks (web.ts).
    const auth = String(req.headers.authorization ?? '');
    const device = auth.startsWith('Bearer ') ? store.authenticate(auth.slice(7).trim()) : webDevice(req);
    if (!device) throw new HttpError(401, 'unauthorized', 'Missing or wrong API key');

    const query = Object.fromEntries(url.searchParams);
    const own = serverRoute(method, p, query, body, device);
    const r = own ?? scoped(device.personId).api(method, p, query, body);
    if (r.status === 200 && p === '/health') (r.body as Record<string, unknown>).server = true;
    send(res, r.status, r.body);
  }

  // ---- The web app's sessions (web.ts) ---------------------------------------------------------------------

  /** The web session's device, when the request has the cookie, the CSRF token and comes from this server. */
  function webDevice(req: IncomingMessage): Device | undefined {
    const key = sessionCookie(req);
    if (!key) return undefined;
    if (!sameOrigin(req) || !csrfOk(req, key)) throw new HttpError(403, 'csrf', 'This request didn’t come from the Gnomon web app. Reload the page.');
    const device = store.authenticate(key);
    return device?.client === 'web' ? device : undefined;
  }

  function webRoute(req: IncomingMessage, res: ServerResponse, method: string, p: string, body: unknown) {
    if (!sameOrigin(req)) throw new HttpError(403, 'csrf', 'This request didn’t come from the Gnomon web app.');
    const out = (key: string, personId: string, deviceId: string) => {
      const x = store.person(personId)!;
      return { csrf: csrfFor(key), me: { name: x.name, email: x.email, role: x.role }, device: deviceId };
    };
    if (method === 'POST' && p === '/web/login') {
      const b = isObj(body) ? body : {};
      const person = checkLogin(req, b.email, b.password);
      const { device, key } = store.addDevice(webDeviceName(String(req.headers['user-agent'] ?? '')), 'web', person.id);
      return send(res, 201, out(key, person.id, device.id), { 'Set-Cookie': setSessionCookie(key) });
    }
    const key = sessionCookie(req);
    const device = key ? store.authenticate(key) : undefined;
    if (!device || device.client !== 'web') return send(res, 401, { error: 'unauthorized', message: 'Sign in again' }, key ? { 'Set-Cookie': clearSessionCookie() } : {});
    // Loading the app: who's signed in and the CSRF token; the cookie starts its 30 days over.
    if (method === 'GET' && p === '/web/session') return send(res, 200, out(key, device.personId, device.id), { 'Set-Cookie': setSessionCookie(key) });
    if (!csrfOk(req, key)) throw new HttpError(403, 'csrf', 'This request didn’t come from the Gnomon web app. Reload the page.');
    if (method === 'POST' && p === '/web/logout') {
      store.revokeDevice(device.id);
      return send(res, 200, { signedOut: true }, { 'Set-Cookie': clearSessionCookie() });
    }
    throw new HttpError(404, 'not_found', 'Unknown web route');
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!webDir || (req.method !== 'GET' && req.method !== 'HEAD')) return send(res, 404, { error: 'not_found', message: 'Not found' });
    let rel = decodeURIComponent(url.pathname);
    // The setup wizard and Admin page are their own small app; everything else is the phone app (no server routes).
    if (company && /^\/(setup|admin)\/?$/.test(rel)) rel = '/admin.html';
    else if (/^\/account(\/register|\/forgot|\/reset)?\/?$/.test(rel)) rel = '/account.html';
    else if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.resolve(webDir, `.${rel}`);
    if (!file.startsWith(path.resolve(webDir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not_found', message: 'Not found' });
    let content = fs.readFileSync(file);
    // iOS gives a home-screen app its own storage, so a paired Safari tab hands over a fresh one-time code:
    // the app's first launch opens /#pair=CODE and connects by itself (see web/main.tsx).
    const handover = rel === '/manifest.webmanifest' ? url.searchParams.get('pair') : null;
    if (handover && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(handover)) content = Buffer.from(JSON.stringify({ ...JSON.parse(content.toString('utf8')), start_url: `/#pair=${handover}` }));
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Security-Policy': CSP,
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Content-Length': content.length,
      // Revalidate everything; the service worker keeps the app usable while the network is slow.
      'Cache-Control': 'no-cache',
      ...(rel === '/sw.js' && { 'Service-Worker-Allowed': '/' }),
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  }

  /**
   * A public folder of static files under a path prefix: the web demo (/example: the Mac app's interface, /example/phone
   * the phone app, both on made-up data that lives only in the visitor's browser) and the one-page site (/about).
   * Folders are served as their index.html; a folder without its slash is redirected, so relative paths resolve.
   */
  function serveFolder(req: IncomingMessage, res: ServerResponse, url: URL, prefix: string, dir: string | undefined, headers: Record<string, string>) {
    if (!dir || (req.method !== 'GET' && req.method !== 'HEAD')) return send(res, 404, { error: 'not_found', message: 'Not found' });
    const rel = decodeURIComponent(url.pathname).slice(prefix.length) || '/';
    const root = path.resolve(dir);
    let file = path.resolve(root, `.${rel}`);
    if (file !== root && !file.startsWith(root + path.sep)) return send(res, 404, { error: 'not_found', message: 'Not found' });
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        res.writeHead(301, { ...SECURITY_HEADERS, Location: `${url.pathname}/` });
        return res.end();
      }
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not_found', message: 'Not found' });
    const content = fs.readFileSync(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      ...headers,
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  }

  /** The Mac app download: /latest (page), /latest/version.json (update check), /latest/download (.dmg). Public. */
  async function serveRelease(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method_not_allowed', message: 'GET only' });
    const { release, dir } = await currentRelease({ releasesDir, uploadDir: macAppDir, source: company?.get().macApp.source ?? 'github' });
    const p = url.pathname.replace(/\/$/, '');
    if (p === '/latest/version.json') {
      if (!release) return send(res, 404, { error: 'not_found', message: 'No release published' });
      res.setHeader('Cache-Control', 'no-cache');
      return send(res, 200, { version: release.version, date: release.date, notes: release.notes, download: '/latest/download', page: '/latest' });
    }
    if (p === '/latest/download') {
      if (!release) return send(res, 404, { error: 'not_found', message: 'No release published' });
      if (release.url) {
        // The official release: straight from GitHub.
        res.writeHead(302, { ...SECURITY_HEADERS, Location: release.url, 'Cache-Control': 'no-cache' });
        return res.end();
      }
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/x-apple-diskimage',
        'Content-Length': release.size,
        'Content-Disposition': `attachment; filename="${release.file}"`,
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(path.join(dir!, release.file)).pipe(res);
    }
    if (p !== '/latest') return send(res, 404, { error: 'not_found', message: 'Not found' });
    const html = releasePage(release, pickLang(req.headers['accept-language']));
    res.writeHead(release ? 200 : 404, { ...SECURITY_HEADERS, 'Content-Security-Policy': CSP, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : html);
  }

  return async function handler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/healthz') return send(res, 200, { ok: true });
      const check = url.pathname.match(/^\/\.well-known\/gnomon-check\/([\w-]{8,40})$/)?.[1];
      if (check) return checkNonces.has(check) ? send(res, 200, { gnomon: check }) : send(res, 404, { error: 'not_found', message: 'Not found' });
      if (url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/')) return await handleApi(req, res, url);
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not_found', message: 'Use /api/v1/…' });
      if (url.pathname === '/latest' || url.pathname.startsWith('/latest/')) return await serveRelease(req, res, url);
      if (url.pathname === '/example' || url.pathname.startsWith('/example/'))
        return serveFolder(req, res, url, '/example', demoDir, { 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': DEMO_CSP });
      if (url.pathname === '/about' || url.pathname.startsWith('/about/')) return serveFolder(req, res, url, '/about', siteDir, { 'Content-Security-Policy': SITE_CSP });
      // The web app: the Mac app's interface, built into web/app/ (scripts/build.mjs), signed in with a cookie (web.ts).
      if (url.pathname === '/app' || url.pathname.startsWith('/app/')) return serveFolder(req, res, url, '/app', webDir && path.join(webDir, 'app'), { 'Content-Security-Policy': APP_CSP });
      // The roadmap page links its stylesheet absolutely, so /roadmap is served as it is, without the redirect.
      if (url.pathname === '/roadmap' || url.pathname.startsWith('/roadmap/'))
        return serveFolder(req, res, url.pathname === '/roadmap' ? new URL('/roadmap/', url) : url, '/roadmap', roadmapDir, { 'Content-Security-Policy': SITE_CSP });
      return serveStatic(req, res, url);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.code, message: err.message });
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'internal', message: 'Something went wrong on the server' });
    }
  };
}
