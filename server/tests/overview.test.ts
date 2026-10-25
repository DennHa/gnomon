// The Admin page's overview: counts of people, what needs attention and the server's health, for admins only and
// without anyone's times. GitHub is a fake server here, so nothing leaves this machine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app';
import { Backups } from '../src/backups';
import { Company } from '../src/company';
import { forgetGithubRelease } from '../src/releases';
import { Store } from '../src/store';
import { VERSION } from '../src/version';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-overview-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((r) => server.close(r)) };
}

// A release one major version ahead of this build, so the overview has an update to offer.
const ahead = `${Number(VERSION.split('.')[0]) + 1 || 1}.0.0`;
let gh: Awaited<ReturnType<typeof listen>>;
before(async () => {
  gh = await listen((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tag_name: `v${ahead}`, published_at: '2026-10-20T10:00:00Z', body: '', assets: [{ name: `Gnomon-${ahead}-arm64.dmg`, size: 1, browser_download_url: `https://github.com/DennHa/gnomon/releases/download/v${ahead}/Gnomon.dmg` }] }));
  });
  process.env.GNOMON_GITHUB_API = gh.url;
  forgetGithubRelease();
});
after(() => gh.close());

async function server() {
  const dir = fs.mkdtempSync(path.join(tmp, 'server-'));
  const store = new Store(path.join(dir, 'gnomon.db'));
  const company = new Company(store, Buffer.alloc(32, 7), 'env');
  const s = await listen(createApp({ store, company, backups: new Backups(store, dir) }));
  const go = async (method: string, p: string, body?: unknown, auth?: string) => {
    const r = await fetch(`${s.url}/api/v1${p}`, {
      method,
      headers: { ...(auth && { Authorization: `Bearer ${auth}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const token = (await go('POST', '/admin/session', { code: store.createAdminCode('admin', 60) })).body.token as string;
  return { store, go, token, close: async () => (await s.close(), store.close()) };
}

describe('the admin overview', () => {
  test('counts people by status, lists what needs attention, and reports the server’s health', async () => {
    const x = await server();
    try {
      const add = (n: number, status: 'active' | 'invited' | 'pending' | 'disabled') =>
        Array.from({ length: n }, (_, i) => x.store.addPerson({ email: `${status}${i}@example.com`, name: `${status} ${i}`, status }));
      add(3, 'active');
      add(2, 'pending');
      add(1, 'disabled');
      const invited = add(4, 'invited');
      for (const p of invited.slice(0, 3)) x.store.createInvite(p.id, 14);
      x.store.createInvite(invited[3].id, 14);
      // One invitation ran out.
      (x.store as any).db.prepare('UPDATE invites SET expires_at = ? WHERE person_id = ?').run('2020-01-01T00:00:00.000Z', invited[3].id);

      const o = (await x.go('GET', '/admin/overview', undefined, x.token)).body;
      // The owner is the fourth active person.
      assert.deepEqual([o.counts.active, o.counts.invited, o.counts.expired, o.counts.pending, o.counts.disabled], [4, 3, 1, 2, 1]);
      const codes = o.attention.map((a: { code: string }) => a.code);
      assert.deepEqual(codes.slice(0, 4), ['pending', 'invitesExpired', 'emailMissing', 'backupNoPassword']);
      assert.equal(o.attention[0].n, 2);
      assert.ok(codes.includes('adminPassword'));
      assert.equal(o.health.version, VERSION);
      assert.equal(o.health.email.ready, false);
      assert.equal(o.health.backups.keySet, false);
      assert.equal(o.health.encryption, null);
      assert.ok(o.health.disk.total > 0 && o.health.disk.free <= o.health.disk.total);
      if (/^\d+\.\d+\.\d+/.test(VERSION)) {
        assert.equal(o.health.update.version, ahead);
        assert.ok(codes.includes('update'));
      }
    } finally {
      await x.close();
    }
  });

  test('with a backup password and a fresh backup, backups need no attention', async () => {
    const x = await server();
    try {
      assert.equal((await x.go('POST', '/admin/backups/password', { password: 'correct horse battery' }, x.token)).status, 200);
      assert.equal((await x.go('POST', '/admin/backups/run', undefined, x.token)).status, 200);
      const o = (await x.go('GET', '/admin/overview', undefined, x.token)).body;
      assert.ok(!o.attention.some((a: { code: string }) => a.code.startsWith('backup')));
      assert.equal(o.health.backups.count, 1);
      assert.ok(o.health.backups.newest);
    } finally {
      await x.close();
    }
  });

  test('is for admins only, and holds no one’s times', async () => {
    const x = await server();
    try {
      assert.equal((await x.go('GET', '/admin/overview')).status, 401);
      const member = x.store.addPerson({ email: 'member@example.com', name: 'Member Example', status: 'active' });
      x.store.setPassword(member.id, 'a long password');
      const web = await x.go('POST', '/admin/login', { email: 'member@example.com', password: 'a long password' });
      assert.equal(web.status, 403, 'a member can’t sign in to the Admin page');
      // Make them admin, sign in, then take it back: the session no longer opens the overview.
      x.store.updatePerson(member.id, { role: 'admin' });
      const token = (await x.go('POST', '/admin/login', { email: 'member@example.com', password: 'a long password' })).body.token as string;
      assert.equal((await x.go('GET', '/admin/overview', undefined, token)).status, 200);
      x.store.updatePerson(member.id, { role: 'member' });
      assert.equal((await x.go('GET', '/admin/overview', undefined, token)).status, 403);

      const o = (await x.go('GET', '/admin/overview', undefined, x.token)).body;
      // Only these fields, so times can't slip in unnoticed.
      assert.deepEqual(Object.keys(o).sort(), ['attention', 'counts', 'health']);
      assert.deepEqual(Object.keys(o.counts).sort(), ['active', 'admins', 'devices', 'disabled', 'expired', 'invited', 'pending']);
      assert.deepEqual(Object.keys(o.health).sort(), ['backups', 'disk', 'email', 'encryption', 'https', 'keySource', 'startedAt', 'update', 'version']);
      assert.ok(!/entries|activities|minutes/.test(JSON.stringify(o)));
    } finally {
      await x.close();
    }
  });
});
