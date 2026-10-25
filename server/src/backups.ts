// Nightly encrypted backups in the data folder (`<data>/backups`), the last 14 kept by default, and restoring one.
// Each file is the whole database (consistent while the server runs), gzipped and encrypted for the backup password's
// public key (backup-crypto.ts): the server can make backups but not read them.
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { backupKeyFor, decryptFile, encryptFile, passwordMatches, readHeader, type PublicBackupKey } from './backup-crypto';
import type { Store } from './store';

export type BackupSettings = { enabled: boolean; hour: number; keep: number };
export type BackupFile = { name: string; size: number; at: string };
export type BackupStatus = BackupSettings & {
  keySet: boolean;
  keySetAt?: string;
  files: BackupFile[];
  last?: { at: string; ok: boolean; file?: string; error?: string };
};

const DEFAULTS: BackupSettings = { enabled: true, hour: 2, keep: 14 };
const EXT = '.gnomonbak';
const NAME = /^gnomon-\d{8}-\d{6}(-[a-z0-9-]{1,24})?\.gnomonbak$/;
export const MIN_PASSWORD = 12;

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const localDay = (d: Date) => stamp(d).slice(0, 8);

export class Backups {
  readonly dir: string;
  private timer?: NodeJS.Timeout;
  private running?: Promise<BackupFile>;

  constructor(
    private store: Store,
    dataDir: string,
  ) {
    this.dir = path.join(dataDir, 'backups');
  }

  settings(): BackupSettings {
    const raw = this.store.getMeta('backups');
    const s = raw ? (JSON.parse(raw) as Partial<BackupSettings>) : {};
    return { ...DEFAULTS, ...s };
  }

  saveSettings(u: Record<string, unknown>): BackupSettings {
    const s = this.settings();
    if (typeof u.enabled === 'boolean') s.enabled = u.enabled;
    if (u.hour !== undefined) {
      if (!(typeof u.hour === 'number' && Number.isInteger(u.hour) && u.hour >= 0 && u.hour <= 23)) throw new Error('The hour must be 0 to 23');
      s.hour = u.hour;
    }
    if (u.keep !== undefined) {
      if (!(typeof u.keep === 'number' && Number.isInteger(u.keep) && u.keep >= 1 && u.keep <= 365)) throw new Error('Keep 1 to 365 backups');
      s.keep = u.keep;
    }
    this.store.setMeta('backups', JSON.stringify(s));
    return s;
  }

  key(): PublicBackupKey | undefined {
    const raw = this.store.getMeta('backupKey');
    return raw ? (JSON.parse(raw) as PublicBackupKey & { setAt?: string }) : undefined;
  }

  /**
   * Set the backup password: only its public key is stored. Changing it needs the current one, unless `force` (the
   * command line, where whoever runs it has the whole server anyway). Older backups keep needing the old password.
   */
  setPassword(password: string, current?: string, force = false) {
    if (password.length < MIN_PASSWORD || password.length > 200) throw new Error(`The backup password needs at least ${MIN_PASSWORD} characters`);
    const old = this.key();
    if (old && !force && !(current && passwordMatches(current, old))) throw new Error('The current backup password isn’t right');
    this.store.setMeta('backupKey', JSON.stringify({ ...backupKeyFor(password), setAt: new Date().toISOString() }));
  }

  checkPassword(password: string): boolean {
    const k = this.key();
    return Boolean(k && passwordMatches(password, k));
  }

