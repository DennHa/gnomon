// The setup page for admins and backups: encrypting and restoring a backup, the nightly backups in the data folder, and
// the setup steps through the app (admin account, HTTPS check, backups, where the Mac app comes from). Nothing leaves
// this machine: GitHub is a fake server here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { createApp } from '../src/app';
import { backupKeyFor, BackupError, decryptFile, encryptFile, newBackupPassword, passwordMatches, readHeader } from '../src/backup-crypto';
import { Backups, openBackup, restoreBackup } from '../src/backups';
import { Company } from '../src/company';
import { forgetGithubRelease } from '../src/releases';
import { Store } from '../src/store';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-setup-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const PASSWORD = 'correct horse battery';

describe('backup encryption', () => {
  test('a file encrypted for a password’s public key opens with that password and no other', () => {
    const key = backupKeyFor(PASSWORD);
    assert.ok(!JSON.stringify(key).includes(PASSWORD), 'only a public key and a salt are kept');
    const sealed = encryptFile(Buffer.from('hello, backup'), key);
    assert.ok(!sealed.includes(Buffer.from('hello')), 'the content isn’t readable');
    assert.equal(decryptFile(sealed, PASSWORD).payload.toString(), 'hello, backup');
    assert.throws(() => decryptFile(sealed, 'wrong password!!'), (e: unknown) => e instanceof BackupError && e.code === 'wrong_password');
    assert.ok(passwordMatches(PASSWORD, key));
    assert.ok(!passwordMatches('wrong password!!', key));
    assert.equal(readHeader(sealed).kind, 'gnomon-sqlite-gzip');
  });

  test('every backup is encrypted differently, and a changed byte anywhere is noticed', () => {
    const key = backupKeyFor(PASSWORD);
    const a = encryptFile(Buffer.from('same'), key);
    const b = encryptFile(Buffer.from('same'), key);
    assert.notDeepEqual(a, b);
    for (const at of [20, a.length - 20, a.length - 1]) {
      const bad = Buffer.from(a);
      bad[at] ^= 1;
      assert.throws(() => decryptFile(bad, PASSWORD), BackupError, `byte ${at}`);
    }
    assert.throws(() => decryptFile(Buffer.from('SQLite format 3\0 not a backup'), PASSWORD), (e: unknown) => e instanceof BackupError && e.code === 'not_a_backup');
    assert.throws(() => decryptFile(a.subarray(0, 40), PASSWORD), BackupError, 'cut off');
  });

  test('a new password is 6 groups of 4 easy-to-read characters', () => {
    const p = newBackupPassword();
    assert.match(p, /^[a-hjkmnp-z2-9]{4}(-[a-hjkmnp-z2-9]{4}){5}$/);
    assert.notEqual(p, newBackupPassword());
  });
});

describe('backups in the data folder', () => {
  test('backup, keep only the newest, restore the database, and keep the old one next to it', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'data-'));
    const dbFile = path.join(dir, 'gnomon.db');
    const store = new Store(dbFile);
    const backups = new Backups(store, dir);
    await assert.rejects(backups.run(), /No backup password/);
    assert.equal(backups.status().last?.ok, false);
    assert.throws(() => backups.setPassword('short'), /at least 12/);
    backups.setPassword(PASSWORD);
    assert.throws(() => backups.setPassword('another password', 'not the current one'), /current backup password/);

    store.updatePerson(store.ownerId, { name: 'Before the backup', email: 'boss@example.com' });
    const first = await backups.run('nightly');
    assert.match(first.name, /^gnomon-\d{8}-\d{6}-nightly\.gnomonbak$/);
    assert.equal(fs.statSync(path.join(backups.dir, first.name)).mode & 0o777, 0o600);
    assert.equal(fs.readdirSync(backups.dir).filter((f) => f.startsWith('.')).length, 0, 'no temporary files left');
    assert.equal(openBackup(fs.readFileSync(path.join(backups.dir, first.name)), PASSWORD).db.subarray(0, 6).toString(), 'SQLite');

    // Only the newest `keep` stay.
    backups.saveSettings({ keep: 2 });
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 1100)); // names have seconds
      await backups.run();
    }
    assert.equal(backups.list().length, 2);
    assert.ok(!backups.list().some((f) => f.name === first.name));
    const newest = backups.list()[0];

    // A changed password: new backups need it, old ones the old one.
    backups.setPassword('the second password', PASSWORD);
    store.updatePerson(store.ownerId, { name: 'After the backup' });
    store.close();

    assert.throws(() => restoreBackup(dbFile, fs.readFileSync(path.join(backups.dir, newest.name)), 'the second password'), /isn’t the password/);
    const r = restoreBackup(dbFile, fs.readFileSync(path.join(backups.dir, newest.name)), PASSWORD);
    assert.ok(r.kept && fs.existsSync(r.kept));
    const back = new Store(dbFile);
    try {
      assert.equal(back.person(back.ownerId)?.name, 'Before the backup');
    } finally {
      back.close();
    }
    const old = new Store(r.kept!);
    try {
      assert.equal(old.person(old.ownerId)?.name, 'After the backup', 'the replaced database is kept');
    } finally {
      old.close();
    }
  });

  test('settings are checked', () => {
    const store = new Store(':memory:');
    try {
      const b = new Backups(store, path.join(tmp, 'settings'));
      assert.deepEqual(b.settings(), { enabled: true, hour: 2, keep: 14 }, 'on by default');
      assert.throws(() => b.saveSettings({ hour: 24 }));
      assert.throws(() => b.saveSettings({ keep: 0 }));
      assert.deepEqual(b.saveSettings({ enabled: false, hour: 3 }), { enabled: false, hour: 3, keep: 14 });
      assert.equal(b.file('../gnomon.db'), undefined, 'only backups inside the folder');
    } finally {
      store.close();
    }
  });
});

