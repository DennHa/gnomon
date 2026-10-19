// End-to-end tests against a real HTTP server with a temporary SQLite file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app';
import { databaseFile, Store } from '../src/store';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-test-'));
const dbFile = path.join(dir, 'gnomon.db');
const webDir = path.join(dir, 'web');
fs.mkdirSync(webDir);
fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Gnomon</title>');
fs.writeFileSync(path.join(dir, 'secret.txt'), 'nope');

let store: Store;
let server: http.Server;
let base = '';
let key = '';

async function start() {
  store = new Store(dbFile);
  server = http.createServer(createApp({ store, webDir }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function stop() {
  await new Promise((r) => server.close(r));
  store.close();
}

async function req(method: string, p: string, body?: unknown, k: string | null = key, headers: Record<string, string> = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { ...(k && { Authorization: `Bearer ${k}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
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
const api = (method: string, p: string, body?: unknown, k?: string | null) => req(method, `/api/v1${p}`, body, k === undefined ? key : k);

before(start);
after(async () => {
  await stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('auth and pairing', () => {
  test('requests without a valid key are rejected', async () => {
    assert.equal((await api('GET', '/health', undefined, null)).status, 401);
    assert.equal((await api('GET', '/projects', undefined, 'gnomon_wrong')).status, 401);
  });

  test('a pairing code works once and yields a device key', async () => {
    const code = store.createPairCode('Test phone');
    const r = await api('POST', '/pair', { code: `${code.slice(0, 4)}-${code.slice(4).toLowerCase()}` }, null);
    assert.equal(r.status, 201);
    assert.match(r.body.key, /^gnomon_/);
    assert.equal(r.body.device.name, 'Test phone');
    key = r.body.key;
    assert.equal((await api('POST', '/pair', { code }, null)).status, 401, 'second use fails');
    const health = await api('GET', '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.server, true);
    assert.equal((await api('GET', '/me')).body.name, 'Test phone');
  });

  test('a signed-in device can create a pairing code for another one', async () => {
    assert.equal((await api('POST', '/pair-codes', { name: 'iPad' }, null)).status, 401);
    const r = await api('POST', '/pair-codes', { name: 'iPad' });
    assert.equal(r.status, 201);
    assert.match(r.body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const paired = await api('POST', '/pair', { code: r.body.code }, null);
    assert.equal(paired.status, 201);
    assert.equal(paired.body.device.name, 'iPad');
  });

  test('pairing codes for the home-screen hand-over last up to 60 minutes, and the manifest carries them', async () => {
    const r = await api('POST', '/pair-codes', { name: 'Home screen', minutes: 500 });
    const minutes = Math.round((Date.parse(r.body.expiresAt) - Date.now()) / 60_000);
    assert.equal(minutes, 60);
    fs.writeFileSync(path.join(webDir, 'manifest.webmanifest'), JSON.stringify({ name: 'Gnomon', start_url: '/' }));
    const m = await req('GET', `/manifest.webmanifest?pair=${r.body.code}`, undefined, null);
    assert.equal(JSON.parse(m.body.start_url ? JSON.stringify(m.body) : m.body).start_url, `/#pair=${r.body.code}`);
    const plain = await req('GET', '/manifest.webmanifest?pair=<script>', undefined, null);
    assert.equal(plain.body.start_url, '/');
  });

  test('too many wrong codes drop all open codes and lock pairing', async () => {
    const code = store.createPairCode('Victim');
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await api('POST', '/pair', { code: 'AAAAAAAA' }, null)).status);
    assert.ok(statuses.every((s) => s === 401 || s === 429));
    assert.equal((await api('POST', '/pair', { code }, null)).status, 429, 'locked, even with the right code');
    assert.equal(store.redeemPairCode(code), undefined, 'open codes were dropped');
  });

  test('a revoked key stops working', async () => {
    const { key: other } = store.addDevice('Old laptop');
    assert.equal((await api('GET', '/me', undefined, other)).status, 200);
    assert.equal((await api('DELETE', '/me', undefined, other)).status, 200);
    assert.equal((await api('GET', '/me', undefined, other)).status, 401);
    assert.ok(store.listDevices().find((d) => d.name === 'Old laptop')?.revokedAt);
  });
});

describe('API.md behaviour (shared router)', () => {
  test('errors: 415 without JSON content type, 400 for broken JSON, 404 for unknown routes', async () => {
    assert.equal((await req('POST', '/api/v1/projects', '{"name":"x"}', key, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await req('POST', '/api/v1/projects', '{nope', key)).status, 400);
    assert.equal((await api('GET', '/nothing')).status, 404);
    assert.equal((await api('POST', '/entries', { date: '2026-02-30', minutes: 10 })).status, 422);
  });

  test('projects upsert by externalId', async () => {
    const a = await api('POST', '/projects', { name: 'Client XYZ', externalId: 'crm-42', dailyGoalHours: 4.5 });
    assert.equal(a.status, 201);
    const b = await api('POST', '/projects', { name: 'Client XYZ GmbH', externalId: 'crm-42' });
    assert.equal(b.status, 200);
    assert.equal(b.body.id, a.body.id);
    assert.equal((await api('GET', '/projects/ext:crm-42')).body.name, 'Client XYZ GmbH');
  });

  test('entries: date + minutes, externalId upsert, PATCH, DELETE', async () => {
    const e = await api('POST', '/entries', { date: '2026-10-15', minutes: 90, projectExternalId: 'crm-42', description: 'Workshop', activity: 'Call', externalId: 'time-1' });
    assert.equal(e.status, 201);
    assert.equal(e.body.minutes, 90);
    assert.equal(e.body.activity, 'Call');
    const again = await api('POST', '/entries', { date: '2026-10-15', minutes: 60, projectExternalId: 'crm-42', externalId: 'time-1' });
    assert.equal(again.body.id, e.body.id);
    assert.equal(again.body.minutes, 60);
    assert.equal((await api('GET', '/entries?from=2026-10-15')).body.length, 1);
    const patched = await api('PATCH', '/entries/ext:time-1', { description: 'Workshop with client' });
    assert.equal(patched.body.description, 'Workshop with client');
    assert.equal((await api('DELETE', '/entries/ext:time-1')).status, 200);
    assert.equal((await api('GET', '/entries?from=2026-10-15')).body.length, 0);
  });

  test('timer, attendance, break and activity switching', async () => {
    const started = await api('POST', '/timer/start', { project: 'Phone project', description: 'Mobile', activity: 'Design' });
    assert.equal(started.status, 201);
    assert.equal(started.body.running.project, 'Phone project', 'a new project name creates the project');
    let s = (await api('GET', '/state')).body;
    assert.equal(s.timer.description, 'Mobile');
    assert.ok(s.workday?.in, 'starting a timer clocks you in (startDayWithTimer)');
    const dev = s.activities.find((a: { name: string }) => a.name === 'Development');
    const switched = await api('POST', '/timer/activity', { activityId: dev.id });
    assert.equal(switched.body.running.activity, 'Development');

    s = (await api('POST', '/day/break', {})).body;
    assert.equal(s.onBreak, true);
    assert.equal(s.timer, null, 'a break stops the timer');
    s = (await api('POST', '/day/break', {})).body;
    assert.equal(s.onBreak, false);

    await api('POST', '/timer/start', { description: 'Again' });
    assert.equal((await api('POST', '/timer/stop', {})).body.stopped.description, 'Again');
    const left = await api('POST', '/day/leave', {});
    assert.ok(left.body.out);
    assert.equal((await api('POST', '/day/break', {})).status, 409);
  });

  test('PATCH /workdays corrects in, out and breaks of a day', async () => {
    await api('PUT', '/workdays/2026-10-14', { in: '08:00', out: '16:30', breakMinutes: 30 });
    assert.equal((await api('PATCH', '/workdays/2026-10-13', { in: '08:00' })).status, 404, 'no attendance that day');
    const r = await api('PATCH', '/workdays/2026-10-14', { in: '08:15', breaks: [{ start: '12:00', end: '12:45' }, { start: '15:00', end: '15:15' }] });
    assert.equal(r.status, 200);
    const w = (await api('GET', '/workdays?from=2026-10-14')).body[0];
    assert.equal(w.breakMinutes, 60);
    assert.equal(w.workedMinutes, 8 * 60 + 15 - 60, 'in moved to 08:15, out kept at 16:30, breaks replaced (60 min)');
    assert.equal((await api('PATCH', '/workdays/2026-10-14', { out: '07:00' })).status, 422, 'out before in');
    assert.equal((await api('PATCH', '/workdays/2026-10-14', { out: null })).status, 422, 'only today can stay open');
    assert.equal((await api('PATCH', '/workdays/2026-10-14', { breaks: [{ start: '17:00', end: '17:30' }] })).status, 422, 'break after leaving');
    assert.equal((await api('PATCH', '/workdays/2026-10-14', { in: '8:15' })).status, 422);
  });

  test('a misclicked start of the day can be moved; /state lists the breaks', async () => {
    await api('POST', '/day/start', {});
    const s = (await api('PATCH', `/workdays/${new Date().toLocaleDateString('sv')}`, { in: '00:05' })).body;
    assert.match(s.workday.in, /T/);
    assert.ok(Array.isArray(s.breaks));
  });

  test('server-only: POST /activities upserts by name', async () => {
    const a = await api('POST', '/activities', { name: 'Workshop' });
    assert.equal(a.status, 201);
    assert.equal((await api('POST', '/activities', { name: 'workshop' })).body.id, a.body.id);
    assert.equal((await api('POST', '/activities', { name: 'x', color: 'red' })).status, 422);
  });
});

describe('sync', () => {
  test('pull returns changes after a cursor, including deletions', async () => {
    const all = await api('GET', '/sync?since=0');
    assert.equal(all.status, 200);
    assert.ok(all.body.changes.some((c: { kind: string }) => c.kind === 'activities'));
    const cursor = all.body.cursor;
    assert.equal((await api('GET', `/sync?since=${cursor}`)).body.changes.length, 0);

    const e = await api('POST', '/entries', { date: '2026-10-14', minutes: 30, description: 'Sync me' });
    await api('DELETE', `/entries/${e.body.id}`);
    const delta = (await api('GET', `/sync?since=${cursor}`)).body;
    const mine = delta.changes.filter((c: { id: string }) => c.id === e.body.id);
    assert.equal(mine.length, 1, 'one row per record, the latest state');
    assert.equal(mine[0].deleted, true);
    assert.ok(delta.cursor > cursor);
  });

  test('pull pages with limit and more', async () => {
    const r = (await api('GET', '/sync?since=0&limit=2')).body;
    assert.equal(r.changes.length, 2);
    assert.equal(r.more, true);
  });

  test('push applies newer changes, skips older ones and is idempotent', async () => {
    const id = crypto.randomUUID();
    const t1 = '2026-10-16T08:00:00.000Z';
    const entry = { id, description: 'From the Mac', start: '2026-10-16T07:00:00.000Z', end: '2026-10-16T08:00:00.000Z' };
    const r1 = await api('POST', '/sync', { changes: [{ kind: 'entries', id, updatedAt: t1, data: entry }] });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.applied, 1);
    assert.equal((await api('GET', `/entries/${id}`)).body.description, 'From the Mac');

    // Same batch again: nothing breaks, still one entry.
    await api('POST', '/sync', { changes: [{ kind: 'entries', id, updatedAt: t1, data: entry }] });
    assert.equal((await api('GET', '/entries?from=2026-10-16')).body.filter((e: { id: string }) => e.id === id).length, 1);

    // The phone edits it now; an older edit from the Mac loses.
    await api('PATCH', `/entries/${id}`, { description: 'Edited on the phone' });
    const r2 = await api('POST', '/sync', { changes: [{ kind: 'entries', id, updatedAt: '2026-10-16T09:00:00.000Z', data: { ...entry, description: 'Stale' } }] });
    assert.equal(r2.body.skipped[0].reason, 'server_newer');
    assert.equal((await api('GET', `/entries/${id}`)).body.description, 'Edited on the phone');

    // A newer delete wins.
    const r3 = await api('POST', '/sync', { changes: [{ kind: 'entries', id, updatedAt: new Date().toISOString(), deleted: true }] });
    assert.equal(r3.body.applied, 1);
    assert.equal((await api('GET', `/entries/${id}`)).status, 404);
  });

  test('push validates records', async () => {
    assert.equal((await api('POST', '/sync', { changes: [{ kind: 'entries', id: 'a', updatedAt: '2026-10-16T08:00:00Z', data: { id: 'b', start: 'x' } }] })).status, 422);
    assert.equal((await api('POST', '/sync', { changes: [{ kind: 'plans', id: 'a', updatedAt: '2026-10-16T08:00:00Z', data: {} }] })).status, 422);
    assert.equal((await api('POST', '/sync', { changes: [{ kind: 'projects', id: 'p', updatedAt: '2099-01-01T00:00:00Z', data: { id: 'p', name: 'Future', color: '#000000' } }] })).status, 422);
  });

  test('two running timers after a push: the newest keeps running', async () => {
    await api('POST', '/timer/start', { description: 'Phone timer' });
    const id = crypto.randomUUID();
    const start = new Date(Date.now() + 1000).toISOString();
    await api('POST', '/sync', { changes: [{ kind: 'entries', id, updatedAt: new Date().toISOString(), data: { id, description: 'Mac timer', start } }] });
    const running = (await api('GET', '/timer')).body.running;
    assert.equal(running.description, 'Mac timer');
    const today = (await api('GET', '/entries')).body;
    assert.equal(today.filter((e: { running: boolean }) => e.running).length, 1);
    await api('POST', '/timer/stop', {});
  });
});

describe('persistence and static files', () => {
  test('data survives a restart', async () => {
    const before = (await api('GET', '/projects')).body.length;
    await stop();
    await start();
    assert.equal((await api('GET', '/projects')).body.length, before);
    assert.equal((await api('GET', '/me')).status, 200, 'device keys survive too');
    assert.equal((await api('GET', '/activities')).body.filter((a: { name: string }) => a.name === 'Call').length, 1, 'defaults are seeded only once');
  });

  test('a pre-rename punch.db is taken over with its data', async () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-legacy-'));
    const old = new Store(path.join(legacyDir, 'punch.db'));
    old.commit({ ...old.get(), projects: [{ id: 'p1', name: 'Kept', color: '#03A9F4' }] });
    const { key: oldKey } = old.addDevice('Old phone');
    old.close();
    const file = databaseFile(legacyDir);
    assert.equal(path.basename(file), 'gnomon.db');
    assert.ok(!fs.existsSync(path.join(legacyDir, 'punch.db')));
    const taken = new Store(file);
    assert.equal(taken.get().projects[0]?.name, 'Kept');
    assert.ok(taken.authenticate(oldKey), 'device keys survive the takeover');
    taken.close();
    fs.rmSync(legacyDir, { recursive: true, force: true });
  });

  test('the database file is private', () => {
    assert.equal(fs.statSync(dbFile).mode & 0o077, 0);
  });

  test('serves the app with a strict CSP and no path traversal', async () => {
    const page = await req('GET', '/', undefined, null);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self'/);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal((await req('GET', '/week', undefined, null)).status, 200, 'unknown paths fall back to the app');
    assert.equal((await req('GET', '/..%2fsecret.txt', undefined, null)).status, 404);
    assert.equal((await req('GET', '/healthz', undefined, null)).status, 200);
  });
});