  list(): BackupFile[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((n) => NAME.test(n))
      .map((name) => {
        const st = fs.statSync(path.join(this.dir, name));
        return { name, size: st.size, at: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  /** The path of a backup by name, only inside the folder. */
  file(name: string): string | undefined {
    if (!NAME.test(name)) return undefined;
    const f = path.join(this.dir, name);
    return fs.existsSync(f) ? f : undefined;
  }

  status(): BackupStatus {
    const k = this.key() as (PublicBackupKey & { setAt?: string }) | undefined;
    const last = this.store.getMeta('backupLast');
    return { ...this.settings(), keySet: Boolean(k), keySetAt: k?.setAt, files: this.list(), last: last ? JSON.parse(last) : undefined };
  }

  /** Make a backup now. `label` ends up in the name (nightly, manual, pre-update). Only one runs at a time. */
  run(label = 'manual'): Promise<BackupFile> {
    if (this.running) return this.running;
    this.running = this.make(label).finally(() => (this.running = undefined));
    return this.running;
  }

  private async make(label: string): Promise<BackupFile> {
    const key = this.key();
    try {
      if (!key) throw new Error('No backup password is set yet');
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const now = new Date();
      const base = `gnomon-${stamp(now)}-${label.replace(/[^a-z-]/g, '').slice(0, 20) || 'manual'}`;
      let name = `${base}${EXT}`;
      for (let i = 2; fs.existsSync(path.join(this.dir, name)); i++) name = `${base}-${i}${EXT}`; // two in the same second
      const tmp = path.join(this.dir, `.${name}.db`);
      try {
        await this.store.backup(tmp);
        const sealed = encryptFile(gzipSync(fs.readFileSync(tmp)), key);
        fs.writeFileSync(path.join(this.dir, `.${name}`), sealed, { mode: 0o600 });
        fs.renameSync(path.join(this.dir, `.${name}`), path.join(this.dir, name));
      } finally {
        fs.rmSync(tmp, { force: true });
      }
      this.prune();
      this.store.setMeta('backupLast', JSON.stringify({ at: now.toISOString(), ok: true, file: name }));
      const st = fs.statSync(path.join(this.dir, name));
      return { name, size: st.size, at: st.mtime.toISOString() };
    } catch (e) {
      this.store.setMeta('backupLast', JSON.stringify({ at: new Date().toISOString(), ok: false, error: (e as Error).message }));
      throw e;
    }
  }

  /** Keep the newest `keep` backups; older ones are deleted. */
  private prune() {
    const { keep } = this.settings();
    for (const f of this.list().slice(keep)) fs.rmSync(path.join(this.dir, f.name), { force: true });
  }

  /** Every few minutes: once a day, at or after the set hour (server time zone), if none was made yet that day. */
  schedule(log: (msg: string) => void = console.log) {
    const tick = () => {
      const s = this.settings();
      const now = new Date();
      if (!s.enabled || !this.key() || now.getHours() < s.hour) return;
      const today = localDay(now);
      if (this.store.getMeta('backupNightly') === today) return;
      this.store.setMeta('backupNightly', today); // also on failure: tried once today, the status shows the error
      this.run('nightly').then(
        (f) => log(`Backup: ${f.name} (${Math.round(f.size / 1024)} KB)`),
        (e) => log(`Backup failed: ${(e as Error).message}`),
      );
    };
    this.timer = setInterval(tick, 5 * 60_000);
    this.timer.unref();
    setTimeout(tick, 30_000).unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

/** Decrypt a backup into a database file's bytes (checked to be SQLite). */
export function openBackup(file: Buffer, password: string): { db: Buffer; created: string } {
  const { payload, created } = decryptFile(file, password);
  const db = gunzipSync(payload);
  if (!db.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) throw new Error('The backup doesn’t contain a Gnomon database');
  return { db, created };
}

/**
 * Replace the database with a backup. Only while the server is stopped (gnomon-admin restore does that). The current
 * database is kept next to it as gnomon.db.before-restore-<time>, in case the wrong backup was picked.
 */
export function restoreBackup(dbFile: string, backup: Buffer, password: string): { created: string; kept?: string } {
  const { db, created } = openBackup(backup, password);
  let kept: string | undefined;
  if (fs.existsSync(dbFile)) {
    kept = `${dbFile}.before-restore-${stamp(new Date())}`;
    fs.copyFileSync(dbFile, kept);
    fs.chmodSync(kept, 0o600);
    // Changes not yet folded into the database file, in case the server didn't stop cleanly.
    if (fs.existsSync(`${dbFile}-wal`)) fs.copyFileSync(`${dbFile}-wal`, `${kept}-wal`);
  }
  const tmp = `${dbFile}.restoring`;
  fs.writeFileSync(tmp, db, { mode: 0o600 });
  for (const ext of ['-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
  fs.renameSync(tmp, dbFile);
  return { created, kept };
}

export { readHeader };
