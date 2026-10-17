// Device management on the server: `gnomon-admin <command>` (or `npm run admin -- <command>`).
import fs from 'node:fs';
import path from 'node:path';
import { Store } from './store';

const [cmd, ...args] = process.argv.slice(2);
const store = new Store(path.join(path.resolve(process.env.GNOMON_DATA_DIR ?? './data'), 'gnomon.db'));

const usage = `Usage:
  pair <device name>     One-time code (valid 10 minutes) to sign in a phone or browser
  add-key <device name>  Create a device key directly (for scripts and the Mac app); shown once
  devices                List devices
  revoke <id|name>       Revoke a device's key
  backup <file>          Copy the database to a file (safe while the server runs)`;

try {
  if (cmd === 'pair' && args.length) {
    const code = store.createPairCode(args.join(' '));
    console.log(`Pairing code for "${args.join(' ')}": ${code.slice(0, 4)}-${code.slice(4)}\nOpen Gnomon on the device and enter it within 10 minutes. It works once.`);
  } else if (cmd === 'add-key' && args.length) {
    const { device, key } = store.addDevice(args.join(' '));
    console.log(`Device "${device.name}" (${device.id.slice(0, 8)})\nKey (shown only now): ${key}`);
  } else if (cmd === 'devices') {
    const list = store.listDevices();
    if (!list.length) console.log('No devices.');
    for (const d of list) console.log(`${d.id.slice(0, 8)}  ${d.name.padEnd(24)}  created ${d.createdAt.slice(0, 10)}  last seen ${d.lastSeenAt?.slice(0, 16).replace('T', ' ') ?? 'never'}${d.revokedAt ? '  REVOKED' : ''}`);
  } else if (cmd === 'backup' && args.length) {
    await store.backup(path.resolve(args[0]));
    fs.chmodSync(path.resolve(args[0]), 0o600); // it holds your times and the device key hashes
    console.log(`Backed up to ${path.resolve(args[0])}`);
  } else if (cmd === 'revoke' && args.length) {
    const d = store.revokeDevice(args.join(' '));
    if (!d) throw new Error(`No active device "${args.join(' ')}"`);
    console.log(`Revoked "${d.name}" (${d.id.slice(0, 8)}). Its key no longer works.`);
  } else {
    console.log(usage);
    process.exitCode = cmd ? 1 : 0;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  store.close();
}