describe('download page (/latest)', () => {
  test('page, version.json and the .dmg come from the releases folder; nothing else is served', async () => {
    const rel = path.join(dir, 'releases');
    fs.mkdirSync(rel, { recursive: true });
    const app = http.createServer(createApp({ store, webDir, releasesDir: rel }));
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    try {
      // Nothing published yet.
      assert.equal((await fetch(`${url}/latest/version.json`)).status, 404);
      assert.match(await (await fetch(`${url}/latest`)).text(), /No version has been published/);

      fs.writeFileSync(path.join(rel, 'Gnomon-9.9.9-arm64.dmg'), Buffer.alloc(1234));
      fs.writeFileSync(path.join(rel, 'version.json'), JSON.stringify({ version: '9.9.9', date: '2026-10-17', notes: ['Faster <b>timers</b>'], file: 'Gnomon-9.9.9-arm64.dmg' }));
      const v = await (await fetch(`${url}/latest/version.json`)).json();
      assert.deepEqual(v, { version: '9.9.9', date: '2026-10-17', notes: ['Faster <b>timers</b>'], download: '/latest/download', page: '/latest' });

      const page = await fetch(`${url}/latest`, { headers: { 'Accept-Language': 'de-DE,de;q=0.9' } });
      const html = await page.text();
      assert.match(html, /Version 9\.9\.9/);
      assert.match(html, /Faster &lt;b&gt;timers&lt;\/b&gt;/, 'notes are escaped');
      assert.match(html, /Rechtsklick/, 'German for a German browser');
      assert.ok(page.headers.get('content-security-policy'));

      const dl = await fetch(`${url}/latest/download`);
      assert.equal(dl.headers.get('content-disposition'), 'attachment; filename="Gnomon-9.9.9-arm64.dmg"');
      assert.equal((await dl.arrayBuffer()).byteLength, 1234);

      // A version.json pointing outside the folder is ignored.
      fs.writeFileSync(path.join(rel, 'version.json'), JSON.stringify({ version: '9.9.9', file: '../secret.txt' }));
      assert.equal((await fetch(`${url}/latest/download`)).status, 404);
      assert.equal((await fetch(`${url}/latest/../secret.txt`)).status, 404);
    } finally {
      await new Promise((r) => app.close(r));
    }
  });
});

