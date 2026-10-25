// SQLite storage for the people on a Gnomon server and each person's own data (docs/accounts-design.md).
//
// The REST logic is the Mac app's own (src/api.ts + src/actions.ts), which works on a whole `Data` object.
// So the store keeps each person's current Data in memory (this process is the only writer) and, on every commit,
// writes just the records that changed. Each write gets a new `seq` from one counter: "give me everything of mine
// after seq N" is how a client (the Mac app) syncs, without trusting clocks. Deletions leave a tombstone row.
// Every device belongs to a person, and every read and write goes through that person: nobody sees anyone else's
// records. A server set up before people existed gets one person, the owner, who keeps all its data.
import Database from 'better-sqlite3-multiple-ciphers';
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Activity, Data, Entry, Project, Settings, Workday } from '../../src/types';
import { applyKey, DataKeyError, isEncryptedFile } from './data-key';

/**
 * Where the database lives in a data folder. Servers set up before the rename to Gnomon used punch.db; it is
 * taken over once (with its WAL files) so an update keeps all data and device keys.
 */
export function databaseFile(dataDir: string): string {
  const file = path.join(dataDir, 'gnomon.db');
  const legacy = path.join(dataDir, 'punch.db');
  if (!fs.existsSync(file) && fs.existsSync(legacy)) {
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(legacy + suffix)) fs.renameSync(legacy + suffix, file + suffix);
    console.log(`Took over the database from ${legacy}`);
  }
  return file;
}

export const KINDS = ['projects', 'activities', 'entries', 'workdays'] as const;
export type Kind = (typeof KINDS)[number];
type AnyRecord = Project | Activity | Entry | Workday;

/** The key of a record within its kind: workdays are keyed by date, everything else by id. */
export const keyOf = (kind: Kind, r: AnyRecord): string => (kind === 'workdays' ? (r as Workday).date : (r as { id: string }).id);

export type Change = { kind: Kind; id: string; seq: number; updatedAt: string; deleted: boolean; data: AnyRecord | null };

/** A person with their own data and devices. role: what they may do on the Admin page later (step 2 of the design). */
export type Person = { id: string; email: string | null; name: string; role: 'admin' | 'member'; status: 'invited' | 'pending' | 'active' | 'disabled'; createdAt: string; lastSeenAt: string | null };
type PersonRow = { id: string; email: string | null; name: string; role: Person['role']; status: Person['status']; created_at: string; last_seen_at: string | null };
const personOf = (r: PersonRow): Person => ({ id: r.id, email: r.email, name: r.name, role: r.role, status: r.status, createdAt: r.created_at, lastSeenAt: r.last_seen_at });

const DEFAULT_SETTINGS = {
  dailyTargetHours: 8,
  autoStartDay: false,
  startDayWithTimer: true,
  shortcutsEnabled: false,
  idleMinutes: 0,
  reviewOnLeave: false,
  menuBarLabel: 'none',
  menuBarColor: 'mono',
  activityTrail: false,
  apiEnabled: true,
  apiPort: 0,
  apiLan: false,
} as unknown as Settings;

export const DEFAULT_ACTIVITIES: Omit<Activity, 'id'>[] = [
  { name: 'Call', color: '#E91E63' },
  { name: 'Design', color: '#9C27B0' },
  { name: 'Development', color: '#009688' },
  { name: 'Admin', color: '#607D8B' },
];

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** client: what connected ('mac', 'phone', or null when unknown); admin: may open the Admin page from the device; personId: whose device it is. */
export type Device = { id: string; name: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null; client?: string | null; admin?: boolean; personId: string };
type DeviceRow = { id: string; name: string; created_at: string; last_seen_at: string | null; revoked_at: string | null; client: string | null; is_admin: number; person_id: string };
const DEVICE_COLUMNS = 'id, name, created_at, last_seen_at, revoked_at, client, is_admin, person_id';
const deviceOf = (r: DeviceRow): Device => ({ id: r.id, name: r.name, createdAt: r.created_at, lastSeenAt: r.last_seen_at, revokedAt: r.revoked_at, client: r.client, admin: r.is_admin === 1, personId: r.person_id });

