// The web app (/app): sign-in with a session cookie, CSRF protection, one person never seeing another's data, and
// the account settings every device shares.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app';
import { Store } from '../src/store';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-web-test-'));
const webDir = path.join(dir, 'web');
fs.mkdirSync(path.join(webDir, 'app'), { recursive: true });
fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Phone</title>');
fs.writeFileSync(path.join(webDir, 'app', 'index.html'), '<!doctype html><title>Gnomon</title><script type="module" src="app.js"></script>');
fs.writeFileSync(path.join(webDir, 'app', 'app.js'), 'export {};');
fs.writeFileSync(path.join(dir, 'secret.txt'), 'nope');

const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
let store: Store;
let server: http.Server;
let base = '';
let ann = '';
let ben = '';

before(async () => {
  store = new Store(path.join(dir, 'gnomon.db'));
  ann = store.addPerson({ email: 'ann@example.com', name: 'Ann', status: 'active' }).id;
  ben = store.addPerson({ email: 'ben@example.com', name: 'Ben', status: 'active' }).id;
  store.setPassword(ann, 'ann password 1');
  store.setPassword(ben, 'ben password 1');
  server = http.createServer(createApp({ store, webDir }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

type Session = { cookie: string; csrf: string; device: string };

async function req(method: string, p: string, opts: { body?: unknown; session?: Partial<Session>; headers?: Record<string, string> } = {}) {
  const { body, session, headers = {} } = opts;
  const res = await fetch(base + p, {
    method,
    redirect: 'manual',
    headers: {
      'User-Agent': SAFARI,
      ...(session?.cookie && { Cookie: session.cookie }),
      ...(session?.csrf && { 'X-Gnomon-CSRF': session.csrf }),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}

async function signIn(email: string, password: string): Promise<Session> {
  const r = await req('POST', '/api/v1/web/login', { body: { email, password }, headers: { Origin: base } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  return { cookie, csrf: r.body.csrf, device: r.body.device };
}

describe('web app sessions', () => {
  test('signing in sets a strict session cookie and makes a web device for the person', async () => {
    const r = await req('POST', '/api/v1/web/login', { body: { email: 'Ann@Example.com', password: 'ann password 1' } });
    assert.equal(r.status, 201);
    const set = r.headers.get('set-cookie')!;
    assert.match(set, /^__Host-gnomon_session=gnomon_[\w-]+;/);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(set.includes(attr), `cookie has ${attr}`);
    assert.doesNotMatch(set, /Domain=/i, 'scoped to this host only');
    assert.ok(r.body.csrf.length >= 40);
    assert.equal(r.body.me.email, 'ann@example.com');
    assert.equal(JSON.stringify(r.body).includes('gnomon_'), false, 'the key is only in the cookie, never in the body');
    const device = store.listDevices().find((d) => d.id === r.body.device)!;
    assert.equal(device.client, 'web');
    assert.equal(device.name, 'Browser · Safari');
    assert.equal(device.personId, ann);
  });

  test('a wrong password gets no cookie', async () => {
    const r = await req('POST', '/api/v1/web/login', { body: { email: 'ann@example.com', password: 'not it at all' } });
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('set-cookie'), null);
  });

  test('loading the app returns who is signed in and the CSRF token, and renews the cookie', async () => {
    const s = await signIn('ann@example.com', 'ann password 1');
    const r = await req('GET', '/api/v1/web/session', { session: { cookie: s.cookie } });
    assert.equal(r.status, 200);
    assert.equal(r.body.csrf, s.csrf);
    assert.equal(r.body.me.name, 'Ann');
    assert.match(r.headers.get('set-cookie')!, /Max-Age=2592000/);
    const none = await req('GET', '/api/v1/web/session');
    assert.equal(none.status, 401);
    const wrong = await req('GET', '/api/v1/web/session', { session: { cookie: '__Host-gnomon_session=gnomon_madeup' } });
    assert.equal(wrong.status, 401);
    assert.match(wrong.headers.get('set-cookie')!, /Max-Age=0/, 'a stale cookie is cleared');
  });

  test('requests with the cookie need the CSRF token and must come from this server', async () => {
    const s = await signIn('ann@example.com', 'ann password 1');
    assert.equal((await req('GET', '/api/v1/entries', { session: s })).status, 200);
    assert.equal((await req('GET', '/api/v1/entries', { session: { cookie: s.cookie } })).status, 403, 'no token');
    assert.equal((await req('POST', '/api/v1/timer/start', { session: { cookie: s.cookie }, body: { description: 'x' } })).status, 403, 'no token on a write');
    assert.equal((await req('POST', '/api/v1/timer/start', { session: { cookie: s.cookie, csrf: 'x'.repeat(43) }, body: { description: 'x' } })).status, 403, 'wrong token');
    const other = await signIn('ben@example.com', 'ben password 1');
    assert.equal((await req('GET', '/api/v1/entries', { session: { cookie: s.cookie, csrf: other.csrf } })).status, 403, 'another session’s token');
    assert.equal((await req('POST', '/api/v1/timer/start', { session: s, body: { description: 'x' }, headers: { Origin: 'https://evil.example' } })).status, 403, 'another origin');
    assert.equal((await req('POST', '/api/v1/timer/start', { session: s, body: { description: 'x' }, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403, 'a cross-site request');
    assert.equal((await req('POST', '/api/v1/web/login', { body: { email: 'ann@example.com', password: 'ann password 1' }, headers: { Origin: 'https://evil.example' } })).status, 403, 'signing in from another site');
    const ok = await req('POST', '/api/v1/timer/start', { session: s, body: { description: 'From the browser' }, headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    await req('POST', '/api/v1/timer/stop', { session: s, body: {} });
  });

  test('only web devices work with the cookie; device keys keep working with Bearer', async () => {
    const { key } = store.addDevice('Phone', 'phone', ann);
    const csrf = (await import('../src/web')).csrfFor(key);
    assert.equal((await req('GET', '/api/v1/entries', { session: { cookie: `__Host-gnomon_session=${key}`, csrf } })).status, 401);
    assert.equal((await req('GET', '/api/v1/entries', { headers: { Authorization: `Bearer ${key}` } })).status, 200);
  });

  test('signing out ends the session; so does "Sign out everywhere" on the account page', async () => {
    const s = await signIn('ann@example.com', 'ann password 1');
    assert.equal((await req('POST', '/api/v1/web/logout', { session: { cookie: s.cookie } })).status, 403, 'signing out needs the token too');
    const out = await req('POST', '/api/v1/web/logout', { session: s });
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie')!, /Max-Age=0/);
    assert.equal((await req('GET', '/api/v1/entries', { session: s })).status, 401);

    const s2 = await signIn('ann@example.com', 'ann password 1');
    const acct = await req('POST', '/api/v1/account/login', { body: { email: 'ann@example.com', password: 'ann password 1' } });
    const listed = await req('GET', '/api/v1/account/me', { headers: { Authorization: `Bearer ${acct.body.token}` } });
    assert.ok(listed.body.devices.some((d: { id: string; client: string }) => d.id === s2.device && d.client === 'web'), 'listed on the account page');
    await req('POST', '/api/v1/account/signout-everywhere', { headers: { Authorization: `Bearer ${acct.body.token}` } });
    assert.equal((await req('GET', '/api/v1/web/session', { session: { cookie: s2.cookie } })).status, 401);
  });

  test('a disabled person’s web session stops working', async () => {
    const cleo = store.addPerson({ email: 'cleo@example.com', name: 'Cleo', status: 'active' }).id;
    store.setPassword(cleo, 'cleo password 1');
    const s = await signIn('cleo@example.com', 'cleo password 1');
    store.updatePerson(cleo, { status: 'disabled' });
    assert.equal((await req('GET', '/api/v1/entries', { session: s })).status, 401);
  });
});

describe('web app isolation', () => {
  test('one person never sees or changes another’s data through the web app', async () => {
    const a = await signIn('ann@example.com', 'ann password 1');
    const b = await signIn('ben@example.com', 'ben password 1');
    const made = await req('POST', '/api/v1/entries', { session: a, body: { description: 'Ann’s secret', start: '2026-10-20T08:00:00.000Z', end: '2026-10-20T09:00:00.000Z' } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = made.body.id;
    await req('POST', '/api/v1/sync', { session: a, body: { changes: [], account: { values: { userName: 'Ann A.', dailyTargetHours: 6 }, updatedAt: new Date().toISOString() } } });

    const bEntries = await req('GET', '/api/v1/entries?from=2026-01-01&to=2026-12-31', { session: b });
    assert.equal(bEntries.status, 200);
    assert.equal(JSON.stringify(bEntries.body).includes('Ann’s secret'), false);
    const bSync = await req('GET', '/api/v1/sync?since=0', { session: b });
    assert.equal(JSON.stringify(bSync.body).includes('Ann'), false, 'neither records nor account settings');
    assert.equal(bSync.body.account, null);
    assert.equal((await req('GET', `/api/v1/entries/${id}`, { session: b })).status, 404);
    assert.equal((await req('PATCH', `/api/v1/entries/${id}`, { session: b, body: { description: 'mine now' } })).status, 404);
    assert.equal((await req('DELETE', `/api/v1/entries/${id}`, { session: b })).status, 404);
    // Pushing a record with the same id lands in Ben's own data, not Ann's.
    await req('POST', '/api/v1/sync', { session: b, body: { changes: [{ kind: 'entries', id, updatedAt: new Date().toISOString(), deleted: true, data: null }] } });
    const aSync = await req('GET', '/api/v1/sync?since=0', { session: a });
    assert.ok(aSync.body.changes.some((c: { id: string; deleted: boolean; data: { description?: string } }) => c.id === id && !c.deleted && c.data.description === 'Ann’s secret'));
    assert.equal(aSync.body.account.values.userName, 'Ann A.');
    // Ben's devices are Ben's: the device list and revoking go by the session's person.
    const devices = await req('GET', '/api/v1/me/devices', { session: b });
    assert.ok(devices.body.every((d: { id: string }) => store.listDevices().find((x) => x.id === d.id)?.personId === ben));
  });
});

describe('account settings', () => {
  test('pushed account settings are kept, shared with every device, and older ones lose', async () => {
    const mac = store.addDevice('Mac', 'mac', ben);
    const auth = { Authorization: `Bearer ${mac.key}` };
    const t1 = new Date(Date.now() - 60_000).toISOString();
    const t0 = new Date(Date.now() - 120_000).toISOString();
    const r = await req('POST', '/api/v1/sync', { headers: auth, body: { changes: [], account: { values: { dailyTargetHours: 7, language: 'de', reviewedWeeks: ['2026-10-12'], menuBarLabel: 'time', floatPersonId: 3 }, updatedAt: t1 } } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.account, { values: { language: 'de', dailyTargetHours: 7, reviewedWeeks: ['2026-10-12'] }, updatedAt: t1 }, 'device settings are not taken');
    // The phone and the API use the same targets.
    assert.equal(store.get(ben).settings.dailyTargetHours, 7);
    const old = await req('POST', '/api/v1/sync', { headers: auth, body: { changes: [], account: { values: { dailyTargetHours: 4 }, updatedAt: t0 } } });
    assert.equal(old.body.account.values.dailyTargetHours, 7);
    const b = await signIn('ben@example.com', 'ben password 1');
    const pulled = await req('GET', '/api/v1/sync?since=0', { session: b });
    assert.equal(pulled.body.account.values.dailyTargetHours, 7);
    assert.equal((await req('POST', '/api/v1/sync', { headers: auth, body: { changes: [], account: { values: { reviewedWeeks: ['last week'] }, updatedAt: t1 } } })).status, 422);
    assert.equal((await req('POST', '/api/v1/sync', { headers: auth, body: { changes: [], account: 'nope' } })).status, 422);
  });
});

describe('serving the web app', () => {
  test('/app is served with a strict Content-Security-Policy', async () => {
    const redirect = await req('GET', '/app');
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), '/app/');
    const page = await req('GET', '/app/');
    assert.equal(page.status, 200);
    assert.match(page.body, /<title>Gnomon<\/title>/);
    const csp = page.headers.get('content-security-policy')!;
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /style-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal((await req('GET', '/app/%2e%2e/%2e%2e/secret.txt')).status, 404, 'nothing outside the folder');
    assert.equal((await req('GET', '/app/app.js')).status, 200);
  });
});
