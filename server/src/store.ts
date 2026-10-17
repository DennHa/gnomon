// SQLite storage for one person's Gnomon data.
//
// The REST logic is the Mac app's own (src/api.ts + src/actions.ts), which works on a whole `Data` object.
// So the store keeps the current Data in memory (this process is the only writer) and, on every commit,
// writes just the records that changed. Each write gets a new `seq` from a counter: "give me everything after
// seq N" is how a client (the Mac app) syncs, without trusting clocks. Deletions leave a tombstone row.
import Database from 'better-sqlite3';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Activity, Data, Entry, Project, Settings, Workday } from '../../src/types';

export const KINDS = ['projects', 'activities', 'entries', 'workdays'] as const;
export type Kind = (typeof KINDS)[number];
type AnyRecord = Project | Activity | Entry | Workday;

/** The key of a record within its kind: workdays are keyed by date, everything else by id. */
export const keyOf = (kind: Kind, r: AnyRecord): string => (kind === 'workdays' ? (r as Workday).date : (r as { id: string }).id);

export type Change = { kind: Kind; id: string; seq: number; updatedAt: string; deleted: boolean; data: AnyRecord | null };

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

export type Device = { id: string; name: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null };

export class Store {
  private db: Database.Database;
  private data: Data;
  /** The last committed version of each record, as JSON, to find what changed. */
  private snapshot = new Map<string, string>();

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT,
        seq INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (kind, id)
      );
      CREATE INDEX IF NOT EXISTS records_seq ON records(seq);
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
    `);
    if (file !== ':memory:') for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
    this.data = this.load();
    if (!this.getMeta('seeded')) {
      // A fresh server gets a few activities so the phone has chips to tap; the Mac's list replaces them on first sync.
      const activities = DEFAULT_ACTIVITIES.map((a) => ({ id: crypto.randomUUID(), ...a }));
      this.commit({ ...this.data, activities });
      this.setMeta('seeded', '1');
    }
  }

  close() {
    this.db.close();
  }

  /** A consistent copy of the database while the server keeps running. */
  backup(file: string): Promise<unknown> {
    return this.db.backup(file);
  }

  // ---- Data -------------------------------------------------------------------------------

  private load(): Data {
    const data: Data = { version: 1, projects: [], activities: [], entries: [], workdays: [], plan: [], reviewedWeeks: [], settings: { ...DEFAULT_SETTINGS } };
    const rows = this.db.prepare('SELECT kind, id, data FROM records WHERE deleted = 0').all() as { kind: Kind; id: string; data: string }[];
    for (const r of rows) {
      if (!KINDS.includes(r.kind)) continue;
      (data[r.kind] as AnyRecord[]).push(JSON.parse(r.data));
      this.snapshot.set(`${r.kind}:${r.id}`, r.data);
    }
    const settings = this.getMeta('settings');
    if (settings) data.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(settings) };
    return data;
  }

  get(): Data {
    return this.data;
  }

  /**
   * Persist a new Data, writing only the records that changed. Returns how many rows were written.
   * `stamp` is when each change happened: now, or (for changes pushed by a syncing client) the client's own time.
   */
  commit(next: Data, stamp: string | ((kind: Kind, id: string) => string) = new Date().toISOString()): number {
    const at = typeof stamp === 'string' ? () => stamp : stamp;
    let written = 0;
    const tx = this.db.transaction(() => {
      if (JSON.stringify(next.settings) !== JSON.stringify(this.data.settings)) this.setMeta('settings', JSON.stringify(next.settings));
      const upsert = this.db.prepare('INSERT INTO records (kind, id, data, seq, updated_at, deleted) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, seq = excluded.seq, updated_at = excluded.updated_at, deleted = 0');
      const tomb = this.db.prepare('UPDATE records SET data = NULL, seq = ?, updated_at = ?, deleted = 1 WHERE kind = ? AND id = ?');
      for (const kind of KINDS) {
        const seen = new Set<string>();
        for (const r of next[kind] as AnyRecord[]) {
          const id = keyOf(kind, r);
          const k = `${kind}:${id}`;
          seen.add(k);
          const json = JSON.stringify(r);
          if (this.snapshot.get(k) === json) continue;
          upsert.run(kind, id, json, this.nextSeq(), at(kind, id));
          this.snapshot.set(k, json);
          written++;
        }
        for (const k of [...this.snapshot.keys()]) {
          if (!k.startsWith(`${kind}:`) || seen.has(k)) continue;
          const id = k.slice(kind.length + 1);
          tomb.run(this.nextSeq(), at(kind, id), kind, id);
          this.snapshot.delete(k);
          written++;
        }
      }
    });
    tx();
    this.data = next;
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

  /** Everything written after `since`, oldest first. */
  changesSince(since: number, limit = 5000): Change[] {
    const rows = this.db.prepare('SELECT kind, id, data, seq, updated_at, deleted FROM records WHERE seq > ? ORDER BY seq LIMIT ?').all(since, limit) as {
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
  updatedAt(kind: Kind, id: string): string | undefined {
    const row = this.db.prepare('SELECT updated_at FROM records WHERE kind = ? AND id = ?').get(kind, id) as { updated_at: string } | undefined;
    return row?.updated_at;
  }

  private getMeta(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  }

  private setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // ---- Devices & pairing ------------------------------------------------------------------

  /** Create a device directly and return its key (shown once). */
  addDevice(name: string): { device: Device; key: string } {
    const key = `gnomon_${randomBytes(24).toString('base64url')}`;
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare('INSERT INTO devices (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)').run(id, name, sha256(key), createdAt);
    return { device: { id, name, createdAt, lastSeenAt: null, revokedAt: null }, key };
  }

  /** The device a key belongs to, or undefined when the key is unknown or revoked. */
  authenticate(key: string): Device | undefined {
    const row = this.db.prepare('SELECT id, name, created_at, last_seen_at, revoked_at FROM devices WHERE key_hash = ?').get(sha256(key)) as
      | { id: string; name: string; created_at: string; last_seen_at: string | null; revoked_at: string | null }
      | undefined;
    if (!row || row.revoked_at) return undefined;
    const now = new Date().toISOString();
    // Only touch the row once a minute, not on every request.
    if (!row.last_seen_at || Date.parse(now) - Date.parse(row.last_seen_at) > 60_000) this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now, row.id);
    return { id: row.id, name: row.name, createdAt: row.created_at, lastSeenAt: now, revokedAt: null };
  }

  listDevices(): Device[] {
    const rows = this.db.prepare('SELECT id, name, created_at, last_seen_at, revoked_at FROM devices ORDER BY created_at').all() as {
      id: string;
      name: string;
      created_at: string;
      last_seen_at: string | null;
      revoked_at: string | null;
    }[];
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastSeenAt: r.last_seen_at, revokedAt: r.revoked_at }));
  }

  revokeDevice(idOrName: string): Device | undefined {
    const d = this.listDevices().find((x) => !x.revokedAt && (x.id === idOrName || x.id.startsWith(idOrName) || x.name === idOrName));
    if (!d) return undefined;
    this.db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), d.id);
    return d;
  }

  /** A short one-time code that a phone exchanges for a device key (POST /api/v1/pair). */
  createPairCode(deviceName: string, ttlMinutes = 10): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
    const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
    this.db.prepare('DELETE FROM pair_codes WHERE expires_at < ?').run(new Date().toISOString());
    this.db.prepare('INSERT INTO pair_codes (code_hash, device_name, expires_at) VALUES (?, ?, ?)').run(sha256(code), deviceName, new Date(Date.now() + ttlMinutes * 60_000).toISOString());
    return code;
  }

  /** Redeem a pairing code: it works once, then a device with its own key exists. */
  redeemPairCode(code: string): { device: Device; key: string } | undefined {
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const row = this.db.prepare('SELECT device_name, expires_at FROM pair_codes WHERE code_hash = ?').get(sha256(normalized)) as { device_name: string; expires_at: string } | undefined;
    if (!row) return undefined;
    this.db.prepare('DELETE FROM pair_codes WHERE code_hash = ?').run(sha256(normalized));
    if (row.expires_at < new Date().toISOString()) return undefined;
    return this.addDevice(row.device_name);
  }

  /** After too many wrong guesses every open code is dropped, so codes can't be brute-forced. */
  clearPairCodes() {
    this.db.prepare('DELETE FROM pair_codes').run();
  }
}
