// Starts real Gnomon processes on scratch data folders (never the real one): one per folder, a second start on the
// same folder quits, a different folder runs side by side, a foreign lock file keeps the app off, and a data.json
// changed behind the app's back isn't overwritten. Windows stay hidden (capture mode).
// Usage: npm run build && node tests/instances.test.cjs
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { lockFile } = require('../electron/instance-lock.cjs');

const root = path.resolve(__dirname, '..');
const electron = require(path.join(root, 'node_modules/electron')); // the binary itself, so its PID is the app's
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-instances-'));
const children = [];

if (!fs.existsSync(path.join(root, 'dist/index.html'))) {
  console.error('Build first: npm run build');
  process.exit(1);
}

/** Starts Gnomon on `<tmp>/<name>`, hidden; it quits by itself after `stay` ms (capture mode). */
function start(name, { stay = 20000, js } = {}) {
  const dir = path.join(tmp, name);
  const env = { ...process.env, USER_DATA_DIR: dir, CAPTURE: path.join(tmp, `${name}-${children.length}.png`), CAPTURE_DELAY: String(stay) };
  if (js) env.CAPTURE_JS = js;
  delete env.ELECTRON_RUN_AS_NODE;
  const p = spawn(electron, [root], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = '';
  p.stdout.on('data', (d) => (p.log += d));
  p.stderr.on('data', (d) => (p.log += d));
  p.exited = new Promise((r) => p.once('exit', (code) => r(code)));
  p.done = false;
  p.exited.then(() => (p.done = true));
  children.push(p);
  return p;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (promise, ms, what) => Promise.race([promise, sleep(ms).then(() => Promise.reject(new Error(`timed out: ${what}`)))]);
async function waitFor(check, ms, what) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (check()) return;
  throw new Error(`timed out: ${what}`);
}
const holderOf = (name) => {
  try {
    return JSON.parse(fs.readFileSync(lockFile(path.join(tmp, name)), 'utf8')).pid;
  } catch {
    return null;
  }
};

(async () => {
  // Same folder: the second start quits right away, the first keeps running and hears about it.
  const first = start('same');
  await waitFor(() => holderOf('same') === first.pid, 15000, 'first instance takes the lock');
  const second = start('same');
  assert.strictEqual(await within(second.exited, 10000, 'second instance quits'), 0);
  assert.match(second.log, /already runs on/);
  await waitFor(() => /handed over/.test(first.log), 5000, 'first instance hears about the second');
  assert.ok(!first.done, 'first instance still runs');
  assert.strictEqual(holderOf('same'), first.pid);
  console.log('✓ a second start on the same folder quits, the first keeps running');

  // Different folder: both run.
  const other = start('other');
  await waitFor(() => holderOf('other') === other.pid, 15000, 'instance on another folder takes its lock');
  await sleep(1500);
  assert.ok(!first.done && !other.done, 'both still run');
  console.log('✓ two folders, two instances');

  // A lock file held by another live process (a build that doesn't share Electron's lock) keeps the app off.
  const foreignDir = path.join(tmp, 'foreign');
  const holder = spawn(process.execPath, ['-e', `require(${JSON.stringify(path.join(root, 'electron/instance-lock.cjs'))}).acquireLock(${JSON.stringify(foreignDir)}); setTimeout(() => {}, 60000)`]);
  children.push(holder);
  await waitFor(() => holderOf('foreign') === holder.pid, 5000, 'foreign holder takes the lock');
  const blocked = start('foreign');
  assert.strictEqual(await within(blocked.exited, 10000, 'blocked instance quits'), 1);
  assert.match(blocked.log, /is in use by process/);
  assert.ok(!fs.existsSync(path.join(foreignDir, 'data.json')), 'blocked instance wrote no data');
  assert.strictEqual(holderOf('foreign'), holder.pid, 'lock left to its holder');
  // Once the holder is gone without cleaning up, its lock is stale and the app starts.
  holder.kill('SIGKILL');
  await new Promise((r) => holder.once('exit', r));
  const after = start('foreign', { stay: 500 });
  await waitFor(() => holderOf('foreign') === after.pid, 15000, 'stale lock taken over');
  assert.strictEqual(await within(after.exited, 15000, 'capture finishes'), 0);
  assert.strictEqual(holderOf('foreign'), null, 'lock removed on quit');
  console.log('✓ a lock file from another live process blocks; a stale one is taken over and removed on quit');

  // data.json changed by someone else while the app runs: the app doesn't overwrite it, keeps its own version aside
  // and reloads what's on disk.
  const conflictDir = path.join(tmp, 'conflict');
  const dataFile = path.join(conflictDir, 'data.json');
  const js = `setTimeout(() => window.api.save({ marker: 'from-the-app' }), 2500)`;
  const app = start('conflict', { stay: 4000, js });
  await waitFor(() => fs.existsSync(dataFile), 15000, 'app saves data.json');
  await sleep(500);
  const elsewhere = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  elsewhere.activities[0].name = 'Written elsewhere';
  fs.writeFileSync(dataFile, JSON.stringify(elsewhere));
  await within(app.exited, 20000, 'conflict instance quits');
  const conflicts = fs.readdirSync(conflictDir).filter((f) => /^data\.conflict-.*\.json$/.test(f));
  assert.strictEqual(conflicts.length, 1, 'one conflict copy');
  assert.doesNotMatch(fs.readFileSync(path.join(conflictDir, conflicts[0]), 'utf8'), /Written elsewhere/);
  const kept = fs.readFileSync(dataFile, 'utf8');
  assert.match(kept, /Written elsewhere/, 'the other change survives (and the window reloaded it)');
  assert.doesNotMatch(kept, /from-the-app/);
  assert.match(app.log, /changed by another process/);
  console.log('✓ a data.json changed behind the app is not overwritten; the app keeps its copy aside');

  console.log('instances tests passed');
})()
  .catch((err) => {
    console.error(err);
    for (const c of children) if (c.log) console.error(`--- pid ${c.pid}\n${c.log}`);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill();
    setTimeout(() => fs.rmSync(tmp, { recursive: true, force: true }), 500);
  });
