// Entry point: `node dist/server.mjs`. Configuration comes from environment variables (see README.md).
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { printPairing } from './qr-terminal';
import { DataKeyError } from './data-key';
import { encryptionStatus, openStore } from './open-store';
import { Company, loadSecretKey } from './company';
import { terminalQr } from './qr-terminal';
import { Backups } from './backups';
import { VERSION } from './version';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.GNOMON_DATA_DIR ?? './data');
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

// Encrypted at rest with GNOMON_DATA_KEY (data-key.ts); a database without encryption is encrypted on the first start
// with a key. A wrong or missing key stops here with the reason, never with an empty database.
const opened = (() => {
  try {
    return openStore(dataDir);
  } catch (e) {
    if (!(e instanceof DataKeyError)) throw e;
    console.error(`Gnomon can't start: ${e.message}`);
    process.exit(1);
  }
})();
const { store, dbFile, key: dataKey } = opened;
// Optional download page for the Mac app (/latest); see src/releases.ts.
const releasesDir = process.env.GNOMON_RELEASES_DIR ? path.resolve(process.env.GNOMON_RELEASES_DIR) : undefined;
const demoDir = process.env.GNOMON_DEMO_DIR ? path.resolve(process.env.GNOMON_DEMO_DIR) : undefined;
const siteDir = process.env.GNOMON_SITE_DIR ? path.resolve(process.env.GNOMON_SITE_DIR) : undefined;
// Company setup: settings and encrypted tokens for the wizard (src/company.ts).
const secret = loadSecretKey(dataDir);
const company = new Company(store, secret.key, secret.source);
// Nightly encrypted backups into <data>/backups (src/backups.ts), once a backup password is set.
const backups = new Backups(store, dataDir);
backups.schedule();
const server = http.createServer(
  createApp({ store, webDir: path.join(here, 'web'), releasesDir, company, demoDir, siteDir, roadmapDir: path.join(here, 'roadmap'), backups, macAppDir: path.join(dataDir, 'releases'), encryption: () => encryptionStatus(store, dataDir, dbFile, dataKey), https: process.env.GNOMON_HTTPS?.trim() || undefined }),
);
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(port, host, () => {
  const devices = store.listDevices().filter((d) => !d.revokedAt).length;
  console.log(`Gnomon ${VERSION} on http://${host}:${port} (data: ${dataDir}, timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}, devices: ${devices})`);
  // Until the company setup is finished, the log shows a one-time link to the setup wizard (60 minutes; a restart
  // makes a new one). Personal use can ignore it: pairing devices works without the wizard.
  if (!company.get().setupDone) {
    const code = store.createAdminCode('setup', 60);
    const base = process.env.GNOMON_PUBLIC_URL?.trim().replace(/\/+$/, '') || `http://localhost:${port}`;
    const link = `${base}/setup#code=${code.slice(0, 4)}-${code.slice(4)}`;
    console.log(`\nCompany setup (optional): open this link within 60 minutes, it works once:\n${link}`);
    if (process.env.GNOMON_PUBLIC_URL) console.log(`\n${terminalQr(link)}\n`);
    if (secret.source === 'file') console.log('Tokens entered in the setup are encrypted with a key file in the data folder; set GNOMON_SECRET_KEY to keep the key elsewhere.');
  }
  if (!store.encrypted) console.log('The data isn’t encrypted at rest: set GNOMON_DATA_KEY (see docs/admin-guide.md#encryption-at-rest).');
  const copies = encryptionStatus(store, dataDir, dbFile, dataKey).plainCopies;
  if (store.encrypted && copies.length) console.log(`Unencrypted copies of the database are still in the data folder; delete them once all is well: ${copies.join(', ')}`);
  if (!backups.key()) console.log('No backup password set, so there are no nightly backups yet: gnomon-admin backup-password, or the setup page.');
  if (!devices) {
    // First start: show a setup code right here, so the first device needs no server command. It's only
    // printed to this log (which only the server's owner sees) and expires; a restart makes a new one.
    console.log('No devices yet. Connect your first device with this code:');
    printPairing(store.createPairCode('First device', 60), 'First device', 60);
    console.log('More codes later: gnomon-admin pair "iPhone"  (Docker: docker exec gnomon gnomon-admin pair "iPhone")');
  }
});

function shutdown() {
  backups.stop();
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