describe('static folders (/about, /example)', () => {
  test('served from their own folders, with redirects for the slash, and nothing outside them', async () => {
    const site = path.join(dir, 'site');
    const demo = path.join(dir, 'demo');
    fs.mkdirSync(path.join(site, 'img'), { recursive: true });
    fs.mkdirSync(path.join(demo, 'phone'), { recursive: true });
    fs.writeFileSync(path.join(site, 'index.html'), '<h1>Gnomon site</h1>');
    fs.writeFileSync(path.join(site, 'img', 'a.jpg'), Buffer.alloc(10));
    fs.writeFileSync(path.join(demo, 'index.html'), '<h1>Mac demo</h1>');
    fs.writeFileSync(path.join(demo, 'phone', 'index.html'), '<h1>Phone demo</h1>');
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'nope');
    const app = http.createServer(createApp({ store, webDir, siteDir: site, demoDir: demo }));
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    try {
      const noFollow = { redirect: 'manual' as const };
      assert.equal((await fetch(`${url}/about`, noFollow)).headers.get('location'), '/about/');
      const page = await fetch(`${url}/about/`);
      assert.match(await page.text(), /Gnomon site/);
      assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
      assert.equal((await fetch(`${url}/about/img/a.jpg`)).headers.get('content-type'), 'image/jpeg');
      assert.equal((await fetch(`${url}/example/phone`, noFollow)).headers.get('location'), '/example/phone/');
      assert.match(await (await fetch(`${url}/example/phone/`)).text(), /Phone demo/);
      assert.match(await (await fetch(`${url}/example/`)).text(), /Mac demo/);
      // Encoded dots can't climb out of the folder.
      assert.equal((await fetch(`${url}/about/%2e%2e/secret.txt`)).status, 404);
      assert.equal((await fetch(`${url}/example/%2e%2e/secret.txt`)).status, 404);
      assert.equal((await fetch(`${url}/about/nothing.html`)).status, 404);
    } finally {
      await new Promise((r) => app.close(r));
    }
  });

  test('not served without a folder', async () => {
    const app = http.createServer(createApp({ store, webDir }));
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    try {
      assert.equal((await fetch(`${url}/about/`)).status, 404);
      assert.equal((await fetch(`${url}/example/`)).status, 404);
    } finally {
      await new Promise((r) => app.close(r));
    }
  });
});

