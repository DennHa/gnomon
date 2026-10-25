// Encryption at rest (data-key.ts): the database and its WAL can't be read without GNOMON_DATA_KEY, an unencrypted
// database is encrypted in place on the first start with a key, a wrong or missing key is a clear error (never an empty
// start), and backups, restore and a new key keep working. All data here is made up.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { Backups, openBackup, restoreBackup } from '../src/backups';
import { Company } from '../src/company';
import { DataKeyError, encryptInPlace, isEncryptedFile, loadDataKey, newDataKey, plainCopies, rawKey } from '../src/data-key';
import { encryptionStatus, openStore } from '../src/open-store';
import { Store } from '../src/store';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-encryption-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const KEY = 'a made-up data key that is long enough to use';
const OTHER = 'another made-up data key, also long enough';
const PASSWORD = 'correct horse battery';
const SECRET_NAME = 'Zebulon Quackenbush'; // made up, and easy to find in a file's bytes
const SECRET_PROJECT = 'Project Marmalade Sky';
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/** A data folder with made-up people, projects, entries and workdays, written with `key` (or unencrypted). */
function fillStore(store: Store) {
  store.updatePerson(store.ownerId, { name: SECRET_NAME, email: 'zebulon@example.com' });
  const d = store.get();
  store.commit({
    ...d,
    projects: [{ id: 'p1', name: SECRET_PROJECT, color: '#123456' }],
    entries: Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, description: `Made-up work ${i} for ${SECRET_PROJECT}`, projectId: 'p1', start: `2026-10-0${(i % 9) + 1}T09:00:00.000Z`, end: `2026-10-0${(i % 9) + 1}T10:00:00.000Z` })),
    workdays: [{ date: '2026-10-01', start: '2026-10-01T08:00:00.000Z', end: '2026-10-01T17:00:00.000Z', breaks: [] }],
  });
}

const contains = (file: string, text: string) => fs.existsSync(file) && fs.readFileSync(file).includes(Buffer.from(text));
const withEnv = <T>(env: Record<string, string | undefined>, fn: () => T): T => {
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};
const newDir = () => fs.mkdtempSync(path.join(tmp, 'data-'));

describe('the data key', () => {
  test('comes from GNOMON_DATA_KEY or a file, and must be long', () => {
    assert.equal(loadDataKey({}), undefined);
    assert.equal(loadDataKey({ GNOMON_DATA_KEY: KEY })?.source, 'env');
    assert.deepEqual(loadDataKey({ GNOMON_DATA_KEY: KEY })?.raw, rawKey(KEY));
    const file = path.join(tmp, 'data.key');
    fs.writeFileSync(file, `${KEY}\n`);
    assert.deepEqual(loadDataKey({ GNOMON_DATA_KEY_FILE: file }), { raw: rawKey(KEY), source: 'file' });
    assert.throws(() => loadDataKey({ GNOMON_DATA_KEY_FILE: path.join(tmp, 'missing.key') }), (e: unknown) => e instanceof DataKeyError && e.code === 'key_file');
    assert.throws(() => loadDataKey({ GNOMON_DATA_KEY: 'too short' }), (e: unknown) => e instanceof DataKeyError && e.code === 'weak_key');
    const k = newDataKey();
    assert.match(k, /^[A-Za-z2-9]{48}$/);
    assert.notEqual(k, newDataKey());
  });
});