/** One person's data as it is in memory, and the last committed JSON of each record (to find what changed). */
type Slot = { data: Data; snapshot: Map<string, string> };

export class Store {
  private db: Database.Database;
  /** Each person's data, loaded when first asked for. */
  private slots = new Map<string, Slot>();
  /** The person a server had before there were people, and who a single-person server's devices belong to. */
  readonly ownerId: string;
  /** Whether the database is encrypted at rest (data-key.ts). */
  readonly encrypted: boolean;

  /**
   * `key`: the data key (data-key.ts). An encrypted database never opens without it, and a wrong one is an error, never
   * an empty start. An unencrypted database with a key is encrypted first (openStore in data-key.ts does that).
   */
  constructor(file: string, key?: Buffer) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const state = file === ':memory:' ? undefined : isEncryptedFile(file);
    if (state && !key) throw new DataKeyError('missing_key', 'The database is encrypted, but GNOMON_DATA_KEY isn’t set. Set it to the data key from the install (in .env or your password manager).');
    if (state === false && key) throw new DataKeyError('not_encrypted', 'The database isn’t encrypted yet; it has to be encrypted before it opens with GNOMON_DATA_KEY.');
    this.db = new Database(file);
    this.encrypted = Boolean(key);
    if (key) {
      try {
        applyKey(this.db, key);
      } catch (e) {
        this.db.close();
        throw e;
      }
      this.db.pragma('temp_store = MEMORY'); // temporary tables and sorts never touch the disk unencrypted
    }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS people (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        last_seen_at TEXT
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_seen_at TEXT,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS pair_codes (
        code_hash TEXT PRIMARY KEY,
        device_name TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feedback_threads (
        id TEXT PRIMARY KEY,
        secret_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',
        sender TEXT,
        app_version TEXT,
        os TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        admin_seen_at TEXT
      );
      CREATE TABLE IF NOT EXISTS feedback_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL REFERENCES feedback_threads(id) ON DELETE CASCADE,
        author TEXT NOT NULL,
        text TEXT NOT NULL,
        at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invites (
        code_hash TEXT PRIMARY KEY,
        person_id TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS password_resets (
        token_hash TEXT PRIMARY KEY,
        person_id TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS admin_codes (
        code_hash TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
    // Added later: what kind of device it is, and whether it may open the Admin page.
    const cols = (table: string) => (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols('devices').includes('client')) this.db.exec('ALTER TABLE devices ADD COLUMN client TEXT');
    if (!cols('devices').includes('is_admin')) this.db.exec('ALTER TABLE devices ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
    this.ownerId = this.migrateToPeople(cols);
    if (file !== ':memory:') for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
    this.seed(this.ownerId);
  }

  /**
   * People came later. In one transaction: create the owner (role admin; the email is asked on the Admin page), and
   * give them every record, device and open pairing code there is. A fresh database just gets its owner. Runs on
   * every start and does nothing once done.
   */
  private migrateToPeople(cols: (table: string) => string[]): string {
    let owner = this.getMeta('owner');
    this.db.transaction(() => {
      if (!owner) {
        owner = crypto.randomUUID();
        this.db.prepare("INSERT INTO people (id, email, name, role, status, created_at) VALUES (?, NULL, 'Owner', 'admin', 'active', ?)").run(owner, new Date().toISOString());
        this.setMeta('owner', owner);
      }
      const hasRecords = (this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'records'").get() as unknown) !== undefined;
      if (!hasRecords || !cols('records').includes('person_id')) {
        this.db.exec(`
          CREATE TABLE records_people (
            person_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            id TEXT NOT NULL,
            data TEXT,
            seq INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (person_id, kind, id)
          );
        `);
        if (hasRecords) {
          this.db.prepare('INSERT INTO records_people (person_id, kind, id, data, seq, updated_at, deleted) SELECT ?, kind, id, data, seq, updated_at, deleted FROM records').run(owner);
          this.db.exec('DROP TABLE records');
        }
        this.db.exec('ALTER TABLE records_people RENAME TO records; CREATE INDEX IF NOT EXISTS records_seq ON records(seq); CREATE INDEX IF NOT EXISTS records_person ON records(person_id, seq);');
      }
      if (!cols('devices').includes('person_id')) this.db.exec('ALTER TABLE devices ADD COLUMN person_id TEXT');
      this.db.prepare('UPDATE devices SET person_id = ? WHERE person_id IS NULL').run(owner);
      if (!cols('pair_codes').includes('person_id')) this.db.exec('ALTER TABLE pair_codes ADD COLUMN person_id TEXT');
      // Passwords are per person now; the server's admin password becomes the owner's.
      if (!cols('people').includes('password_hash')) this.db.exec('ALTER TABLE people ADD COLUMN password_hash TEXT');
      const adminPassword = this.getMeta('adminPassword');
      if (adminPassword) {
        this.db.prepare('UPDATE people SET password_hash = COALESCE(password_hash, ?) WHERE id = ?').run(adminPassword, owner);
        this.db.prepare("DELETE FROM meta WHERE key = 'adminPassword'").run();
      }
      // Settings and the "seeded" mark were the server's; now they're the owner's.
      for (const key of ['settings', 'seeded']) {
        const v = this.getMeta(key);
        if (v !== undefined && this.getMeta(`${key}:${owner}`) === undefined) this.setMeta(`${key}:${owner}`, v);
        this.db.prepare('DELETE FROM meta WHERE key = ?').run(key);
      }
    })();
    return owner!;
  }

  /** A new person gets a few activities, so the phone has chips to tap; the Mac's list replaces them on first sync. */
  private seed(personId: string) {
    if (this.getMeta(`seeded:${personId}`)) return;
    const d = this.get(personId);
    this.commit({ ...d, activities: DEFAULT_ACTIVITIES.map((a) => ({ id: crypto.randomUUID(), ...a })) }, undefined, personId);
    this.setMeta(`seeded:${personId}`, '1');
  }

  close() {
    this.db.close();
  }

  /** The whole database, decrypted, as one consistent SQLite image (for backups, which encrypt it themselves). */
  snapshot(): Buffer {
    return this.db.serialize();
  }

  /** A consistent copy of the database file while the server keeps running, encrypted with the same key when it is. */
  copyTo(file: string) {
    fs.rmSync(file, { force: true });
    this.db.prepare('VACUUM INTO ?').run(file);
  }

  // ---- Data -------------------------------------------------------------------------------

  private slot(personId: string): Slot {
    let slot = this.slots.get(personId);
    if (slot) return slot;
    const data: Data = { version: 1, projects: [], activities: [], entries: [], workdays: [], plan: [], reviewedWeeks: [], settings: { ...DEFAULT_SETTINGS } };
    const snapshot = new Map<string, string>();
    const rows = this.db.prepare('SELECT kind, id, data FROM records WHERE person_id = ? AND deleted = 0').all(personId) as { kind: Kind; id: string; data: string }[];
    for (const r of rows) {
      if (!KINDS.includes(r.kind)) continue;
      (data[r.kind] as AnyRecord[]).push(JSON.parse(r.data));
      snapshot.set(`${r.kind}:${r.id}`, r.data);
    }
    const settings = this.getMeta(`settings:${personId}`);
    if (settings) data.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(settings) };
    slot = { data, snapshot };
    this.slots.set(personId, slot);
    return slot;
  }

  /** A person's data (the owner's when no person is named: a single-person server, the command line, tests). */
  get(personId: string = this.ownerId): Data {
    return this.slot(personId).data;
  }

  /**
   * Persist a person's new Data, writing only the records that changed. Returns how many rows were written.
   * `stamp` is when each change happened: now, or (for changes pushed by a syncing client) the client's own time.
   */
  commit(next: Data, stamp: string | ((kind: Kind, id: string) => string) = new Date().toISOString(), personId: string = this.ownerId): number {
    const at = typeof stamp === 'string' ? () => stamp : stamp;
    const slot = this.slot(personId);
    let written = 0;
    const tx = this.db.transaction(() => {
      if (JSON.stringify(next.settings) !== JSON.stringify(slot.data.settings)) this.setMeta(`settings:${personId}`, JSON.stringify(next.settings));
      const upsert = this.db.prepare('INSERT INTO records (person_id, kind, id, data, seq, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?, 0) ON CONFLICT(person_id, kind, id) DO UPDATE SET data = excluded.data, seq = excluded.seq, updated_at = excluded.updated_at, deleted = 0');
      const tomb = this.db.prepare('UPDATE records SET data = NULL, seq = ?, updated_at = ?, deleted = 1 WHERE person_id = ? AND kind = ? AND id = ?');
      for (const kind of KINDS) {
        const seen = new Set<string>();
        for (const r of next[kind] as AnyRecord[]) {
          const id = keyOf(kind, r);
          const k = `${kind}:${id}`;
          seen.add(k);
          const json = JSON.stringify(r);
          if (slot.snapshot.get(k) === json) continue;
          upsert.run(personId, kind, id, json, this.nextSeq(), at(kind, id));
          slot.snapshot.set(k, json);
          written++;
        }
        for (const k of [...slot.snapshot.keys()]) {
          if (!k.startsWith(`${kind}:`) || seen.has(k)) continue;
          const id = k.slice(kind.length + 1);
          tomb.run(this.nextSeq(), at(kind, id), personId, kind, id);
          slot.snapshot.delete(k);
          written++;
        }
      }
    });
    tx();
    slot.data = next;
    return written;
  }

  private nextSeq(): number {
    const seq = Number(this.getMeta('seq') ?? '0') + 1;
    this.setMeta('seq', String(seq));
    return seq;
  }

  cursor(): number {
    return Number(this.getMeta('seq') ?? '0');
  }

  /** Everything of a person's written after `since`, oldest first. */
  changesSince(since: number, limit = 5000, personId: string = this.ownerId): Change[] {
    const rows = this.db.prepare('SELECT kind, id, data, seq, updated_at, deleted FROM records WHERE person_id = ? AND seq > ? ORDER BY seq LIMIT ?').all(personId, since, limit) as {
      kind: Kind;
      id: string;
      data: string | null;
      seq: number;
      updated_at: string;
      deleted: number;
    }[];
    return rows.map((r) => ({ kind: r.kind, id: r.id, seq: r.seq, updatedAt: r.updated_at, deleted: Boolean(r.deleted), data: r.data ? JSON.parse(r.data) : null }));
  }

  /** When a record was last written (also for deleted ones), for last-writer-wins on push. */
  updatedAt(kind: Kind, id: string, personId: string = this.ownerId): string | undefined {
    const row = this.db.prepare('SELECT updated_at FROM records WHERE person_id = ? AND kind = ? AND id = ?').get(personId, kind, id) as { updated_at: string } | undefined;
    return row?.updated_at;
  }

  getMeta(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  }

  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // ---- People -----------------------------------------------------------------------------

  person(id: string): Person | undefined {
    const row = this.db.prepare('SELECT id, email, name, role, status, created_at, last_seen_at FROM people WHERE id = ?').get(id) as PersonRow | undefined;
    return row && personOf(row);
  }

  listPeople(): Person[] {
    return (this.db.prepare('SELECT id, email, name, role, status, created_at, last_seen_at FROM people ORDER BY created_at').all() as PersonRow[]).map(personOf);
  }

  /** Add a person (step 2 of the design invites them); they start with a few activities like a new server. */
  addPerson(p: { email: string | null; name: string; role?: Person['role']; status?: Person['status'] }): Person {
    const id = crypto.randomUUID();
    this.db.prepare('INSERT INTO people (id, email, name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, p.email?.trim().toLowerCase() || null, p.name, p.role ?? 'member', p.status ?? 'invited', new Date().toISOString());
    this.seed(id);
    return this.person(id)!;
  }

  /** Change a person's email, name, role or status. An email is unique and kept lowercase. */
  updatePerson(id: string, patch: { email?: string | null; name?: string; role?: Person['role']; status?: Person['status'] }): Person | undefined {
    if (!this.person(id)) return undefined;
    if (patch.email !== undefined) this.db.prepare('UPDATE people SET email = ? WHERE id = ?').run(patch.email?.trim().toLowerCase() || null, id);
    if (patch.name !== undefined) this.db.prepare('UPDATE people SET name = ? WHERE id = ?').run(patch.name, id);
    if (patch.role !== undefined) this.db.prepare('UPDATE people SET role = ? WHERE id = ?').run(patch.role, id);
    if (patch.status !== undefined) this.db.prepare('UPDATE people SET status = ? WHERE id = ?').run(patch.status, id);
    return this.person(id);
  }

  // ---- Devices & pairing ------------------------------------------------------------------

  /** Create a device directly and return its key (shown once). */
  addDevice(name: string, client: string | null = null, personId: string = this.ownerId): { device: Device; key: string } {
    const key = `gnomon_${randomBytes(24).toString('base64url')}`;
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare('INSERT INTO devices (id, name, key_hash, created_at, client, person_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, sha256(key), createdAt, client, personId);
    return { device: { id, name, createdAt, lastSeenAt: null, revokedAt: null, client, admin: false, personId }, key };
  }

  /** The device a key belongs to, or undefined when the key is unknown or revoked. */
  authenticate(key: string): Device | undefined {
    const row = this.db.prepare(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE key_hash = ?`).get(sha256(key)) as DeviceRow | undefined;
    if (!row || row.revoked_at) return undefined;
    // A disabled person's devices stop working at once.
    const person = this.person(row.person_id);
    if (!person || person.status !== 'active') return undefined;
    const now = new Date().toISOString();
    // Only touch the rows once a minute, not on every request.
    if (!row.last_seen_at || Date.parse(now) - Date.parse(row.last_seen_at) > 60_000) {
      this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now, row.id);
      this.db.prepare("UPDATE people SET last_seen_at = ?, status = CASE status WHEN 'invited' THEN 'active' ELSE status END WHERE id = ?").run(now, row.person_id);
    }
    return { ...deviceOf(row), lastSeenAt: now };
  }

  listDevices(): Device[] {
    return (this.db.prepare(`SELECT ${DEVICE_COLUMNS} FROM devices ORDER BY created_at`).all() as DeviceRow[]).map(deviceOf);
  }

  /** Rename a device, or allow or forbid it to open the Admin page. */
  updateDevice(id: string, patch: { name?: string; admin?: boolean }): Device | undefined {
    const d = this.listDevices().find((x) => x.id === id && !x.revokedAt);
    if (!d) return undefined;
    if (patch.name !== undefined) this.db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(patch.name, id);
    if (patch.admin !== undefined) this.db.prepare('UPDATE devices SET is_admin = ? WHERE id = ?').run(patch.admin ? 1 : 0, id);
    return this.listDevices().find((x) => x.id === id);
  }

  /**
   * Whether a device may open the Admin page. With `claim`, a device asking while no connected device has the right yet
   * gets it: the server says when that's allowed (a private server, asked from a Mac), so the owner never needs the
   * terminal for it.
   */
  isAdminDevice(id: string, claim = false): boolean {
    const active = this.listDevices().filter((x) => !x.revokedAt);
    if (claim && !active.some((x) => x.admin) && active.some((x) => x.id === id)) this.db.prepare('UPDATE devices SET is_admin = 1 WHERE id = ?').run(id);
    return (this.db.prepare('SELECT is_admin FROM devices WHERE id = ? AND revoked_at IS NULL').get(id) as { is_admin: number } | undefined)?.is_admin === 1;
  }

  /** Record what a device is when it says so later (devices paired before this was recorded). */
  setDeviceClient(id: string, client: string) {
    this.db.prepare('UPDATE devices SET client = ? WHERE id = ? AND client IS NULL').run(client, id);
  }

  revokeDevice(idOrName: string): Device | undefined {
    const d = this.listDevices().find((x) => !x.revokedAt && (x.id === idOrName || x.id.startsWith(idOrName) || x.name === idOrName));
    if (!d) return undefined;
    this.db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), d.id);
    return d;
  }

  /** A short one-time code that a phone exchanges for a device key (POST /api/v1/pair). */
  createPairCode(deviceName: string, ttlMinutes = 10, personId: string = this.ownerId): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
    const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
    this.db.prepare('DELETE FROM pair_codes WHERE expires_at < ?').run(new Date().toISOString());
    this.db.prepare('INSERT INTO pair_codes (code_hash, device_name, expires_at, person_id) VALUES (?, ?, ?, ?)').run(sha256(code), deviceName, new Date(Date.now() + ttlMinutes * 60_000).toISOString(), personId);
    return code;
  }

  /** Redeem a pairing code: it works once, then a device with its own key exists. */
  redeemPairCode(code: string, client: string | null = null, nameFor: (given: string) => string = (g) => g || 'Device'): { device: Device; key: string } | undefined {
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const row = this.db.prepare('SELECT device_name, expires_at, person_id FROM pair_codes WHERE code_hash = ?').get(sha256(normalized)) as { device_name: string; expires_at: string; person_id: string | null } | undefined;
    if (!row) return undefined;
    this.db.prepare('DELETE FROM pair_codes WHERE code_hash = ?').run(sha256(normalized));
    if (row.expires_at < new Date().toISOString()) return undefined;
    // The code's person gets the device (a code from before people existed: the owner).
    return this.addDevice(nameFor(row.device_name), client, row.person_id ?? this.ownerId);
  }

  // ---- Feedback (a small help desk: the app writes, the Admin page answers) ----------------------

  /** A new conversation. The secret (shown once, kept by the app) lets the sender read the replies and write more. */
  createFeedback(text: string, info: { sender?: string; appVersion?: string; os?: string }): { id: string; secret: string } {
    const id = crypto.randomUUID();
    const secret = randomBytes(24).toString('base64url');
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO feedback_threads (id, secret_hash, sender, app_version, os, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, sha256(secret), info.sender ?? null, info.appVersion ?? null, info.os ?? null, now, now);
    this.db.prepare('INSERT INTO feedback_messages (thread_id, author, text, at) VALUES (?, ?, ?, ?)').run(id, 'user', text, now);
    return { id, secret };
  }

  /** True when the secret belongs to the conversation. */
  feedbackSecretOk(id: string, secret: string): boolean {
    const row = this.db.prepare('SELECT secret_hash FROM feedback_threads WHERE id = ?').get(id) as { secret_hash: string } | undefined;
    return Boolean(row && secret && timingSafeEqual(Buffer.from(row.secret_hash), Buffer.from(sha256(secret))));
  }

  /** Add a message; from the sender it reopens a finished conversation. */
  addFeedbackMessage(id: string, author: 'user' | 'admin', text: string) {
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO feedback_messages (thread_id, author, text, at) VALUES (?, ?, ?, ?)').run(id, author, text, now);
    if (author === 'user') this.db.prepare("UPDATE feedback_threads SET updated_at = ?, status = CASE status WHEN 'done' THEN 'open' ELSE status END WHERE id = ?").run(now, id);
    else this.db.prepare("UPDATE feedback_threads SET updated_at = ?, admin_seen_at = ?, status = CASE status WHEN 'new' THEN 'open' ELSE status END WHERE id = ?").run(now, now, id);
  }

  setFeedbackStatus(id: string, status: 'new' | 'open' | 'done') {
    this.db.prepare('UPDATE feedback_threads SET status = ? WHERE id = ?').run(status, id);
  }

  markFeedbackSeen(id: string) {
    this.db.prepare('UPDATE feedback_threads SET admin_seen_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  feedbackThread(id: string) {
    const t = this.db.prepare('SELECT id, status, sender, app_version, os, created_at, updated_at, admin_seen_at FROM feedback_threads WHERE id = ?').get(id) as
      | { id: string; status: string; sender: string | null; app_version: string | null; os: string | null; created_at: string; updated_at: string; admin_seen_at: string | null }
      | undefined;
    if (!t) return undefined;
    const messages = this.db.prepare('SELECT author, text, at FROM feedback_messages WHERE thread_id = ? ORDER BY id').all(id) as { author: 'user' | 'admin'; text: string; at: string }[];
    return { id: t.id, status: t.status, sender: t.sender, appVersion: t.app_version, os: t.os, createdAt: t.created_at, updatedAt: t.updated_at, unread: !t.admin_seen_at || messages.some((m) => m.author === 'user' && m.at > t.admin_seen_at!), messages };
  }

  /** All conversations, newest activity first, with their first and last message for the list. */
  listFeedback() {
    const ids = this.db.prepare('SELECT id FROM feedback_threads ORDER BY updated_at DESC').all() as { id: string }[];
    return ids.map(({ id }) => {
      const t = this.feedbackThread(id)!;
      return { ...t, messages: undefined, first: t.messages[0]?.text ?? '', last: t.messages.at(-1) ?? null, count: t.messages.length };
    });
  }

  deleteFeedback(id: string) {
    this.db.prepare('DELETE FROM feedback_messages WHERE thread_id = ?').run(id);
    this.db.prepare('DELETE FROM feedback_threads WHERE id = ?').run(id);
  }

  // ---- Passwords, invitations and who may register (docs/accounts-design.md, step 2) ------------

  /** A person's password. Only a salted scrypt hash is kept; the password itself never is. */
  setPassword(personId: string, password: string) {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
    this.db.prepare('UPDATE people SET password_hash = ? WHERE id = ?').run(`scrypt$16384$${salt.toString('base64')}$${hash.toString('base64')}`, personId);
    // A new password ends every open reset link.
    this.db.prepare('DELETE FROM password_resets WHERE person_id = ?').run(personId);
  }

  hasPassword(personId: string): boolean {
    return Boolean((this.db.prepare('SELECT password_hash FROM people WHERE id = ?').get(personId) as { password_hash: string | null } | undefined)?.password_hash);
  }

  checkPassword(personId: string, password: string): boolean {
    const stored = (this.db.prepare('SELECT password_hash FROM people WHERE id = ?').get(personId) as { password_hash: string | null } | undefined)?.password_hash;
    const [kind, n, salt, hash] = (stored ?? '').split('$');
    if (kind !== 'scrypt' || !salt || !hash) return false;
    const want = Buffer.from(hash, 'base64');
    const got = scryptSync(password, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: 8, p: 1 });
    return timingSafeEqual(want, got);
  }

  personByEmail(email: string): Person | undefined {
    const row = this.db.prepare('SELECT id FROM people WHERE email = ?').get(email.trim().toLowerCase()) as { id: string } | undefined;
    return row && this.person(row.id);
  }

  /**
   * An invitation for a person: a one-time code (in a link), valid for as many days as the server says (see
   * inviteDays). A new one replaces older ones. An expired one stays until then, so the People page can say so.
   */
  createInvite(personId: string, days = this.inviteDays()): { code: string; expiresAt: string } {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join('');
    const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
    this.db.prepare('DELETE FROM invites WHERE person_id = ?').run(personId);
    this.db.prepare('INSERT INTO invites (code_hash, person_id, expires_at) VALUES (?, ?, ?)').run(sha256(code), personId, expiresAt);
    return { code, expiresAt };
  }

  /** When a person's open invitation runs (or ran) out, or null when there is none. */
  inviteExpiresAt(personId: string): string | null {
    return (this.db.prepare('SELECT MAX(expires_at) AS at FROM invites WHERE person_id = ?').get(personId) as { at: string | null }).at;
  }

  /** How many days an invitation is valid: the admin sets it under People, 14 by default. */
  inviteDays(): number {
    const v = Number(this.getMeta('inviteDays'));
    return Number.isInteger(v) && v >= 1 && v <= 90 ? v : 14;
  }

  setInviteDays(days: number) {
    this.setMeta('inviteDays', String(days));
  }

  // ---- Password resets --------------------------------------------------------------------------

  /** A reset link's token: long and random, only its hash is kept, and it works once within `minutes`. */
  createReset(personId: string, minutes = 30): string {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(new Date().toISOString());
    this.db.prepare('INSERT INTO password_resets (token_hash, person_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), personId, new Date(Date.now() + minutes * 60_000).toISOString());
    return token;
  }

  /** Whose reset token this is, without using it, or undefined when unknown or expired. */
  resetFor(token: string): Person | undefined {
    const row = this.db.prepare('SELECT person_id, expires_at FROM password_resets WHERE token_hash = ?').get(sha256(token)) as { person_id: string; expires_at: string } | undefined;
    return row && row.expires_at > new Date().toISOString() ? this.person(row.person_id) : undefined;
  }

  /** Use a reset token up: returns its person once, and ends every other open link of theirs. */
  useReset(token: string): Person | undefined {
    const person = this.resetFor(token);
    this.db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(sha256(token));
    if (person) this.db.prepare('DELETE FROM password_resets WHERE person_id = ?').run(person.id);
    return person;
  }

  /** Who an invitation is for (without using it up), or undefined when unknown or expired. */
  inviteFor(code: string): Person | undefined {
    const row = this.db.prepare('SELECT person_id, expires_at FROM invites WHERE code_hash = ?').get(sha256(code.toUpperCase().replace(/[^A-Z0-9]/g, ''))) as { person_id: string; expires_at: string } | undefined;
    return row && row.expires_at > new Date().toISOString() ? this.person(row.person_id) : undefined;
  }

  useInvite(code: string) {
    this.db.prepare('DELETE FROM invites WHERE code_hash = ?').run(sha256(code.toUpperCase().replace(/[^A-Z0-9]/g, '')));
  }

  /** Who may register: invited people only (the default), anyone with an admin's approval, or anyone. */
  registration(): 'invite' | 'approval' | 'open' {
    const v = this.getMeta('registration');
    return v === 'approval' || v === 'open' ? v : 'invite';
  }

  setRegistration(v: 'invite' | 'approval' | 'open') {
    this.setMeta('registration', v);
  }

  /** Remove a person and everything that's theirs: records, devices, invitations. The owner can't be removed. */
  removePerson(id: string): boolean {
    if (id === this.ownerId || !this.person(id)) return false;
    this.db.transaction(() => {
      for (const t of ['records', 'devices', 'pair_codes', 'invites', 'password_resets']) this.db.prepare(`DELETE FROM ${t} WHERE person_id = ?`).run(id);
      this.db.prepare('DELETE FROM meta WHERE key IN (?, ?, ?)').run(`settings:${id}`, `seeded:${id}`, `account:${id}`);
      this.db.prepare('DELETE FROM people WHERE id = ?').run(id);
    })();
    this.slots.delete(id);
    return true;
  }

  // ---- Admin access (setup wizard and Admin page, see company.ts) --------------------------

  /**
   * A one-time code for the setup wizard ('setup'), the Admin page ('admin', or 'admin:<person>' for that person) or
   * someone's account page ('account:<person>'), shown as a link.
   */
  createAdminCode(purpose: string, ttlMinutes = 60): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
    this.db.prepare('DELETE FROM admin_codes WHERE expires_at < ?').run(new Date().toISOString());
    this.db.prepare('INSERT INTO admin_codes (code_hash, purpose, expires_at) VALUES (?, ?, ?)').run(sha256(code), purpose, new Date(Date.now() + ttlMinutes * 60_000).toISOString());
    return code;
  }

  /** Redeem an admin code once; returns its purpose, or undefined when unknown or expired. */
  redeemAdminCode(code: string): string | undefined {
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const row = this.db.prepare('SELECT purpose, expires_at FROM admin_codes WHERE code_hash = ?').get(sha256(normalized)) as { purpose: string; expires_at: string } | undefined;
    if (!row) return undefined;
    this.db.prepare('DELETE FROM admin_codes WHERE code_hash = ?').run(sha256(normalized));
    return row.expires_at < new Date().toISOString() ? undefined : row.purpose;
  }

  /** Setup codes stop working once the wizard is finished. */
  clearAdminCodes(purpose?: string) {
    if (purpose) this.db.prepare('DELETE FROM admin_codes WHERE purpose = ?').run(purpose);
    else this.db.prepare('DELETE FROM admin_codes').run();
  }

  /** After too many wrong guesses every open code is dropped, so codes can't be brute-forced. */
  clearPairCodes() {
    this.db.prepare('DELETE FROM pair_codes').run();
  }
}
