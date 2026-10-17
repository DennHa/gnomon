// Takes the phone screenshots for the README: starts the server (server/dist) on a throwaway database with the clock
// set to a regular Wednesday, pairs a device, loads two weeks of demo data through the API and captures the web app
// at iPhone size into docs/screenshots/.
// Usage: (cd server && npm run build) && node node_modules/electron/cli.js scripts/phone-screenshots.cjs
const { app, BrowserWindow } = require('electron');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// English UI, whatever the Mac's language.
app.commandLine.appendSwitch('lang', 'en-GB'); // English with 24-hour times

const NOW = '2026-10-14T14:35:00';
const PORT = 8799;
const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-phone-'));
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The same fixed clock for the server (via --require) and the page.
const clockJs = (at) => `(() => {
  const Real = Date, offset = ${at} - Real.now();
  function FakeDate(...a) {
    if (!new.target) return new Real(Real.now() + offset).toString();
    return a.length ? new Real(...a) : new Real(Real.now() + offset);
  }
  FakeDate.prototype = Real.prototype;
  FakeDate.now = () => Real.now() + offset;
  FakeDate.parse = Real.parse;
  FakeDate.UTC = Real.UTC;
  globalThis.Date = FakeDate;
})();`;
const at = Date.parse(NOW);
fs.writeFileSync(path.join(tmp, 'clock.cjs'), clockJs(at));
// For the page: a preload in the page's own world (screenshot window only), so the clock is set before the app runs.
fs.writeFileSync(path.join(tmp, 'page-clock.cjs'), clockJs(at).replace('globalThis.Date', 'window.Date'));

const env = { ...process.env, GNOMON_DATA_DIR: path.join(tmp, 'db'), PORT: String(PORT), HOST: '127.0.0.1', NODE_OPTIONS: `--require ${path.join(tmp, 'clock.cjs')}` };
delete env.ELECTRON_RUN_AS_NODE;

async function api(key, method, p, body) {
  const res = await fetch(`${base}/api/v1${p}`, { method, headers: { ...(key && { Authorization: `Bearer ${key}` }), ...(body && { 'Content-Type': 'application/json' }) }, body: body && JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const hhmm = (iso) => new Date(iso).toTimeString().slice(0, 5);

async function seed(key) {
  execFileSync('node', [path.join(__dirname, 'demo-data.cjs'), path.join(tmp, 'demo'), NOW, 'en']);
  const demo = JSON.parse(fs.readFileSync(path.join(tmp, 'demo', 'data.json'), 'utf8'));
  for (const p of demo.projects) await api(key, 'POST', '/projects', { name: p.name, color: p.color, externalId: p.id });
  const known = new Set((await api(key, 'GET', '/activities')).map((a) => a.name));
  const activityName = (id) => demo.activities.find((a) => a.id === id)?.name;
  const since = new Date(at - 14 * 864e5).toISOString().slice(0, 10);
  for (const w of demo.workdays.filter((w) => w.date >= since)) {
    const brk = w.breaks.reduce((s, b) => s + (b.end ? (Date.parse(b.end) - Date.parse(b.start)) / 6e4 : 0), 0);
    await api(key, 'PUT', `/workdays/${w.date}`, w.off ? { off: true, reason: w.offReason ?? 'Off', ...(w.offKind && { kind: w.offKind }) } : { in: hhmm(w.start), ...(w.end && { out: hhmm(w.end) }), breakMinutes: brk });
  }
  for (const e of demo.entries.filter((e) => e.start.slice(0, 10) >= since)) {
    const activity = activityName(e.activityId);
    const fields = { description: e.description, projectExternalId: e.projectId, ...(known.has(activity) && { activity }) };
    if (e.end) await api(key, 'POST', '/entries', { start: e.start, end: e.end, ...fields });
    else {
      const { running } = await api(key, 'POST', '/timer/start', fields);
      await api(key, 'PATCH', `/entries/${running.id}`, { start: e.start });
    }
  }
}

/** One phone-sized window, signed in with the device key and running on the fixed clock. */
async function openPhone() {
  const win = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { preload: path.join(tmp, 'page-clock.cjs'), contextIsolation: false, sandbox: false } });
  const dbg = win.webContents.debugger;
  await win.loadURL(`${base}/`).catch(() => {}); // the page may replace its own URL while loading
  dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await win.webContents.executeJavaScript(`localStorage.setItem('gnomon.deviceKey', ${JSON.stringify(global.deviceKey)})`);
  const loaded = new Promise((r) => win.webContents.once('did-finish-load', r));
  win.webContents.reload();
  await loaded;
  await sleep(500);
  // Wait until the signed-in app (with its tab bar) is on screen.
  for (let i = 0; i < 50 && !(await win.webContents.executeJavaScript("!!document.querySelector('.tabs button')").catch(() => false)); i++) await sleep(200);
  await sleep(800);
  return win;
}

async function shoot(win, file, scheme, tab) {
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await win.webContents.executeJavaScript(`[...document.querySelectorAll('.tabs button')][${tab}].click()`);
  await sleep(1000);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(out, file), img.toPNG());
  console.log(`✓ docs/screenshots/${file}`);
}

app.whenReady().then(async () => {
  const server = spawn('node', [path.join(root, 'server', 'dist', 'server.mjs')], { env, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) {
      if (await fetch(`${base}/healthz`).then((r) => r.ok, () => false)) break;
      await sleep(200);
    }
    const said = execFileSync('node', [path.join(root, 'server', 'dist', 'admin.mjs'), 'pair', 'iPhone'], { env }).toString();
    const code = said.match(/([A-Z0-9]{4}-[A-Z0-9]{4})/)[1];
    global.deviceKey = (await api(null, 'POST', '/pair', { code })).key;
    await seed(global.deviceKey);
    fs.mkdirSync(out, { recursive: true });
    const win = await openPhone();
    // Tabs in order: Stempeln (time clock), Timer, Week, Device.
    await shoot(win, 'phone-today.png', 'light', 1);
    await shoot(win, 'phone-week.png', 'dark', 2);
    await shoot(win, 'phone-today-dark.png', 'dark', 1);
    await shoot(win, 'phone-clock.png', 'light', 0);
    win.destroy();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
    app.quit();
  }
});