describe('an encrypted database', () => {
  test('can’t be read without the key, WAL included', () => {
    const dir = newDir();
    const file = path.join(dir, 'gnomon.db');
    const store = new Store(file, rawKey(KEY));
    fillStore(store);
    assert.equal(store.encrypted, true);
    // While it runs, the newest changes are in the WAL: that's encrypted too.
    assert.ok(fs.existsSync(`${file}-wal`));
    for (const f of [file, `${file}-wal`, `${file}-shm`]) for (const text of [SECRET_NAME, SECRET_PROJECT, 'zebulon@example.com', 'SQLite format 3']) assert.ok(!contains(f, text), `${path.basename(f)} shows "${text}"`);
    store.close();
    assert.equal(isEncryptedFile(file), true);
    for (const text of [SECRET_NAME, SECRET_PROJECT]) assert.ok(!contains(file, text));

    const back = new Store(file, rawKey(KEY));
    assert.equal(back.person(back.ownerId)?.name, SECRET_NAME);
    assert.equal(back.get().entries.length, 50);
    back.close();
  });

  test('a wrong or missing key is a clear error, and the data stays as it was', () => {
    const dir = newDir();
    const file = path.join(dir, 'gnomon.db');
    const store = new Store(file, rawKey(KEY));
    fillStore(store);
    store.close();
    const before = fs.readFileSync(file);
    assert.throws(() => new Store(file), (e: unknown) => e instanceof DataKeyError && e.code === 'missing_key' && /encrypted, but GNOMON_DATA_KEY isn’t set/.test(e.message));
    assert.throws(() => new Store(file, rawKey(OTHER)), (e: unknown) => e instanceof DataKeyError && e.code === 'wrong_key' && /doesn’t open this database/.test(e.message));
    assert.deepEqual(fs.readFileSync(file), before, 'nothing was written');
    const back = new Store(file, rawKey(KEY));
    assert.equal(back.get().entries.length, 50, 'and it never started empty');
    back.close();
  });

  test('the server and gnomon-admin stop with the reason instead of starting empty', () => {
    const dir = newDir();
    const store = new Store(path.join(dir, 'gnomon.db'), rawKey(KEY));
    fillStore(store);
    store.close();
    const env = { ...process.env, GNOMON_DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', GNOMON_DATA_KEY: '' };
    const missing = spawnSync(process.execPath, [path.join(dist, 'server.mjs')], { env, encoding: 'utf8', timeout: 20_000 });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Gnomon can't start: The database is encrypted, but GNOMON_DATA_KEY isn’t set/);
    const wrong = spawnSync(process.execPath, [path.join(dist, 'server.mjs')], { env: { ...env, GNOMON_DATA_KEY: OTHER }, encoding: 'utf8', timeout: 20_000 });
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /doesn’t open this database/);
    const admin = spawnSync(process.execPath, [path.join(dist, 'admin.mjs'), 'status'], { env: { ...env, GNOMON_DATA_KEY: OTHER }, encoding: 'utf8' });
    assert.equal(admin.status, 1);
    assert.match(admin.stderr, /doesn’t open this database/);
    const ok = spawnSync(process.execPath, [path.join(dist, 'admin.mjs'), 'status'], { env: { ...env, GNOMON_DATA_KEY: KEY }, encoding: 'utf8' });
    assert.match(ok.stdout, /Data: +encrypted at rest \(key from GNOMON_DATA_KEY\)/);
  });
});

