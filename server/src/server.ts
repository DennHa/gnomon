// Entry point: `node dist/server.mjs`. Configuration comes from environment variables (see README.md).
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { printPairing } from './qr-terminal';
import { databaseFile, Store } from './store';
import { Company, loadSecretKey } from './company';
import { terminalQr } from './qr-terminal';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.GNOMON_DATA_DIR ?? './data');
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

const store = new Store(databaseFile(dataDir));
// Optional download page for the Mac app (/latest); see src/releases.ts.
const releasesDir = process.env.GNOMON_RELEASES_DIR ? path.resolve(process.env.GNOMON_RELEASES_DIR) : undefined;
const demoDir = process.env.GNOMON_DEMO_DIR ? path.resolve(process.env.GNOMON_DEMO_DIR) : undefined;
// Company setup: settings and encrypted tokens for the wizard (src/company.ts).
const secret = loadSecretKey(dataDir);
const company = new Company(store, secret.key, secret.source);
const server = http.createServer(createApp({ store, webDir: path.join(here, 'web'), releasesDir, company, demoDir }));
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(port, host, () => {
  const devices = store.listDevices().filter((d) => !d.revokedAt).length;
  console.log(`Gnomon server on http://${host}:${port} (data: ${dataDir}, timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}, devices: ${devices})`);
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
  if (!devices) {
    // First start: show a setup code right here, so the first device needs no server command. It's only
    // printed to this log (which only the server's owner sees) and expires; a restart makes a new one.
    console.log('No devices yet. Connect your first device with this code:');
    printPairing(store.createPairCode('First device', 60), 'First device', 60);
    console.log('More codes later: gnomon-admin pair "iPhone"  (Docker: docker exec gnomon gnomon-admin pair "iPhone")');
  }
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
