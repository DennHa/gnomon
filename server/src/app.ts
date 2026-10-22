// HTTP handling: auth, body parsing, the API (the Mac app's own router from src/api.ts plus a few server-only
// routes for the phone and for syncing), and the static web app.
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { handleApiRequest, type ApiRequest, type ApiResponse } from '../../src/api';
import { phoneApi } from '../../src/phone';
import type { Data, Entry } from '../../src/types';
import { KINDS, keyOf, type Device, type Kind, type Store } from './store';
import { pickLang, readRelease, releasePage } from './releases';
import { applyConfigUpdate, mobileconfig, testFloat, testPersonio, type Company } from './company';
import { randomBytes } from 'node:crypto';

const MB = 1024 * 1024;
const PAIR_MAX_FAILURES = 10;
const PAIR_LOCK_MS = 15 * 60_000;

/** releasesDir: optional folder with version.json and the .dmg for /latest (see releases.ts). */
/** company: the setup wizard's settings and secrets (company.ts); without it, /setup and /admin aren't served. */
/** demoDir: optional folder with the web demo (npm run build:demo in the repo root), served at /example. */
/** siteDir: optional folder with the one-page site (site/ in the repo), served at /about. */
export type AppOptions = { store: Store; webDir?: string; releasesDir?: string; company?: Company; demoDir?: string; siteDir?: string };

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
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(json) });
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

