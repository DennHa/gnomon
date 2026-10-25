// Managing the server from its command line: `gnomon-admin <command>` (or `npm run admin -- <command>`). In a Docker
// install, the host's own gnomon-admin (server/deploy/gnomon-admin.sh) runs these inside the container and adds update.
import fs from 'node:fs';
import path from 'node:path';
import { newBackupPassword } from './backup-crypto';
import { Backups, MIN_PASSWORD, restoreBackup } from './backups';
import { Company, defaultConfig, loadSecretKey } from './company';
import { printPairing, terminalQr } from './qr-terminal';
import { databaseFile, Store } from './store';
import { VERSION } from './version';

const [cmd, ...args] = process.argv.slice(2);
const dataDir = path.resolve(process.env.GNOMON_DATA_DIR ?? './data');
const flag = (name: string) => args.includes(name);
const rest = () => args.filter((a) => !a.startsWith('--'));

const usage = `Gnomon ${VERSION}. Usage: gnomon-admin <command>
  status                  Version, setup, people, devices and backups
  setup-link              One-time link to the setup page (valid 60 minutes), with a QR code
  admin-link              One-time link to the Admin page, valid 60 minutes
  backup                  Make an encrypted backup now (in the data folder's backups/)
  backup --plain <file>   Unencrypted copy of the database to a file (safe while the server runs)
  backups                 List the backups
  backup-password         Set the backup password (asks for it; --new makes and shows one; --stdin reads it)
  restore <file>          Replace the database with a backup (only while the server is stopped)
  pair <device name>      One-time code (valid 10 minutes) to sign in a phone or browser
  add-key <device name>   Create a device key directly (for scripts and the Mac app); shown once
  devices                 List devices
  revoke <id|name>        Revoke a device's key`;