// ---- The setup page, through the app ------------------------------------------------------------------

async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((r) => server.close(r)) };
}

async function freshServer() {
  const dir = fs.mkdtempSync(path.join(tmp, 'server-'));
  const store = new Store(path.join(dir, 'gnomon.db'));
  const company = new Company(store, Buffer.alloc(32, 7), 'env');
  const backups = new Backups(store, dir);
  const macAppDir = path.join(dir, 'releases');
  const webDir = path.join(dir, 'web');
  fs.mkdirSync(webDir);
  const s = await listen(createApp({ store, webDir, company, backups, macAppDir, https: 'proxy' }));
  const go = async (method: string, p: string, body?: unknown, auth?: string, raw?: Buffer) => {
    const r = await fetch(`${s.url}/api/v1${p}`, {
      method,
      headers: { ...(auth && { Authorization: `Bearer ${auth}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(raw && { 'Content-Type': 'application/octet-stream' }) },
      body: raw ? new Uint8Array(raw) : body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: (text.startsWith('{') ? JSON.parse(text) : text) as any, headers: r.headers };
  };
  // The one-time link from the log, traded for a session, as the setup page does.
  const code = store.createAdminCode('setup', 60);
  const token = (await go('POST', '/admin/session', { code })).body.token as string;
  return { dir, store, company, backups, macAppDir, url: s.url, go, token, close: async () => (await s.close(), store.close()) };
}

describe('the setup page', () => {
  test('the admin account is created in one step and then signs in with email and password', async () => {
    const x = await freshServer();
    try {
      const st = (await x.go('GET', '/admin/state', undefined, x.token)).body;
      assert.equal(st.passwordSet, false);
      assert.equal(st.https, 'proxy');
      assert.match(st.version, /^(\d+\.\d+\.\d+|dev)$/);
      assert.equal(st.backups.keySet, false);
      assert.equal((await x.go('POST', '/admin/account', { name: 'Alex', email: 'alex@example.com', password: 'short' }, x.token)).status, 422);
      assert.equal((await x.go('POST', '/admin/account', { name: '', email: 'alex@example.com', password: 'long enough pw' }, x.token)).status, 422);
      const r = await x.go('POST', '/admin/account', { name: 'Alex', email: 'Alex@Example.com', password: 'long enough pw' }, x.token);
      assert.equal(r.status, 200);
      assert.equal(r.body.passwordSet, true);
      assert.deepEqual([r.body.me.name, r.body.me.email], ['Alex', 'alex@example.com']);
      const login = await x.go('POST', '/admin/login', { email: 'alex@example.com', password: 'long enough pw' });
      assert.equal(login.status, 201);
      assert.equal((await x.go('POST', '/admin/account', { name: 'X', email: 'x@example.com', password: 'long enough pw' })).status, 401, 'needs a session');
    } finally {
      await x.close();
    }
  });

  test('the address check finds this server at its own address, and says why when it doesn’t', async () => {
    const x = await freshServer();
    const other = await listen((_req, res) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end('{"gnomon":"someone else"}')));
    try {
      const ok = (await x.go('POST', '/admin/check-address', { url: x.url }, x.token)).body;
      assert.deepEqual([ok.ok, ok.code], [true, 'ok_local'], 'plain http on this machine: fine for a test');
      const elsewhere = (await x.go('POST', '/admin/check-address', { url: other.url }, x.token)).body;
      assert.deepEqual([elsewhere.ok, elsewhere.code], [false, 'other_server']);
      assert.equal((await x.go('POST', '/admin/check-address', { url: 'http://gnomon.example.com' }, x.token)).body.code, 'not_https');
      assert.equal((await x.go('POST', '/admin/check-address', { url: 'not a url' }, x.token)).body.code, 'invalid');
      const closed = await listen(() => {});
      const port = new URL(closed.url).port;
      await closed.close();
      assert.equal((await x.go('POST', '/admin/check-address', { url: `http://127.0.0.1:${port}` }, x.token)).body.code, 'refused');
      // The check's address only answers while a check runs.
      assert.equal((await fetch(`${x.url}/.well-known/gnomon-check/abcdefghijkl`)).status, 404);
    } finally {
      await other.close();
      await x.close();
    }
  });

  test('backups: set the password, back up now, download it (still encrypted), change the password with the current one', async () => {
    const x = await freshServer();
    try {
      assert.equal((await x.go('POST', '/admin/backups/run', undefined, x.token)).status, 422, 'no password yet');
      assert.equal((await x.go('POST', '/admin/backups/password', { password: 'too short' }, x.token)).status, 422);
      let b = (await x.go('POST', '/admin/backups/password', { password: PASSWORD }, x.token)).body;
      assert.equal(b.keySet, true);
      b = (await x.go('POST', '/admin/backups/run', undefined, x.token)).body;
      assert.equal(b.files.length, 1);
      const dl = await fetch(`${x.url}/api/v1/admin/backups/files/${b.files[0].name}`, { headers: { Authorization: `Bearer ${x.token}` } });
      assert.equal(dl.status, 200);
      const file = Buffer.from(await dl.arrayBuffer());
      assert.equal(openBackup(file, PASSWORD).db.subarray(0, 6).toString(), 'SQLite');
      assert.equal((await fetch(`${x.url}/api/v1/admin/backups/files/${b.files[0].name}`)).status, 401, 'only for admins');
      assert.equal((await x.go('GET', '/admin/backups/files/..%2Fgnomon.db', undefined, x.token)).status, 404);
      assert.equal((await x.go('POST', '/admin/backups/password', { password: 'a new backup password', current: 'wrong' }, x.token)).status, 422);
      assert.equal((await x.go('POST', '/admin/backups/password', { password: 'a new backup password', current: PASSWORD }, x.token)).status, 200);
      b = (await x.go('PUT', '/admin/backups', { enabled: false, hour: 4, keep: 7 }, x.token)).body;
      assert.deepEqual([b.enabled, b.hour, b.keep], [false, 4, 7]);
      assert.equal((await x.go('PUT', '/admin/backups', { hour: 25 }, x.token)).status, 422);
    } finally {
      await x.close();
    }
  });

  test('the Mac app: the official GitHub release by default, or an uploaded .dmg', async () => {
    const gh = await listen((req, res) => {
      assert.equal(req.url, '/repos/DennHa/gnomon/releases/latest');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          tag_name: 'v1.2.3',
          published_at: '2026-10-20T10:00:00Z',
          body: '## What’s new\n- Faster **timers**\n- Fixes\nSome text',
          assets: [{ name: 'Gnomon-1.2.3-arm64.dmg', size: 4242, browser_download_url: 'https://github.com/DennHa/gnomon/releases/download/v1.2.3/Gnomon-1.2.3-arm64.dmg' }],
        }),
      );
    });
    process.env.GNOMON_GITHUB_API = gh.url;
    forgetGithubRelease();
    const x = await freshServer();
    try {
      const v = await (await fetch(`${x.url}/latest/version.json`)).json();
      assert.deepEqual(v, { version: '1.2.3', date: '2026-10-20', notes: ['Faster timers', 'Fixes'], download: '/latest/download', page: '/latest' });
      const dl = await fetch(`${x.url}/latest/download`, { redirect: 'manual' });
      assert.equal(dl.status, 302);
      assert.match(dl.headers.get('location')!, /^https:\/\/github\.com\/DennHa\/gnomon\/releases\/download\//);
      assert.equal((await x.go('GET', '/admin/mac-app', undefined, x.token)).body.release.version, '1.2.3');

      // An upload: only a disk image, then it's what /latest hands out.
      assert.equal((await x.go('PUT', '/admin/mac-app?version=2.0.0', undefined, x.token, Buffer.alloc(2048, 1))).status, 422, 'not a .dmg');
      assert.equal((await x.go('PUT', '/admin/mac-app?version=nope', undefined, x.token, Buffer.alloc(2048))).status, 422);
      const dmg = Buffer.alloc(4096, 2);
      dmg.write('koly', dmg.length - 512, 'latin1');
      assert.equal((await x.go('PUT', '/admin/mac-app?version=2.0.0', undefined, undefined, dmg)).status, 401);
      const up = await x.go('PUT', '/admin/mac-app?version=2.0.0', undefined, x.token, dmg);
      assert.equal(up.status, 200);
      assert.equal(up.body.config.macApp.source, 'upload');
      assert.equal(up.body.release.version, '2.0.0');
      assert.equal((await (await fetch(`${x.url}/latest/version.json`)).json()).version, '2.0.0');
      const file = await fetch(`${x.url}/latest/download`);
      assert.equal(file.headers.get('content-disposition'), 'attachment; filename="Gnomon-2.0.0.dmg"');
      assert.equal((await file.arrayBuffer()).byteLength, 4096);

      // Back to GitHub.
      assert.equal((await x.go('PUT', '/admin/config', { macApp: { source: 'github' } }, x.token)).body.config.macApp.source, 'github');
      assert.equal((await (await fetch(`${x.url}/latest/version.json`)).json()).version, '1.2.3');
    } finally {
      delete process.env.GNOMON_GITHUB_API;
      forgetGithubRelease();
      await gh.close();
      await x.close();
    }
  });
});