export function createApp({ store, webDir, releasesDir, company, demoDir, siteDir }: AppOptions) {
  let pairFailures = 0;
  let pairLockedUntil = 0;

  const ctx = { get: () => store.get(), commit: (d: Data) => void store.commit(d) };
  /** Run the shared router (src/api.ts), e.g. to serialise an object exactly like API.md describes. */
  const api = (method: string, p: string, query: Record<string, string> = {}, body: unknown = undefined): ApiResponse => handleApiRequest(ctx, { method, path: p, query, body } satisfies ApiRequest);
  const phone = phoneApi(ctx, () => ({ cursor: store.cursor() }));

  // ---- Server-only routes -------------------------------------------------------------------

  function pull(query: Record<string, string>) {
    const since = Number(query.since ?? '0');
    if (!Number.isInteger(since) || since < 0) throw bad('since must be a cursor (a whole number) from an earlier response');
    const limit = Math.min(Number(query.limit ?? '5000') || 5000, 5000);
    const changes = store.changesSince(since, limit + 1);
    const more = changes.length > limit;
    const page = changes.slice(0, limit);
    return { cursor: page.length ? page[page.length - 1].seq : Math.max(since, 0), more, changes: page.map(({ seq: _seq, ...c }) => c) };
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
  function push(body: unknown) {
    if (!isObj(body) || !Array.isArray(body.changes)) throw bad('Send { "changes": [ { kind, id, updatedAt, deleted, data } ] }');
    if (body.changes.length > 20_000) throw bad('At most 20000 changes per request');
    const d = store.get();
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
      const current = stamps.get(`${kind}:${id}`) ?? store.updatedAt(kind, id);
      if (current && current > updatedAt) return void skipped.push({ kind, id, reason: 'server_newer' });
      if (c.deleted) lists[kind].delete(id);
      else lists[kind].set(id, c.data);
      stamps.set(`${kind}:${id}`, updatedAt);
      applied++;
    });
    let next = { ...d, ...Object.fromEntries(KINDS.map((k) => [k, [...lists[k].values()]])) } as Data;
    next = oneRunningTimer(next, stamps);
    store.commit(next, (kind, id) => stamps.get(`${kind}:${id}`) ?? new Date().toISOString());
    return { applied, skipped, cursor: store.cursor() };
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

  function serverRoute(method: string, p: string, query: Record<string, string>, body: unknown, device: Device): ApiResponse | undefined {
    if (method === 'GET' && p === '/me') return { status: 200, body: { id: device.id, name: device.name } };
    if (method === 'DELETE' && p === '/me') {
      store.revokeDevice(device.id);
      return { status: 200, body: { revoked: device.id } };
    }
    if (method === 'POST' && p === '/pair-codes') {
      // A signed-in device (the Mac, or a phone) invites another one, e.g. by showing this code as a QR code.
      const name = isObj(body) && typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : 'Phone';
      // Up to 60 minutes, for handing the connection over to the home-screen app (added a bit later).
      const ttl = isObj(body) && typeof body.minutes === 'number' ? Math.min(60, Math.max(1, Math.round(body.minutes))) : 10;
      const code = store.createPairCode(name, ttl);
      return { status: 201, body: { code: `${code.slice(0, 4)}-${code.slice(4)}`, name, expiresAt: new Date(Date.now() + ttl * 60_000).toISOString() } };
    }
    if (method === 'POST' && p === '/admin-link') {
      // A trusted device (usually the Mac) opens the Admin page without the terminal: a one-time link, 5 minutes.
      const fromMac = isObj(body) && body.client === 'mac';
      if (fromMac) store.setDeviceClient(device.id, 'mac');
      // The first Mac to ask gets the right while nobody has it, on a private server (company setup not finished).
      // A company server's admin hands it out on the page instead.
      const claim = fromMac && !company?.get().setupDone;
      if (!store.isAdminDevice(device.id, claim)) throw new HttpError(403, 'not_admin', 'This device may not open the Admin page. Allow it there first.');
      const code = store.createAdminCode('admin', 5);
      company?.save(company.get(), `Admin page opened from ${device.name}`);
      return { status: 201, body: { path: `/admin#code=${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() } };
    }
    if (method === 'GET' && p === '/sync') return { status: 200, body: pull(query) };
    if (method === 'POST' && p === '/sync') return { status: 200, body: push(body) };
    // The phone's own routes (state, attendance corrections, breaks, activities) are shared with the web demo.
    return phone.route(method, p, body, device);
  }

  // ---- Request entry point ----------------------------------------------------------------------

  // ---- Setup wizard and Admin page (docs/company-setup.md) --------------------------------------
  // Access: a one-time code from the server log (setup) or from `gnomon-admin admin-link`, traded for a session that
  // lives in memory for two hours after the last request. A restart signs the admin out.
  const adminSessions = new Map<string, number>();
  const ADMIN_SESSION_MS = 2 * 3_600_000;
  let adminFailures = 0;
  let adminLockedUntil = 0;

  function adminSession(req: IncomingMessage): boolean {
    const auth = String(req.headers.authorization ?? '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const until = adminSessions.get(token);
    if (!until || until < Date.now()) return false;
    adminSessions.set(token, Date.now() + ADMIN_SESSION_MS);
    return true;
  }

  function adminState() {
    const c = company!.get();
    const release = readRelease(releasesDir);
    return {
      config: { ...c, audit: c.audit.slice(-20).reverse() },
      secrets: { float: company!.hasSecret('float'), personio: company!.hasSecret('personio') },
      keySource: company!.keySource,
      release: release ? { version: release.version, size: release.size } : null,
      devices: store.listDevices().filter((d) => !d.revokedAt).length,
    };
  }

  async function adminRoute(req: IncomingMessage, method: string, p: string, body: unknown): Promise<[number, unknown]> {
    if (!company) throw new HttpError(404, 'not_found', 'Company setup isn’t available on this server');
    if (method === 'POST' && p === '/admin/session') {
      if (Date.now() < adminLockedUntil) throw new HttpError(429, 'too_many_attempts', 'Too many wrong codes. Try again in 15 minutes.');
      const code = isObj(body) && typeof body.code === 'string' && body.code.length <= 20 ? body.code : '';
      const purpose = code ? store.redeemAdminCode(code) : undefined;
      if (!purpose || (purpose === 'setup' && company.get().setupDone)) {
        if (++adminFailures >= PAIR_MAX_FAILURES) {
          adminFailures = 0;
          adminLockedUntil = Date.now() + PAIR_LOCK_MS;
          store.clearAdminCodes();
        }
        throw new HttpError(401, 'invalid_code', 'This link is wrong, was used already, or has expired');
      }
      adminFailures = 0;
      const token = randomBytes(24).toString('base64url');
      adminSessions.set(token, Date.now() + ADMIN_SESSION_MS);
      return [201, { token, ...adminState() }];
    }
    if (!adminSession(req)) throw new HttpError(401, 'unauthorized', 'Open a new setup or admin link');

    const c = company.get();
    if (method === 'GET' && p === '/admin/state') return [200, adminState()];
    if (method === 'PUT' && p === '/admin/config') {
      if (!isObj(body)) throw bad('Send the settings as an object');
      try {
        company.save(applyConfigUpdate(c, body), `Changed ${Object.keys(body).join(', ')}`);
      } catch (err) {
        throw bad((err as Error).message);
      }
      return [200, adminState()];
    }
    if (method === 'POST' && p === '/admin/float') {
      const token = isObj(body) && typeof body.token === 'string' ? body.token.trim() : '';
      if (!token || token.length > 500) throw bad('Paste the Float API token');
      const r = await testFloat(token);
      if (!r.ok) throw new HttpError(422, 'test_failed', r.error);
      company.setSecret('float', token);
      company.save({ ...c, float: { tested: new Date().toISOString(), people: r.people } }, 'Connected Float');
      return [200, adminState()];
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
      return [200, { ...adminState(), morePeople: r.morePeople }];
    }
    const which = p.match(/^\/admin\/(float|personio)$/)?.[1] as 'float' | 'personio' | undefined;
    if (method === 'DELETE' && which) {
      company.setSecret(which, null);
      company.save({ ...c, [which]: {} }, `Disconnected ${which === 'float' ? 'Float' : 'Personio'}`);
      return [200, adminState()];
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
      const admin = isObj(body) && typeof body.admin === 'boolean' ? body.admin : undefined;
      if (name === '') throw bad('A device needs a name');
      if (admin === false && store.listDevices().filter((d) => !d.revokedAt && d.admin && d.id !== dev).length === 0) throw bad('At least one device must be able to open this page');
      const d = store.updateDevice(dev, { name, admin });
      if (!d) throw new HttpError(404, 'not_found', 'No such device');
      company.save(c, name !== undefined ? `Renamed a device to ${name}` : `${admin ? 'Allowed' : 'Stopped'} ${d.name} opening the Admin page`);
      return [200, { devices: store.listDevices().filter((x) => !x.revokedAt) }];
    }
    if (method === 'DELETE' && dev) {
      const d = store.revokeDevice(dev);
      if (!d) throw new HttpError(404, 'not_found', 'No such device');
      company.save(c, `Disconnected ${d.name}`);
      return [200, { devices: store.listDevices().filter((x) => !x.revokedAt) }];
    }
    if (method === 'POST' && p === '/admin/pair') {
      // A code for a new device, for 10 minutes; the page shows it as a QR code with the server's address.
      const name = isObj(body) && typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : 'Phone';
      const code = store.createPairCode(name, 10);
      const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
      company.save(c, `Created a pairing code for ${name}`);
      return [201, { name, code: formatted, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }];
    }
    if (method === 'POST' && p === '/admin/finish') {
      store.clearAdminCodes('setup'); // the setup link from the log stops working
      company.save({ ...c, setupDone: true }, 'Finished the setup');
      return [200, adminState()];
    }
    throw new HttpError(404, 'not_found', 'Unknown admin route');
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
    const p = url.pathname.slice('/api/v1'.length) || '/';
    const method = req.method ?? 'GET';
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
    if (method === 'POST' && p === '/pair') {
      if (Date.now() < pairLockedUntil) throw new HttpError(429, 'too_many_attempts', 'Too many wrong codes. Create a new code and try again in 15 minutes.');
      const code = isObj(body) && typeof body.code === 'string' ? body.code : '';
      // What connected, for the device list in the Admin page: the Mac says so; a phone's browser shows it in its user agent.
      const ua = String(req.headers['user-agent'] ?? '');
      const client = isObj(body) && body.client === 'mac' ? 'mac' : /iPhone|iPad|Android|Mobile/i.test(ua) ? 'phone' : 'web';
      const paired = code.length <= 20 ? store.redeemPairCode(code, client) : undefined;
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

    const auth = String(req.headers.authorization ?? '');
    const device = auth.startsWith('Bearer ') ? store.authenticate(auth.slice(7).trim()) : undefined;
    if (!device) throw new HttpError(401, 'unauthorized', 'Missing or wrong API key');

    const query = Object.fromEntries(url.searchParams);
    const own = serverRoute(method, p, query, body, device);
    const r = own ?? api(method, p, query, body);
    if (r.status === 200 && p === '/health') (r.body as Record<string, unknown>).server = true;
    send(res, r.status, r.body);
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!webDir || (req.method !== 'GET' && req.method !== 'HEAD')) return send(res, 404, { error: 'not_found', message: 'Not found' });
    let rel = decodeURIComponent(url.pathname);
    // The setup wizard and Admin page are their own small app; everything else is the phone app (no server routes).
    if (company && /^\/(setup|admin)\/?$/.test(rel)) rel = '/admin.html';
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
  function serveRelease(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method_not_allowed', message: 'GET only' });
    const release = readRelease(releasesDir);
    const p = url.pathname.replace(/\/$/, '');
    if (p === '/latest/version.json') {
      if (!release) return send(res, 404, { error: 'not_found', message: 'No release published' });
      res.setHeader('Cache-Control', 'no-cache');
      return send(res, 200, { version: release.version, date: release.date, notes: release.notes, download: '/latest/download', page: '/latest' });
    }
    if (p === '/latest/download') {
      if (!release) return send(res, 404, { error: 'not_found', message: 'No release published' });
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/x-apple-diskimage',
        'Content-Length': release.size,
        'Content-Disposition': `attachment; filename="${release.file}"`,
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(path.join(releasesDir!, release.file)).pipe(res);
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
      if (url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/')) return await handleApi(req, res, url);
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not_found', message: 'Use /api/v1/…' });
      if (url.pathname === '/latest' || url.pathname.startsWith('/latest/')) return serveRelease(req, res, url);
      if (url.pathname === '/example' || url.pathname.startsWith('/example/'))
        return serveFolder(req, res, url, '/example', demoDir, { 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': DEMO_CSP });
      if (url.pathname === '/about' || url.pathname.startsWith('/about/')) return serveFolder(req, res, url, '/about', siteDir, { 'Content-Security-Policy': SITE_CSP });
      return serveStatic(req, res, url);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.code, message: err.message });
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'internal', message: 'Something went wrong on the server' });
    }
  };
}