/** A line from the terminal without showing it, or from stdin when that's a pipe. */
async function secretLine(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0];
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => {
    let s = '';
    const onData = (b: Buffer) => {
      for (const ch of b.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(s);
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f') s = s.slice(0, -1);
        else s += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

const kb = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
/** A time in the server's own time zone, like 2026-10-25 14:42. */
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('sv-SE').slice(0, 16) : 'never');

async function main() {
  const dbFile = databaseFile(dataDir);

  // Restoring replaces the database file, so it never opens the store.
  if (cmd === 'restore') {
    const file = rest()[0];
    if (!file) throw new Error('Usage: gnomon-admin restore <backup file>');
    const running = await fetch(`http://127.0.0.1:${process.env.PORT ?? 8080}/healthz`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
    if (running) throw new Error('The server is running. Stop it first (in a Docker install, the host’s `gnomon-admin restore` does that for you).');
    const password = await secretLine('Backup password: ');
    const r = restoreBackup(dbFile, fs.readFileSync(path.resolve(file)), password);
    console.log(`Restored the backup from ${when(r.created)}.`);
    if (r.kept) console.log(`The database from before is kept as ${r.kept} (unencrypted; delete it once all is well).`);
    return;
  }

  const store = new Store(dbFile);
  const backups = new Backups(store, dataDir);
  try {
    const company = () => {
      const secret = loadSecretKey(dataDir);
      return new Company(store, secret.key, secret.source);
    };
    const base = () => {
      const raw = store.getMeta('company');
      const url = (raw ? (JSON.parse(raw) as ReturnType<typeof defaultConfig>).company?.publicUrl : '') || process.env.GNOMON_PUBLIC_URL?.trim() || 'http://localhost:8080';
      return url.replace(/\/+$/, '');
    };

    if (cmd === 'status') {
      const c = company().get();
      const people = store.listPeople();
      const devices = store.listDevices().filter((d) => !d.revokedAt);
      const b = backups.status();
      console.log(`Gnomon ${VERSION}`);
      console.log(`Address:   ${base()}`);
      console.log(`Setup:     ${c.setupDone ? 'finished' : 'not finished (gnomon-admin setup-link)'}`);
      console.log(`People:    ${people.filter((x) => x.status === 'active').length} active, ${people.filter((x) => x.status === 'invited').length} invited`);
      console.log(`Devices:   ${devices.length}`);
      console.log(`Secret key: ${process.env.GNOMON_SECRET_KEY ? 'from GNOMON_SECRET_KEY' : 'key file in the data folder'}`);
      console.log(`Backups:   ${!b.keySet ? 'no backup password set (gnomon-admin backup-password)' : b.enabled ? `every night at ${String(b.hour).padStart(2, '0')}:00, keeping ${b.keep}` : 'nightly backups are off'}`);
      console.log(`           ${b.files.length} on the server${b.files[0] ? `, newest ${b.files[0].name} (${kb(b.files[0].size)})` : ''}`);
      if (b.last && !b.last.ok) console.log(`           last attempt ${when(b.last.at)} failed: ${b.last.error}`);
      process.exitCode = b.last && !b.last.ok ? 2 : 0;
    } else if (cmd === 'setup-link' || cmd === 'admin-link') {
      const setup = cmd === 'setup-link';
      if (setup && company().get().setupDone) throw new Error('The setup is finished. Use gnomon-admin admin-link for the Admin page.');
      const code = store.createAdminCode(setup ? 'setup' : 'admin', 60);
      const link = `${base()}/${setup ? 'setup' : 'admin'}#code=${code.slice(0, 4)}-${code.slice(4)}`;
      if (setup && !flag('--no-qr')) console.log(`\n${terminalQr(link)}\n`);
      console.log(`${setup ? 'Setup page' : 'Admin page'} (valid 60 minutes, works once):\n${link}`);
    } else if (cmd === 'pair' && args.length) {
      printPairing(store.createPairCode(args.join(' ')), args.join(' '), 10);
    } else if (cmd === 'add-key' && args.length) {
      const { device, key } = store.addDevice(args.join(' '));
      console.log(`Device "${device.name}" (${device.id.slice(0, 8)})\nKey (shown only now): ${key}`);
    } else if (cmd === 'devices') {
      const list = store.listDevices();
      if (!list.length) console.log('No devices.');
      for (const d of list) console.log(`${d.id.slice(0, 8)}  ${d.name.padEnd(24)}  created ${d.createdAt.slice(0, 10)}  last seen ${d.lastSeenAt?.slice(0, 16).replace('T', ' ') ?? 'never'}${d.revokedAt ? '  REVOKED' : ''}`);
    } else if (cmd === 'backup' && flag('--plain')) {
      const file = rest()[0];
      if (!file) throw new Error('Usage: gnomon-admin backup --plain <file>');
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true, mode: 0o700 });
      await store.backup(path.resolve(file));
      fs.chmodSync(path.resolve(file), 0o600); // it holds everyone's times and the password hashes
      console.log(`Backed up (unencrypted) to ${path.resolve(file)}`);
    } else if (cmd === 'backup') {
      const label = args.find((a) => a.startsWith('--label='))?.slice(8) ?? 'manual';
      const f = await backups.run(label);
      console.log(`Backed up to ${path.join(backups.dir, f.name)} (${kb(f.size)}, encrypted)`);
    } else if (cmd === 'backups') {
      const list = backups.list();
      if (!list.length) console.log('No backups yet.');
      for (const f of list) console.log(`${f.name}  ${kb(f.size).padStart(8)}`);
    } else if (cmd === 'backup-password') {
      let password: string;
      if (flag('--new')) password = newBackupPassword();
      else {
        password = await secretLine(`New backup password (at least ${MIN_PASSWORD} characters): `);
        if (process.stdin.isTTY && (await secretLine('Again: ')) !== password) throw new Error('The two passwords aren’t the same');
      }
      // Whoever runs this has the whole server, so no need for the current password.
      backups.setPassword(password, undefined, true);
      if (flag('--new')) console.log(`Backup password (shown only now, keep it in your password manager):\n\n    ${password}\n`);
      console.log('Backup password set. New backups need it to be restored; older ones still need the password they were made with.');
    } else if (cmd === 'revoke' && args.length) {
      const d = store.revokeDevice(args.join(' '));
      if (!d) throw new Error(`No active device "${args.join(' ')}"`);
      console.log(`Revoked "${d.name}" (${d.id.slice(0, 8)}). Its key no longer works.`);
    } else {
      console.log(usage);
      process.exitCode = cmd && cmd !== 'help' ? 1 : 0;
    }
  } finally {
    store.close();
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