describe('how people see their hours', () => {
  test('the admin’s balance-or-corridor choice and zones reach every person with each sync, checked; no times go back', async () => {
    const x = await freshServer();
    try {
      const { key } = x.store.addDevice('Mac', 'mac');
      const sync = async () => (await fetch(`${x.url}/api/v1/sync?since=0`, { headers: { Authorization: `Bearer ${key}` } })).json();
      assert.deepEqual((await sync()).company, { hours: { weeks: 4, within: 10, critical: 20 } }, 'not set: each person chooses, the default zones');
      const r = await x.go('PUT', '/admin/config', { hours: { mode: 'corridor', weeks: 6, within: 8, critical: 15, note: '  Talk to your lead first.  ' } }, x.token);
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.config.hours, { mode: 'corridor', weeks: 6, within: 8, critical: 15, note: 'Talk to your lead first.' });
      assert.deepEqual((await sync()).company.hours, { mode: 'corridor', weeks: 6, within: 8, critical: 15, note: 'Talk to your lead first.' });
      const pushed = await fetch(`${x.url}/api/v1/sync`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: [] }) });
      assert.equal((await pushed.json()).company.hours.mode, 'corridor', 'pushing gets the same answer');
      assert.equal((await x.go('PUT', '/admin/config', { hours: { weeks: 0 } }, x.token)).status, 422);
      assert.equal((await x.go('PUT', '/admin/config', { hours: { within: 30 } }, x.token)).status, 422, 'within above critical');
      assert.equal((await x.go('PUT', '/admin/config', { hours: { mode: 'sometimes' } }, x.token)).body.config.hours.mode, 'corridor', 'unknown modes are ignored');
      await x.go('PUT', '/admin/config', { hours: { mode: 'unset', note: '' } }, x.token);
      assert.deepEqual((await sync()).company.hours, { weeks: 6, within: 8, critical: 15 });
      const overview = JSON.stringify((await x.go('GET', '/admin/overview', undefined, x.token)).body);
      assert.ok(!/worked|deviation|pct/i.test(overview), 'the admin sees no one’s hours');
    } finally {
      await x.close();
    }
  });
});