describe('encrypting an existing database', () => {
  test('on the first start with a key: in place, checked, with the unencrypted original kept when there’s no backup password', () => {
    const dir = newDir();
    const file = path.join(dir, 'gnomon.db');
    const plain = new Store(file);
    fillStore(plain);
    assert.equal(plain.encrypted, false);
    plain.close();
    assert.ok(contains(file, SECRET_NAME), 'the made-up data is readable before');

    const logs: string[] = [];
    const { store, migration } = withEnv({ GNOMON_DATA_KEY: KEY, GNOMON_DATA_KEY_FILE: undefined }, () => openStore(dir, (m) => logs.push(m)));
    try {
      assert.equal(store.encrypted, true);
      assert.equal(store.person(store.ownerId)?.name, SECRET_NAME);
      assert.equal(store.get().entries.length, 50);
      assert.equal(store.get().workdays.length, 1);
      assert.ok(migration?.kept && !migration.backedUp);
      assert.match(logs.join('\n'), /kept as gnomon\.db\.before-encryption-.*delete it once all is well/);
      assert.deepEqual(plainCopies(dir, file), [path.basename(migration.kept!)], 'the status points at the unencrypted copy');
    } finally {
      store.close();
    }
    assert.equal(isEncryptedFile(file), true);
    for (const f of [file, `${file}-wal`]) assert.ok(!contains(f, SECRET_NAME));
    assert.ok(!fs.existsSync(`${file}.encrypting`));
    // The way back: the kept original still opens without a key.
    const old = new Store(migration!.kept!);
    assert.equal(old.get().entries.length, 50);
    old.close();
    // Once done, the next start just opens it.
    const again = withEnv({ GNOMON_DATA_KEY: KEY }, () => openStore(dir, () => {}));
    assert.equal(again.migration, undefined);
    again.store.close();
  });

  test('with a backup password, an encrypted backup comes first and no unencrypted copy is left', () => {
    const dir = newDir();
    const file = path.join(dir, 'gnomon.db');
    const plain = new Store(file);
    fillStore(plain);
    new Backups(plain, dir).setPassword(PASSWORD);
    plain.close();

    const { store, migration } = withEnv({ GNOMON_DATA_KEY: KEY }, () => openStore(dir, () => {}));
    store.close();
    assert.ok(migration?.backedUp && !migration.kept);
    assert.match(migration.backedUp, /-pre-encryption\.gnomonbak$/);
    assert.deepEqual(plainCopies(dir, file), []);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('gnomon.db.')), []);
    // The backup is the way back: it opens with the backup password and has everything.
    const image = openBackup(fs.readFileSync(path.join(dir, 'backups', migration.backedUp)), PASSWORD).db;
    const restoredFile = path.join(newDir(), 'gnomon.db');
    fs.writeFileSync(restoredFile, image);
    const back = new Store(restoredFile);
    assert.equal(back.get().entries.length, 50);
    back.close();
  });

  test('a failure leaves the original untouched and unencrypted', () => {
    const dir = newDir();
    const file = path.join(dir, 'gnomon.db');
    const plain = new Store(file);
    fillStore(plain);
    plain.close();
    const before = fs.readFileSync(file);
    assert.throws(
      () =>
        encryptInPlace(file, rawKey(KEY), () => {
          throw new Error('the disk is full');
        }),
      (e: unknown) => e instanceof DataKeyError && e.code === 'migration_failed' && /unchanged and still unencrypted: the disk is full/.test(e.message),
    );
    assert.deepEqual(fs.readFileSync(file), before);
    assert.ok(!fs.existsSync(`${file}.encrypting`));
    const back = new Store(file);
    assert.equal(back.get().entries.length, 50);
    back.close();
  });
});

describe('backups and restore with encryption', () => {
  test('backups are made from the encrypted database and restore into an encrypted one', async () => {
    const dir = newDir();
    const file = path.join(dir, 'gnomon.db');
    const store = new Store(file, rawKey(KEY));
    fillStore(store);
    const backups = new Backups(store, dir);
    backups.setPassword(PASSWORD);
    const b = await backups.run();
    const sealed = fs.readFileSync(path.join(backups.dir, b.name));
    assert.ok(!sealed.includes(Buffer.from(SECRET_NAME)));
    assert.deepEqual(fs.readdirSync(backups.dir).filter((f) => f.startsWith('.')), [], 'no temporary (unencrypted) file left');
    // An encrypted copy for the update's safety net, when there's no backup password.
    const copy = path.join(dir, 'backups', 'copy.db');
    store.copyTo(copy);
    assert.equal(isEncryptedFile(copy), true);
    store.updatePerson(store.ownerId, { name: 'Changed after the backup' });
    store.close();
    fs.rmSync(copy);

    const r = restoreBackup(file, sealed, PASSWORD, rawKey(KEY));
    assert.equal(isEncryptedFile(file), true, 'restored encrypted');
    assert.equal(isEncryptedFile(r.kept!), true, 'the database from before is kept encrypted');
    assert.ok(!contains(file, SECRET_NAME));
    const back = new Store(file, rawKey(KEY));
    assert.equal(back.person(back.ownerId)?.name, SECRET_NAME);
    assert.equal(back.get().entries.length, 50);
    back.close();
    assert.deepEqual(plainCopies(dir, file), []);

    // A backup also restores on a server with another data key (or none): backups only need the backup password.
    const elsewhere = path.join(newDir(), 'gnomon.db');
    restoreBackup(elsewhere, sealed, PASSWORD, rawKey(OTHER));
    const there = new Store(elsewhere, rawKey(OTHER));
    assert.equal(there.get().entries.length, 50);
    there.close();
  });

  test('a backup from before encryption restores into an encrypted server', async () => {
    const dir = newDir();
    const file = path.join(dir, 'gnomon.db');
    const plain = new Store(file);
    fillStore(plain);
    const backups = new Backups(plain, dir);
    backups.setPassword(PASSWORD);
    const sealed = fs.readFileSync(path.join(backups.dir, (await backups.run()).name));
    plain.close();
    restoreBackup(file, sealed, PASSWORD, rawKey(KEY));
    const back = new Store(file, rawKey(KEY));
    assert.equal(back.get().entries.length, 50);
    back.close();
  });
});