describe('company setup (wizard API)', () => {
  test('setup code → session → settings, Float and Personio checks, profile, invitation, finish', async () => {
    const { Company } = await import('../src/company');
    const company = new Company(store, Buffer.alloc(32, 7), 'file');
    // Stand-ins for Float and Personio.
    const mock = http.createServer((req, res) => {
      const auth = String(req.headers.authorization ?? '');
      if (req.url?.startsWith('/people')) {
        if (auth !== 'Bearer good-float') return res.writeHead(401).end();
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Pagination-Total-Count': '42' }).end('[{}]');
      } else if (req.url === '/v2/auth/token') {
        let b = '';
        req.on('data', (c) => (b += c));
        req.on('end', () => (b.includes('client_secret=good') ? res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"access_token":"t"}') : res.writeHead(400).end('{}')));
      } else if (req.url?.startsWith('/v2/persons')) res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"_data":[{},{},{}],"_meta":{}}');
      else if (req.url?.startsWith('/v2/absence-types')) res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"_data":[{"id":"v","name":"Vacation","unit":"DAY"},{"id":"d","name":"Doctor","unit":"HOUR"}]}');
      else res.writeHead(404).end();
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    const mockBase = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
    process.env.FLOAT_API_BASE = mockBase;
    process.env.PERSONIO_API_BASE = mockBase;
    const app = http.createServer(createApp({ store, webDir, company }));
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    let session = '';
    const call = async (method: string, p: string, body?: unknown) => {
      const r = await fetch(`${url}/api/v1/admin${p}`, { method, headers: { ...(session && { Authorization: `Bearer ${session}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as any };
    };
    try {
      assert.equal((await call('GET', '/state')).status, 401, 'no session');
      assert.equal((await call('POST', '/session', { code: 'WRONG-CODE' })).status, 401);
      const code = store.createAdminCode('setup');
      const s = await call('POST', '/session', { code: `${code.slice(0, 4)}-${code.slice(4)}` });
      assert.equal(s.status, 201);
      session = s.body.token;
      assert.equal((await call('POST', '/session', { code })).status, 401, 'a code works once');

      assert.equal((await call('PUT', '/config', { company: { publicUrl: 'http://evil.example' } })).status, 422, 'https only');
      let st = await call('PUT', '/config', { company: { name: 'Acme', publicUrl: 'https://gnomon.example.com/' }, rules: { allowLocalApi: true }, checklist: { https: true } });
      assert.equal(st.body.config.company.publicUrl, 'https://gnomon.example.com');
      assert.equal(st.body.config.rules.allowLocalApi, true);

      assert.equal((await call('POST', '/float', { token: 'bad' })).status, 422);
      st = await call('POST', '/float', { token: 'good-float' });
      assert.equal(st.body.config.float.people, 42);
      assert.equal(st.body.secrets.float, true);
      assert.equal(company.secret('float'), 'good-float', 'stored encrypted, readable with the key');
      assert.ok(!(store.getMeta('secret:float') ?? '').includes('good-float'), 'not in plain text');
      assert.ok(!JSON.stringify(st.body).includes('good-float'), 'never sent back');

      assert.equal((await call('POST', '/personio', { clientId: 'x', clientSecret: 'bad' })).status, 422);
      st = await call('POST', '/personio', { clientId: 'x', clientSecret: 'good' });
      assert.equal(st.body.config.personio.people, 3);
      assert.deepEqual(st.body.config.personio.dayOffTypes, ['v'], 'full-day types by default, hourly ones not');

      const prof = await call('GET', '/profile');
      assert.match(prof.body.profile, /<key>serverUrl<\/key>\s*<string>https:\/\/gnomon\.example\.com<\/string>/);
      assert.match(prof.body.profile, /<key>allowLocalApi<\/key>\s*<true\/>/);
      assert.ok(!prof.body.profile.includes('good'), 'no secrets in the profile');

      const inv = await call('POST', '/invite', { name: 'Sam' });
      assert.match(inv.body.link, /^https:\/\/gnomon\.example\.com\/#pair=[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      assert.equal((await fetch(`${url}/api/v1/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: inv.body.code }) })).status, 201, 'the invitation pairs a device');

      const setupCode = store.createAdminCode('setup');
      st = await call('POST', '/finish');
      assert.equal(st.body.config.setupDone, true);
      session = '';
      assert.equal((await call('POST', '/session', { code: setupCode })).status, 401, 'setup links stop working once finished');
      assert.equal((await call('POST', '/session', { code: store.createAdminCode('admin') })).status, 201, 'admin links still work');
      fs.writeFileSync(path.join(webDir, 'admin.html'), '<!doctype html><title>Gnomon setup</title>');
      assert.match(await (await fetch(`${url}/setup`)).text(), /Gnomon setup/, '/setup serves the wizard page');
      assert.match(await (await fetch(`${url}/`)).text(), /<title>Gnomon<\/title>/, 'everything else stays the phone app');
    } finally {
      await new Promise((r) => app.close(r));
      await new Promise((r) => mock.close(r));
      delete process.env.FLOAT_API_BASE;
      delete process.env.PERSONIO_API_BASE;
    }
  });
});
