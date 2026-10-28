// One Gnomon per data folder. Electron's single-instance lock (main.cjs) covers copies of the same app; this lock file
// also covers a different build started on the same folder. Plain Node, so tests/instance-lock.test.cjs can run it.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LOCK_NAME = 'gnomon.lock';
const lockFile = (dir) => path.join(dir, LOCK_NAME);
// When this process started, to the second (what ps reports), so a reused PID isn't mistaken for the holder.
const startedAt = () => Math.floor((Date.now() - process.uptime() * 1000) / 1000) * 1000;

/** Whether the process that wrote the lock still runs: same PID and, as far as ps can tell, the same start time. */
function holderAlive(holder) {
  const pid = Number(holder?.pid);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (err.code !== 'EPERM') return false; // ESRCH: gone
  }
  try {
    const out = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C' }, timeout: 3000 }).toString().trim();
    const started = Date.parse(out);
    if (!out) return false;
    if (Number.isFinite(started) && Number.isFinite(holder.startedAt)) return Math.abs(started - holder.startedAt) <= 2000;
  } catch {
    // ps exits with 1 when the PID is gone; anything else, play safe and count it as running
  }
  return true;
}

/** Takes the lock for `dir`. Returns { ok: true } or { ok: false, holder } when another live process has it. */
function acquireLock(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = lockFile(dir);
  const mine = JSON.stringify({ pid: process.pid, startedAt: startedAt(), at: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, mine, { flag: 'wx', mode: 0o600 });
      return { ok: true };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let holder = null;
    try {
      holder = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // unreadable or half written: treat as stale
    }
    if (holder && holderAlive(holder)) return { ok: false, holder };
    fs.rmSync(file, { force: true }); // stale: its process is gone
  }
  return { ok: false, holder: null };
}

/** Removes the lock, but only if it's still ours. */
function releaseLock(dir) {
  try {
    const holder = JSON.parse(fs.readFileSync(lockFile(dir), 'utf8'));
    if (holder.pid === process.pid) fs.rmSync(lockFile(dir), { force: true });
  } catch {
    // already gone
  }
}

/** What identifies data.json as written: a new inode on every atomic write, plus size and time. null if missing. */
function fileStamp(file) {
  try {
    const s = fs.statSync(file);
    return `${s.ino}:${s.size}:${s.mtimeMs}`;
  } catch {
    return null;
  }
}

module.exports = { acquireLock, releaseLock, fileStamp, lockFile, LOCK_NAME };
