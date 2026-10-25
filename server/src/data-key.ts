// Encryption at rest (docs/admin-guide.md#encryption-at-rest): the whole database, its WAL and every copy the server
// makes are encrypted with SQLCipher (AES-256) under GNOMON_DATA_KEY. The key lives outside the database: in the
// environment (.env), or a file such as a Docker secret (GNOMON_DATA_KEY_FILE). Never next to the data, so a copied
// disk, database file or backup can't be read. The server itself still reads everything: it's not end-to-end.
// Without a key the server runs unencrypted and says so; an encrypted database never opens without its key.
import Database from 'better-sqlite3-multiple-ciphers';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MIN_DATA_KEY = 32;
const SQLITE_HEADER = Buffer.from('SQLite format 3\0');

export type DataKey = { raw: Buffer; source: 'env' | 'file' };

export class DataKeyError extends Error {
  constructor(
    readonly code: 'missing_key' | 'wrong_key' | 'weak_key' | 'key_file' | 'not_encrypted' | 'migration_failed',
    message: string,
  ) {
    super(message);
  }
}

/** The data key from GNOMON_DATA_KEY or GNOMON_DATA_KEY_FILE, or undefined when neither is set. */
export function loadDataKey(env: NodeJS.ProcessEnv = process.env): DataKey | undefined {
  let value = env.GNOMON_DATA_KEY?.trim();
  let source: DataKey['source'] = 'env';
  const file = env.GNOMON_DATA_KEY_FILE?.trim();
  if (!value && file) {
    try {
      value = fs.readFileSync(file, 'utf8').trim();
    } catch (e) {
      throw new DataKeyError('key_file', `Can't read the data key file ${file} (GNOMON_DATA_KEY_FILE): ${(e as Error).message}`);
    }
    source = 'file';
  }
  if (!value) return undefined;
  return { raw: rawKey(value), source };
}

/** Any long string becomes a 256-bit key. It is already random (newDataKey), so SQLCipher's slow derivation isn't needed. */
export function rawKey(value: string): Buffer {
  if (value.length < MIN_DATA_KEY) throw new DataKeyError('weak_key', `GNOMON_DATA_KEY needs at least ${MIN_DATA_KEY} characters (gnomon-admin rotate-data-key --new makes one)`);
  return createHash('sha256').update(`gnomon-data-key v1\0${value}`).digest();
}

/** A new data key: 48 letters and digits (about 285 bits). */
export function newDataKey(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  while (s.length < 48) for (const b of randomBytes(64)) if (b < 220 && s.length < 48) s += abc[b % 55]; // 220 = 4 × 55, no bias
  return s;
}

/** Whether a database file is encrypted; undefined when there is none yet (or it's empty). */
export function isEncryptedFile(file: string): boolean | undefined {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) return undefined;
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    return !head.equals(SQLITE_HEADER);
  } finally {
    fs.closeSync(fd);
  }
}

const keyPragma = (raw: Buffer) => `key = "x'${raw.toString('hex')}'"`;

/** Set the cipher and key on a just-opened connection, and check that the key opens it. */
export function applyKey(db: Database.Database, raw: Buffer) {
  db.pragma("cipher = 'sqlcipher'");
  db.pragma('legacy = 4');
  db.pragma(keyPragma(raw));
  try {
    db.prepare('SELECT count(*) FROM sqlite_master').get();
  } catch (e) {
    if ((e as { code?: string }).code === 'SQLITE_NOTADB') throw new DataKeyError('wrong_key', 'GNOMON_DATA_KEY doesn’t open this database. Is it the key from when the data was encrypted (in .env or your password manager)?');
    throw e;
  }
}

/** Encrypt (or re-encrypt) a closed database file in place with `to`; `from` is its current key, if any. */
export function rekeyFile(file: string, from: Buffer | undefined, to: Buffer) {
  const db = new Database(file);
  try {
    if (from) applyKey(db, from);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('journal_mode = DELETE'); // SQLCipher can't rekey in WAL mode
    if (!from) {
      db.pragma("cipher = 'sqlcipher'");
      db.pragma('legacy = 4');
    }
    db.pragma(`re${keyPragma(to)}`);
    db.pragma('journal_mode = WAL');
  } finally {
    db.close();
  }
}

/** Row counts of every table, to check a copy against its source. */
function counts(db: Database.Database): Record<string, number> {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  return Object.fromEntries(tables.map((t) => [t.name, (db.prepare(`SELECT count(*) AS n FROM "${t.name}"`).get() as { n: number }).n]));
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

export type Migration = { kept?: string; backedUp?: string };

/**
 * First start with a key on an unencrypted database: encrypt it. A copy is encrypted next to it and checked (integrity,
 * the same rows in every table) before it replaces the original in one rename, so a failure leaves the data as it
 * was. Before that, `backup` (when a backup password is set) makes an encrypted backup to go back to; without one,
 * the unencrypted original is kept as gnomon.db.before-encryption-<time> until the admin deletes it.
 */
export function encryptInPlace(file: string, key: Buffer, backup?: (plain: Buffer) => string | undefined): Migration {
  const tmp = `${file}.encrypting`;
  fs.rmSync(tmp, { force: true });
  const src = new Database(file);
  let before: Record<string, number>;
  let image: Buffer;
  try {
    src.pragma('wal_checkpoint(TRUNCATE)');
    before = counts(src);
    image = src.serialize();
  } finally {
    src.close();
  }
  try {
    const backedUp = backup?.(image);
    fs.writeFileSync(tmp, image, { mode: 0o600 });
    rekeyFile(tmp, undefined, key);
    const check = new Database(tmp);
    try {
      applyKey(check, key);
      const ok = check.pragma('integrity_check', { simple: true });
      if (ok !== 'ok') throw new Error(`the encrypted copy failed its check (${String(ok)})`);
      if (JSON.stringify(counts(check)) !== JSON.stringify(before)) throw new Error('the encrypted copy doesn’t have the same rows');
    } finally {
      check.close();
    }
    if (isEncryptedFile(tmp) !== true) throw new Error('the copy isn’t encrypted');
    let kept: string | undefined;
    if (!backedUp) {
      kept = `${file}.before-encryption-${stamp()}`;
      fs.copyFileSync(file, kept);
      fs.chmodSync(kept, 0o600);
    }
    for (const ext of ['-wal', '-shm']) fs.rmSync(file + ext, { force: true });
    fs.renameSync(tmp, file);
    return { kept, backedUp };
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new DataKeyError('migration_failed', `Couldn’t encrypt the database, so it’s unchanged and still unencrypted: ${(e as Error).message}`);
  }
}

/**
 * Unencrypted database copies left in the data folder (from before encryption, before a restore, or a plain backup):
 * they hold everyone's data in the clear, so the status shows them until they're deleted.
 */
export function plainCopies(dataDir: string, dbFile: string): string[] {
  const out: string[] = [];
  for (const dir of [dataDir, path.join(dataDir, 'backups')]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const f = path.join(dir, name);
      if (f === dbFile || name.endsWith('-wal') || name.endsWith('-shm') || !/\.db($|[.-])/.test(name) || !fs.statSync(f).isFile()) continue;
      if (isEncryptedFile(f) === false) out.push(path.relative(dataDir, f));
    }
  }
  return out.sort();
}
