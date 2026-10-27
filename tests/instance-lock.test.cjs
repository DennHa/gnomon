// The lock file that keeps a second Gnomon off a data folder (electron/instance-lock.cjs). Plain Node, scratch folders.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { acquireLock, releaseLock, fileStamp, lockFile } = require('../electron/instance-lock.cjs');

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lock-'));
const writeLock = (dir, holder) => fs.writeFileSync(lockFile(dir), JSON.stringify(holder));
const waitFor = async (check, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (check()) return;
  throw new Error('timed out');
};

(async () => {
  // A free folder: the lock is taken and holds this PID; releasing removes it.
  let dir = scratch();
  assert.deepStrictEqual(acquireLock(dir), { ok: true });
  assert.strictEqual(JSON.parse(fs.readFileSync(lockFile(dir), 'utf8')).pid, process.pid);
  releaseLock(dir);
  assert.ok(!fs.existsSync(lockFile(dir)));

  // A stale lock from a process that's gone counts as free.
  dir = scratch();
  const gone = spawnSync('/usr/bin/true').pid;
  writeLock(dir, { pid: gone, startedAt: Date.now() });
  assert.deepStrictEqual(acquireLock(dir), { ok: true });

  // A reused PID (a live process that started at another time) counts as free too.
  dir = scratch();
  const other = spawn('/bin/sleep', ['30']);
  writeLock(dir, { pid: other.pid, startedAt: Date.parse('2001-01-01T00:00:00Z') });
  assert.deepStrictEqual(acquireLock(dir), { ok: true });
  other.kill();

  // A garbled lock file counts as free.
  dir = scratch();
  fs.writeFileSync(lockFile(dir), '{"pid":');
  assert.deepStrictEqual(acquireLock(dir), { ok: true });

  // A live holder keeps it; once it's gone without cleaning up, the folder is free again.
  dir = scratch();
  const holder = spawn(process.execPath, ['-e', `require(${JSON.stringify(path.resolve(__dirname, '../electron/instance-lock.cjs'))}).acquireLock(${JSON.stringify(dir)}); setTimeout(() => {}, 30000)`]);
  await waitFor(() => fs.existsSync(lockFile(dir)) && fs.readFileSync(lockFile(dir), 'utf8').endsWith('}'));
  const taken = acquireLock(dir);
  assert.strictEqual(taken.ok, false);
  assert.strictEqual(taken.holder.pid, holder.pid);
  releaseLock(dir); // not ours: stays
  assert.ok(fs.existsSync(lockFile(dir)));
  holder.kill('SIGKILL');
  await new Promise((r) => holder.once('exit', r));
  assert.deepStrictEqual(acquireLock(dir), { ok: true });

  // data.json's stamp changes with every atomic write, even to the same size.
  dir = scratch();
  const file = path.join(dir, 'data.json');
  assert.strictEqual(fileStamp(file), null);
  fs.writeFileSync(file, '{"a":1}');
  const before = fileStamp(file);
  fs.writeFileSync(`${file}.tmp`, '{"a":2}');
  fs.renameSync(`${file}.tmp`, file);
  assert.notStrictEqual(fileStamp(file), before);

  console.log('instance lock tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