describe('gnomon-admin rotate-data-key', () => {
  test('re-encrypts with a new key; the old one no longer opens it', () => {
    const dir = newDir();
    const file = path.join(dir, 'gnomon.db');
    const store = new Store(file, rawKey(KEY));
    fillStore(store);
    store.close();
    const env = { ...process.env, GNOMON_DATA_DIR: dir, PORT: '1', GNOMON_DATA_KEY: KEY };
    const run = (args: string[], input?: string, e = env) => spawnSync(process.execPath, [path.join(dist, 'admin.mjs'), ...args], { env: e, input, encoding: 'utf8' });

    assert.match(run(['rotate-data-key'], 'short\n').stderr, /at least 32 characters/);
    const r = run(['rotate-data-key'], `${OTHER}\n`);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Re-encrypted with the new key/);
    assert.throws(() => new Store(file, rawKey(KEY)), (e: unknown) => e instanceof DataKeyError && e.code === 'wrong_key');
    const back = new Store(file, rawKey(OTHER));
    assert.equal(back.get().entries.length, 50);
    back.close();

    assert.match(run(['rotate-data-key', '--new']).stderr, /doesn’t open this database/, 'needs the current key');
    const fresh = run(['rotate-data-key', '--new'], undefined, { ...env, GNOMON_DATA_KEY: OTHER });
    const made = fresh.stdout.match(/^ {4}([A-Za-z2-9]{48})$/m)?.[1];
    assert.ok(made, fresh.stdout + fresh.stderr);
    const last = new Store(file, rawKey(made));
    assert.equal(last.get().entries.length, 50);
    last.close();
  });
});

describe('the Admin page', () => {
  test('GET /admin/encryption says whether the data is encrypted, only to admins', async () => {
    const dir = newDir();
    const file = path.join(dir, 'gnomon.db');
    const store = new Store(file, rawKey(KEY));
    const server = http.createServer(createApp({ store, company: new Company(store, Buffer.alloc(32, 7), 'env'), encryption: () => encryptionStatus(store, dir, file, { raw: rawKey(KEY), source: 'env' }) }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    try {
      assert.equal((await fetch(`${url}/admin/encryption`)).status, 401);
      const code = store.createAdminCode('setup', 60);
      const { token } = (await (await fetch(`${url}/admin/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })).json()) as { token: string };
      const r = await fetch(`${url}/admin/encryption`, { headers: { Authorization: `Bearer ${token}` } });
      assert.deepEqual(await r.json(), { encrypted: true, keySource: 'env', plainCopies: [] });
      const state = (await (await fetch(`${url}/admin/state`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { encryption: unknown };
      assert.deepEqual(state.encryption, { encrypted: true, keySource: 'env', plainCopies: [] });
    } finally {
      await new Promise((r) => server.close(r));
      store.close();
    }
  });
});
