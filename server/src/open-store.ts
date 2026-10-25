// Opening the database at start (server and gnomon-admin): with the data key when one is set, encrypting an
// unencrypted database first (data-key.ts). A pre-encryption backup is made when a backup password is set.
import Database from 'better-sqlite3-multiple-ciphers';
import path from 'node:path';
import type { PublicBackupKey } from './backup-crypto';
import { writeBackup } from './backups';
import { encryptInPlace, isEncryptedFile, loadDataKey, plainCopies, type DataKey, type Migration } from './data-key';
import { databaseFile, Store } from './store';

export type Encryption = { encrypted: boolean; keySource: DataKey['source'] | null; plainCopies: string[] };

export function openStore(dataDir: string, log: (msg: string) => void = console.log): { store: Store; dbFile: string; key?: DataKey; migration?: Migration } {
  const dbFile = databaseFile(dataDir);
  const key = loadDataKey();
  let migration: Migration | undefined;
  if (key && isEncryptedFile(dbFile) === false) {
    log('Encrypting the database with GNOMON_DATA_KEY (once)…');
    migration = encryptInPlace(dbFile, key.raw, (image) => {
      const backupKey = backupKeyIn(image);
      return backupKey ? writeBackup(path.join(dataDir, 'backups'), 'pre-encryption', image, backupKey) : undefined;
    });
    if (migration.backedUp) log(`Encrypted. The backup from before is backups/${migration.backedUp} (restore it with the backup password to go back).`);
    else log(`Encrypted. The unencrypted database from before is kept as ${path.basename(migration.kept!)}: delete it once all is well, since it isn’t encrypted.`);
  }
  return { store: new Store(dbFile, key?.raw), dbFile, key, migration };
}

/** The backup password's public key, read from an unencrypted database image. */
function backupKeyIn(image: Buffer): PublicBackupKey | undefined {
  const copy = Buffer.from(image);
  copy[18] = copy[19] = 1; // a WAL-mode image only opens in memory as a rollback-journal one
  const db = new Database(copy);
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'backupKey'").get() as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as PublicBackupKey) : undefined;
  } catch {
    return undefined; // no meta table yet
  } finally {
    db.close();
  }
}

/** What the status and the Admin page show. */
export function encryptionStatus(store: Store, dataDir: string, dbFile: string, key?: DataKey): Encryption {
  return { encrypted: store.encrypted, keySource: key?.source ?? null, plainCopies: plainCopies(dataDir, dbFile) };
}
