// Entry point: `node dist/server.mjs`. Configuration comes from environment variables (see README.md).
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { printPairing } from './qr-terminal';
import { databaseFile, Store } from './store';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.GNOMON_DATA_DIR ?? './data');
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

const store = new Store(databaseFile(dataDir));
const server = http.createServer(createApp({ store, webDir: path.join(here, 'web') }));
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(port, host, () => {
  const devices = store.listDevices().filter((d) => !d.revokedAt).length;
  console.log(`Gnomon server on http://${host}:${port} (data: ${dataDir}, timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}, devices: ${devices})`);
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
