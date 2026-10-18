const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, safeStorage, globalShortcut, powerMonitor, dialog, Notification, screen, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
// FLOAT_API_BASE lets tests point the app at a local mock of the Float API.
const FLOAT_API_BASE = process.env.FLOAT_API_BASE || 'https://api.float.com/v3';
// PERSONIO_API_BASE does the same for Personio (see tests/personio-mock.cjs).
const PERSONIO_API_BASE = process.env.PERSONIO_API_BASE || 'https://api.personio.de';

// Lets tests and screenshots run against a throwaway data folder.
if (process.env.USER_DATA_DIR) app.setPath('userData', process.env.USER_DATA_DIR);
// Screenshots in a given appearance (light/dark) regardless of the Mac's setting.
if (process.env.CAPTURE_THEME) nativeTheme.themeSource = process.env.CAPTURE_THEME;

let win = null;
let tray = null;
let trayMenuKey = '';
let lastTrayMenu = null;
let lastState = null;
let quickWin = null;
let registeredShortcuts = '';
let quitting = false;

const dataFile = () => path.join(app.getPath('userData'), 'data.json');
const floatTokenFile = () => path.join(app.getPath('userData'), 'float-token.json');
const personioFile = () => path.join(app.getPath('userData'), 'personio-credentials.json');
const trailFile = () => path.join(app.getPath('userData'), 'trail.json');
const apiKeyFile = () => path.join(app.getPath('userData'), 'api-key.json');

function writeAtomic(file, contents) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readData() {
  try {
    return JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  } catch {
    return null;
  }
}

// ---- Company profile (Iru or another Mac management tool) --------------------------------------
// IT can push a settings profile for the domain app.gnomon.timetracker (see docs/company-setup.md). macOS writes it
// to /Library/Managed Preferences, per user or for the whole Mac. It holds addresses, IDs and switches only, never
// secrets. Read once at start; unknown or badly typed keys are ignored. PROFILE_FILE (a .plist or .json) fakes one for
// tests and screenshots.
const PROFILE_DOMAIN = 'app.gnomon.timetracker';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readCompanyProfile() {
  const os = require('os');
  const files = process.env.PROFILE_FILE
    ? [process.env.PROFILE_FILE]
    : [path.join('/Library/Managed Preferences', os.userInfo().username, `${PROFILE_DOMAIN}.plist`), path.join('/Library/Managed Preferences', `${PROFILE_DOMAIN}.plist`)];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = file.endsWith('.json')
        ? JSON.parse(fs.readFileSync(file, 'utf8'))
        : JSON.parse(require('child_process').execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { timeout: 3000 }).toString());
      const p = {};
      if (typeof raw.serverUrl === 'string' && /^https:\/\/[^\s/]+/i.test(raw.serverUrl)) p.serverUrl = new URL(raw.serverUrl).origin;
      if (typeof raw.managed === 'boolean') p.managed = raw.managed;
      if (typeof raw.companyName === 'string' && raw.companyName.trim()) p.companyName = raw.companyName.trim().slice(0, 100);
      if (typeof raw.updateUrl === 'string' && /^https:\/\/\S+$/i.test(raw.updateUrl)) p.updateUrl = raw.updateUrl;
      if (typeof raw.entraTenantId === 'string' && UUID.test(raw.entraTenantId)) p.entraTenantId = raw.entraTenantId;
      if (typeof raw.entraClientId === 'string' && UUID.test(raw.entraClientId)) p.entraClientId = raw.entraClientId;
      // Sign-in, provider-neutral (OpenID Connect) or by invitation; Microsoft's tenant ID is a shorthand for the issuer.
      if (raw.signIn === 'oidc' || raw.signIn === 'invite') p.signIn = raw.signIn;
      if (typeof raw.signInIssuer === 'string' && /^https:\/\/\S+$/i.test(raw.signInIssuer)) p.signInIssuer = raw.signInIssuer.replace(/\/$/, '');
      else if (p.entraTenantId) p.signInIssuer = `https://login.microsoftonline.com/${p.entraTenantId}/v2.0`;
      if (typeof raw.signInClientId === 'string' && /^[\w.\-]{1,200}$/.test(raw.signInClientId)) p.signInClientId = raw.signInClientId;
      else if (p.entraClientId) p.signInClientId = p.entraClientId;
      if (!p.signIn && p.signInIssuer && p.signInClientId) p.signIn = 'oidc';
      if (typeof raw.allowLocalApi === 'boolean') p.allowLocalApi = raw.allowLocalApi;
      if (typeof raw.allowActivityTrail === 'boolean') p.allowActivityTrail = raw.allowActivityTrail;
      if (typeof raw.dailyTargetHours === 'number' && raw.dailyTargetHours > 0 && raw.dailyTargetHours <= 24) p.dailyTargetHours = raw.dailyTargetHours;
      if (['system', 'en', 'de'].includes(raw.language)) p.language = raw.language;
      console.log(`[profile] ${file}: ${Object.keys(p).join(', ') || 'no usable keys'}`);
      return p;
    } catch (err) {
      console.warn(`[profile] couldn't read ${file}: ${err.message}`);
    }
  }
  return null;
}
const companyProfile = readCompanyProfile();
ipcMain.handle('profile:get', () => companyProfile);

// ---- Info & feedback: version, update check, links -----------------------------------------------
// Where a newer version is announced (a small version.json, see server/README.md): UPDATE_URL for tests, the company
// profile's updateUrl, the company server, or the server this Mac is paired with. Not tied to GitHub or one host.
function updateSource() {
  if (process.env.UPDATE_URL) return process.env.UPDATE_URL;
  if (companyProfile?.updateUrl) return companyProfile.updateUrl;
  // Only the paired server's address, not its key: reading the key could ask for keychain access.
  let paired = null;
  try {
    paired = JSON.parse(fs.readFileSync(serverFile(), 'utf8')).url || null;
  } catch {
    /* not paired */
  }
  const server = companyProfile?.serverUrl || paired;
  return server ? `${server}/latest/version.json` : null;
}

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  updateSource: updateSource(),
}));

/** 1.2.10 > 1.2.9; anything after a "-" (pre-release) sorts below the plain version. */
function newerVersion(a, b) {
  const parse = (v) => String(v).split('-')[0].split('.').map((n) => Number(n) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

ipcMain.handle('update:check', async () => {
  const source = updateSource();
  if (!source) return { ok: false, error: 'no_source' };
  try {
    const res = await fetch(source, { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const v = await res.json();
    if (typeof v?.version !== 'string') return { ok: false, error: 'invalid' };
    const https = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : undefined);
    const base = new URL(source);
    const abs = (u) => (typeof u === 'string' ? https(new URL(u, base).href) : undefined);
    return {
      ok: true,
      latest: { version: v.version, date: typeof v.date === 'string' ? v.date : undefined, notes: Array.isArray(v.notes) ? v.notes.filter((n) => typeof n === 'string').slice(0, 20) : [], download: abs(v.download), page: abs(v.page) },
      newer: newerVersion(v.version, app.getVersion()),
    };
  } catch (err) {
    return { ok: false, error: err.name === 'TimeoutError' ? 'timeout' : String(err.message || err) };
  }
});

// Links from Info & feedback (credits, download page): https only, opened in the default browser.
ipcMain.on('link:open', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\/[^\s]+$/i.test(url)) shell.openExternal(url);
});

// Appearance from Settings: light, dark or like macOS. Screenshots (CAPTURE_THEME) keep their own.
ipcMain.on('theme:set', (_e, value) => {
  if (!process.env.CAPTURE_THEME && ['system', 'light', 'dark'].includes(value)) nativeTheme.themeSource = value;
});

// The Float API token is encrypted with the macOS keychain and never handed back to the renderer.
// It's decrypted once per launch and kept in memory: every decrypt can trigger a keychain password prompt.
let floatTokenCache;
function readFloatToken() {
  if (floatTokenCache !== undefined) return floatTokenCache;
  try {
    const stored = JSON.parse(fs.readFileSync(floatTokenFile(), 'utf8'));
    const buf = Buffer.from(stored.value, 'base64');
    floatTokenCache = stored.encrypted ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch {
    floatTokenCache = null;
  }
  return floatTokenCache;
}

function writeFloatToken(token) {
  floatTokenCache = token || null;
  if (!token) {
    fs.rmSync(floatTokenFile(), { force: true });
    return;
  }
  const encrypted = safeStorage.isEncryptionAvailable();
  const value = encrypted ? safeStorage.encryptString(token) : Buffer.from(token, 'utf8');
  writeAtomic(floatTokenFile(), JSON.stringify({ encrypted, value: value.toString('base64') }));
}

/** Read-only GET against the Float API; returns the parsed body plus the pagination page count. */
async function floatGet(apiPath, contact) {
  if (typeof apiPath !== 'string' || !apiPath.startsWith('/')) return { ok: false, status: 0, error: 'Invalid request' };
  const token = readFloatToken();
  if (!token) return { ok: false, status: 0, error: 'No Float API token saved' };
  try {
    const res = await fetch(FLOAT_API_BASE + apiPath, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        // Float asks integrations to identify themselves with a name and contact.
        'User-Agent': contact ? `Gnomon time tracker (${contact})` : 'Gnomon time tracker',
      },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) return { ok: false, status: res.status, error: (data && data.message) || res.statusText };
    return { ok: true, status: res.status, data, pageCount: Number(res.headers.get('x-pagination-page-count')) || 1 };
  } catch (err) {
    return { ok: false, status: 0, error: `Network error: ${err.message || err}` };
  }
}

// ---- Personio (read-only absence import, see src/personio.ts) ------------------------
// Client ID and secret are encrypted with the keychain like the Float token and never handed back to the
// renderer. The page can only ask for a few fixed read endpoints of the v2 API; the token stays in memory.
// Decrypted once per launch (each decrypt can trigger a keychain prompt); writes keep the cache current.
let personioCredsCache;
function readPersonioCredentials() {
  if (personioCredsCache !== undefined) return personioCredsCache;
  try {
    const stored = JSON.parse(fs.readFileSync(personioFile(), 'utf8'));
    const buf = Buffer.from(stored.value, 'base64');
    const creds = JSON.parse(stored.encrypted ? safeStorage.decryptString(buf) : buf.toString('utf8'));
    personioCredsCache = creds.clientId && creds.clientSecret ? { clientId: creds.clientId, clientSecret: creds.clientSecret } : null;
  } catch {
    personioCredsCache = null;
  }
  return personioCredsCache;
}

let personioToken = null; // { value, expiresAt }

function writePersonioCredentials(creds) {
  personioToken = null;
  const clientId = typeof creds?.clientId === 'string' ? creds.clientId.trim() : '';
  const clientSecret = typeof creds?.clientSecret === 'string' ? creds.clientSecret.trim() : '';
  if (!clientId || !clientSecret) {
    personioCredsCache = null;
    fs.rmSync(personioFile(), { force: true });
    return;
  }
  personioCredsCache = { clientId, clientSecret };
  const json = JSON.stringify({ clientId, clientSecret });
  const encrypted = safeStorage.isEncryptionAvailable();
  const value = encrypted ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  writeAtomic(personioFile(), JSON.stringify({ encrypted, value: value.toString('base64') }));
}

/** OAuth client-credentials token (POST /v2/auth/token), reused until shortly before it expires (default 1 day). */
async function personioAccessToken() {
  if (personioToken && Date.now() < personioToken.expiresAt) return { ok: true, token: personioToken.value };
  const creds = readPersonioCredentials();
  if (!creds) return { ok: false, status: 0, error: 'no_credentials' };
  const res = await fetch(`${PERSONIO_API_BASE}/v2/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.clientId, client_secret: creds.clientSecret }).toString(),
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // Personio answers wrong credentials with 400 invalid_client / unauthorized_client.
    const bad = ['invalid_client', 'unauthorized_client', 'invalid_grant'].includes(body.error) || res.status === 401;
    return { ok: false, status: res.status, error: bad ? 'bad_credentials' : body.error_description || body.error || res.statusText };
  }
  const seconds = Number(body.expires_in) || 3600;
  personioToken = { value: body.access_token, expiresAt: Date.now() + Math.max(60, seconds - 120) * 1000 };
  return { ok: true, token: personioToken.value };
}

// Only these read endpoints; the query string is rebuilt from plain key/value pairs.
const PERSONIO_PATHS = /^\/v2\/(persons|absence-types|absence-periods|absence-periods\/[A-Za-z0-9_-]{1,64}\/breakdowns)$/;

/** Read-only GET against the Personio v2 API; returns `_data` and the cursor of the next page (if any). */
async function personioGet(apiPath, query) {
  if (typeof apiPath !== 'string' || !PERSONIO_PATHS.test(apiPath)) return { ok: false, status: 0, error: 'Invalid request' };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query && typeof query === 'object' ? query : {})) {
    if (typeof v === 'string' || typeof v === 'number') params.set(k, String(v));
  }
  const url = `${PERSONIO_API_BASE}${apiPath}${params.size ? `?${params}` : ''}`;
  try {
    for (let attempt = 0; ; attempt++) {
      const auth = await personioAccessToken();
      if (!auth.ok) return auth;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${auth.token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      // An expired or revoked token: get a new one once.
      if (res.status === 401 && attempt === 0) {
        personioToken = null;
        continue;
      }
      // Rate limited: back off (1 s, 2 s, 4 s) and try again; Personio asks for at least a second.
      if (res.status === 429 && attempt < 3) {
        const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
        await new Promise((r) => setTimeout(r, Math.min(30, Math.max(1, wait)) * 1000));
        continue;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = body?.errors?.[0]?.detail || body?.error_description || body?.title || res.statusText;
        return { ok: false, status: res.status, error: res.status === 403 ? 'forbidden' : res.status === 401 ? 'bad_credentials' : detail };
      }
      let next = null;
      try {
        const href = body?._meta?.links?.next?.href;
        if (href) next = new URL(href, PERSONIO_API_BASE).searchParams.get('cursor');
      } catch {
        next = null;
      }
      return { ok: true, status: res.status, data: Array.isArray(body?._data) ? body._data : [], next };
    }
  } catch (err) {
    return { ok: false, status: 0, error: `Network error: ${err.message || err}` };
  }
}

/** Renders a small @2x image from a per-point coverage function returning [r, g, b, alpha 0..1]. */
function drawImage(sizePt, shade) {
  const scale = 2;
  const n = sizePt * scale;
  const buf = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const [r, g, b, a] = shade((x + 0.5) / scale, (y + 0.5) / scale);
      const i = (y * n + x) * 4;
      // BGRA, premultiplied.
      buf[i] = Math.round(b * a);
      buf[i + 1] = Math.round(g * a);
      buf[i + 2] = Math.round(r * a);
      buf[i + 3] = Math.round(255 * a);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: n, height: n, scaleFactor: scale });
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function segmentDistance(px, py, ax, ay, bx, by) {
  const t = clamp01(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2));
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}

/** The gnomon mark for the menu bar (a template image, so macOS tints it for light/dark). See scripts/make-icon.cjs. */
const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
trayIcon.setTemplateImage(true);

const dotCache = new Map();
function colorDot(hex) {
  if (!dotCache.has(hex)) {
    const v = parseInt(String(hex).replace('#', ''), 16) || 0;
    const rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    dotCache.set(hex, drawImage(12, (x, y) => [...rgb, clamp01(4.5 - Math.hypot(x - 6, y - 6) + 0.5)]));
  }
  return dotCache.get(hex);
}

/** Small monochrome menu icons (template images, tinted by macOS). */
function glyph(shapeFn) {
  const img = drawImage(16, (x, y) => [0, 0, 0, clamp01(shapeFn(x, y))]);
  img.setTemplateImage(true);
  return img;
}
const inTriangle = (x, y) => {
  // Play triangle with vertices (4,3), (4,13), (13,8).
  const edge = (ax, ay, bx, by) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const a = edge(4, 3, 13, 8), b = edge(13, 8, 4, 13), c = edge(4, 13, 4, 3);
  return a >= 0 && b >= 0 && c >= 0 ? 1 : 0;
};
const icons = {
  play: glyph((x, y) => inTriangle(x, y)),
  pause: glyph((x, y) => (y > 3 && y < 13 && ((x > 4 && x < 7) || (x > 9 && x < 12)) ? 1 : 0)),
  stop: glyph((x, y) => (x > 4 && x < 12 && y > 4 && y < 12 ? 1 : 0)),
  // Crescent moon for "leave".
  leave: glyph((x, y) => (Math.hypot(x - 8, y - 8) < 5.5 && Math.hypot(x - 10.5, y - 6) > 4.5 ? 1 : 0)),
  note: glyph((x, y) => ((Math.abs(y - 5) < 0.8 || Math.abs(y - 8) < 0.8 || Math.abs(y - 11) < 0.8) && x > 3 && x < 13 ? 1 : 0)),
  search: glyph((x, y) => {
    const d = Math.hypot(x - 7, y - 7);
    return Math.abs(d - 3.6) < 0.9 || segmentDistance(x, y, 9.6, 9.6, 13, 13) < 0.9 ? 1 : 0;
  }),
  window: glyph((x, y) => ((x > 3 && x < 13 && y > 4 && y < 12 && (x < 4.2 || x > 11.8 || y < 6.4 || y > 10.8)) ? 1 : 0)),
};

// Material Symbols rasterised by the renderer (see useMenuIcons); the drawn glyphs above are the fallback.
const materialIcons = {};
const FALLBACK = { play_arrow: 'play', login: 'play', pause: 'pause', coffee: 'pause', stop: 'stop', logout: 'leave', search: 'search', open_in_full: 'window' };
const menuIcon = (name) => materialIcons[name] ?? icons[FALLBACK[name]];

ipcMain.on('tray:icons', (_e, urls) => {
  for (const [name, url] of Object.entries(urls)) {
    if (typeof url !== 'string' || !url.startsWith('data:image/png;base64,')) continue;
    const img = nativeImage.createFromBuffer(Buffer.from(url.split(',')[1], 'base64'), { scaleFactor: 2 });
    img.setTemplateImage(true);
    materialIcons[name] = img;
  }
  trayMenuKey = ''; // rebuild the menu with the new icons on the next update
  if (lastState) updateTray(lastState);
});

/** While a timer runs, the menu bar mark takes the project's colour. */
const runningIconCache = new Map();
function runningIcon(hex) {
  if (!runningIconCache.has(hex)) {
    const v = parseInt(String(hex).replace('#', ''), 16) || 0;
    const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    const { width, height } = trayIcon.getSize();
    const buf = Buffer.from(trayIcon.toBitmap({ scaleFactor: 2 }));
    for (let i = 0; i < buf.length; i += 4) {
      // BGRA, premultiplied: keep the shape's alpha, swap in the colour.
      const a = buf[i + 3] / 255;
      buf[i] = Math.round(b * a);
      buf[i + 1] = Math.round(g * a);
      buf[i + 2] = Math.round(r * a);
    }
    runningIconCache.set(hex, nativeImage.createFromBitmap(buf, { width: width * 2, height: height * 2, scaleFactor: 2 }));
  }
  return runningIconCache.get(hex);
}

const fakeNowArgs = () => (process.env.CAPTURE && process.env.FAKE_NOW ? [`--fake-now=${Date.parse(process.env.FAKE_NOW)}`] : []);

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 860,
    minHeight: 580,
    title: 'Gnomon',
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#15181c' : '#f5f6f8',
    show: !process.env.CAPTURE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Screenshots only: FAKE_NOW (an ISO time) starts the page's clock there (see preload.cjs).
      additionalArguments: fakeNowArgs(),
    },
  });

  // Gnomon never navigates away or opens other windows from its pages.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: process.env.START_VIEW || '' });

  // Closing the window keeps the app (and a running timer) alive in the menu bar.
  win.on('close', (e) => {
    if (!quitting && process.platform === 'darwin') {
      e.preventDefault();
      win.hide();
    }
  });

  if (process.env.CAPTURE) {
    win.webContents.once('did-finish-load', async () => {
      // CAPTURE_JS runs a script in the page first (e.g. clicking a button), for end-to-end checks.
      if (process.env.CAPTURE_JS) await win.webContents.executeJavaScript(process.env.CAPTURE_JS).catch((e) => console.error(e));
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(process.env.CAPTURE, image.toPNG());
        if (process.env.CAPTURE_QUICK) {
          showQuick(process.env.CAPTURE_QUICK);
          await new Promise((r) => setTimeout(r, 1500));
          fs.writeFileSync(process.env.CAPTURE.replace(/\.png$/, '-quick.png'), (await quickWin.webContents.capturePage()).toPNG());
        }
        if (process.env.CAPTURE_TRAY && tray) {
          const dump = (menu) => menu.items.map((i) => (i.submenu ? { [i.label]: dump(i.submenu) } : i.type === 'separator' ? '---' : i.type === 'header' ? `## ${i.label}` : `${i.label}${i.sublabel ? ` (${i.sublabel})` : ''}${i.accelerator ? `  [${i.accelerator}]` : ''}${i.enabled === false ? '  (info)' : ''}`));
          const shortcuts = shortcutStatus;
          fs.writeFileSync(process.env.CAPTURE_TRAY, JSON.stringify({ title: tray.getTitle(), shortcuts, menu: dump(lastTrayMenu) }, null, 2));
          fs.writeFileSync(process.env.CAPTURE_TRAY.replace(/\.json$/, '.png'), trayIcon.resize({ width: 72 }).toPNG());
        }
        quitting = true;
        app.exit(0);
      }, Number(process.env.CAPTURE_DELAY) || 1500);
    });
  }
}

function showWindow() {
  if (!win) createWindow();
  win.show();
  win.focus();
}

/** UI text in the language chosen in Settings: the renderer sends the templates with every tray update. */
function tr(key, vars = {}) {
  const template = lastState?.strings?.[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function sendAction(action) {
  if (win) win.webContents.send('tray:action', action);
}

/**
 * Menu bar menu, in three sections by how often you need them:
 *   Now: the running timer (stop, change activity)
 *   Start / Switch to: today's plan, recent entries, other projects, search
 *   Workday: clock in, break, clock out
 */
function buildTrayMenu(state) {
  const header = (label) => ({ type: 'header', label });
  const sc = shortcutConfig(state);
  const acc = (a) => (state.shortcutsEnabled && a ? a : undefined);
  const items = [];

  // Now
  items.push(header(tr('now')));
  if (state.running) {
    items.push({ label: state.runningLabel, icon: colorDot(state.runningProjectColor), enabled: false });
    items.push({ label: state.runningDetail, enabled: false });
    items.push({ label: tr('stopTimer'), icon: menuIcon('stop'), accelerator: acc(sc.stopResume), click: () => sendAction({ type: 'stop-timer' }) });
    if (state.activities.length) {
      items.push({
        label: tr('changeActivity'),
        submenu: [
          { label: tr('newEntryFromNow'), enabled: false },
          { type: 'separator' },
          ...state.activities.map((a) => ({
            label: a.name,
            type: 'checkbox',
            checked: a.id === state.runningActivityId,
            click: () => sendAction({ type: 'switch-activity', activityId: a.id }),
          })),
        ],
      });
    }
  } else {
    items.push({ label: tr('noTimer'), enabled: false });
  }

  // Start / switch to: one list; starting something here stops the running timer.
  items.push({ type: 'separator' }, header(tr(state.running ? 'switchTo' : 'start')));
  const start = (q) => () => sendAction({ type: 'start', description: q.description ?? '', projectId: q.projectId, activityId: q.activityId, billable: q.billable, taskId: q.taskId, taskName: q.taskName });
  for (const t of state.todayPlan) items.push({ label: t.label, sublabel: tr('plannedToday'), icon: colorDot(t.color), click: start(t) });
  for (const r of state.recent) items.push({ label: r.label, icon: r.color ? colorDot(r.color) : undefined, click: start(r) });
  if (state.projects.length) {
    items.push({
      label: tr('otherProject'),
      submenu: state.projects.map((p, i) => ({ label: p.name, icon: colorDot(p.color), accelerator: acc(projectAccel(sc.projects, i)), click: start({ projectId: p.id }) })),
    });
  }
  items.push({ label: tr('search'), icon: menuIcon('search'), accelerator: acc(sc.quick), click: () => showQuick('start') });

  // Workday
  items.push({ type: 'separator' }, header(tr('workday')), { label: state.status, enabled: false });
  if (state.dayActive) {
    items.push({ label: tr(state.onBreak ? 'endBreak' : 'takeBreak'), icon: menuIcon(state.onBreak ? 'play_arrow' : 'coffee'), accelerator: acc(sc.breakToggle), click: () => sendAction({ type: 'toggle-break' }) });
    items.push({ label: tr('clockOut'), icon: menuIcon('logout'), click: leaveFromMenu });
  } else {
    items.push({ label: tr(state.dayEnded ? 'resumeDay' : 'startDay'), icon: menuIcon('login'), click: () => sendAction({ type: 'start-day' }) });
  }

  items.push({ type: 'separator' }, { label: tr('openGnomon'), icon: menuIcon('open_in_full'), click: showWindow }, { label: tr('quitGnomon'), role: 'quit' });
  return Menu.buildFromTemplate(items);
}

function leaveFromMenu() {
  sendAction({ type: 'leave' });
  if (lastState?.reviewOnLeave) {
    showWindow();
    setTimeout(() => sendAction({ type: 'show-review' }), 300);
  }
}

function updateTray(state) {
  lastState = state;
  if (!tray) tray = new Tray(trayIcon);
  tray.setImage(state.runningColor ? runningIcon(state.runningColor) : trayIcon);
  tray.setTitle(state.title ? ` ${state.title}` : '', { fontType: 'monospacedDigit' });
  tray.setToolTip(state.tooltip || 'Gnomon');
  // The renderer reports every second for the clock; only rebuild the menu when its contents change.
  const key = JSON.stringify({ ...state, title: undefined, tooltip: undefined });
  if (key !== trayMenuKey) {
    trayMenuKey = key;
    lastTrayMenu = buildTrayMenu(state);
    tray.setContextMenu(lastTrayMenu);
  }
  syncShortcuts(state);
  syncApiServer(state);
  trackNudges(state);
}

// ---- Global shortcuts --------------------------------------------------------

// macOS's own shortcuts (System Settings → Keyboard → Keyboard Shortcuts) win over apps without telling them,
// so Electron reports them as registered. Read the enabled ones and treat them as taken.
const normAccel = (a) => {
  const parts = String(a).split('+');
  const key = parts.pop();
  return [...parts.sort(), key].join('+');
};
function macReservedAccels() {
  try {
    const { execFileSync } = require('child_process');
    const xml = execFileSync('defaults', ['export', 'com.apple.symbolichotkeys', '-'], { timeout: 3000 });
    const json = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml, timeout: 3000 }).toString());
    const keycodes = { 49: 'Space', 123: 'Left', 124: 'Right', 125: 'Down', 126: 'Up', 36: 'Return', 48: 'Tab' };
    const out = new Set();
    for (const hk of Object.values(json.AppleSymbolicHotKeys || {})) {
      const p = hk?.enabled && hk.value?.parameters;
      if (!p) continue;
      const [ascii, keycode, flags] = p;
      const key = keycodes[keycode] ?? (ascii > 32 && ascii < 127 ? String.fromCharCode(ascii).toUpperCase() : null);
      if (!key) continue;
      const mods = [flags & 262144 && 'Control', flags & 524288 && 'Alt', flags & 131072 && 'Shift', flags & 1048576 && 'Command'].filter(Boolean);
      if (mods.length) out.add(normAccel([...mods, key].join('+')));
    }
    return out;
  } catch {
    return new Set();
  }
}

/** A short, silent notification so a shortcut pressed in another app visibly did something. */
function confirmShortcut(text) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: 'Gnomon', body: text, silent: true });
  n.show();
  setTimeout(() => n.close(), 2500);
}

// Which accelerators registered successfully, so Settings can show "works" / "taken".
let shortcutStatus = {};
let shortcutsSuspended = false;

const DEFAULT_SHORTCUTS = { quick: 'Control+Alt+P', stopResume: 'Control+Alt+S', breakToggle: 'Control+Alt+B', projects: 'Control+Alt' };
const shortcutConfig = (s) => ({ ...DEFAULT_SHORTCUTS, ...(s?.shortcuts || {}) });
const projectAccel = (mod, i) => (mod && i < 9 ? `${mod}+${i + 1}` : undefined);

function syncShortcuts(state, force = false) {
  const enabled = Boolean(state?.shortcutsEnabled) && !shortcutsSuspended;
  const cfg = shortcutConfig(state);
  const key = JSON.stringify({ enabled, cfg });
  if (!force && key === registeredShortcuts) return;
  registeredShortcuts = key;
  globalShortcut.unregisterAll();
  shortcutStatus = {};
  if (!enabled) return;
  const reserved = macReservedAccels();
  const bind = (accel, handler) => {
    if (!accel) return;
    const fn = () => {
      console.log(`[shortcuts] pressed ${accel}`);
      handler();
    };
    let ok = false;
    try {
      ok = globalShortcut.register(accel, fn);
    } catch {
      ok = false; // invalid accelerator
    }
    shortcutStatus[accel] = ok && !reserved.has(normAccel(accel));
    console.log(`[shortcuts] ${accel}: ${shortcutStatus[accel] ? 'registered' : reserved.has(normAccel(accel)) ? 'taken by macOS' : 'NOT registered (taken by another app?)'}`);
  };
  bind(cfg.quick, () => showQuick('start'));
  bind(cfg.stopResume, () => {
    const wasRunning = lastState?.running;
    sendAction({ type: wasRunning ? 'stop-timer' : 'resume' });
    confirmShortcut(wasRunning ? `${tr('stopTimer')}: ${wasRunning}` : tr('resumed'));
  });
  bind(cfg.breakToggle, () => {
    sendAction({ type: 'toggle-break' });
    confirmShortcut(tr(lastState?.onBreak ? 'endBreak' : 'takeBreak'));
  });
  for (let i = 0; i < 9; i++) {
    bind(projectAccel(cfg.projects, i), () => {
      const p = lastState?.projects[i];
      if (p) sendAction({ type: 'start', description: '', projectId: p.id });
    });
  }
}

ipcMain.handle('shortcuts:status', () => shortcutStatus);
// While Settings records a new shortcut, global shortcuts are paused so the keys reach the window.
ipcMain.on('shortcuts:suspend', (_e, on) => {
  shortcutsSuspended = Boolean(on);
  syncShortcuts(lastState, true);
});

// ---- Quick switcher -----------------------------------------------------------

function quickUrl(mode) {
  return DEV_URL ? `${DEV_URL}#quick-${mode}` : null;
}

let quickShownAt = 0;

function showQuick(mode) {
  if (!quickWin) {
    quickWin = new BrowserWindow({
      width: 560,
      height: 420,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      vibrancy: 'popover',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
      transparent: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, additionalArguments: fakeNowArgs() },
    });
    quickWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    quickWin.webContents.on('will-navigate', (e) => e.preventDefault());
    const url = quickUrl(mode);
    if (url) quickWin.loadURL(url);
    else quickWin.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: `quick-${mode}` });
    // Close when you click elsewhere, but ignore the focus flicker right after opening from another app.
    quickWin.on('blur', () => {
      if (Date.now() - quickShownAt > 400) quickWin?.hide();
    });
    quickWin.on('closed', () => (quickWin = null));
    quickWin.webContents.once('did-finish-load', () => present(mode));
    return;
  }
  present(mode);
}

function present(mode) {
  // Show on the screen the mouse is on, in the upper third like Spotlight.
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [w] = quickWin.getSize();
  quickWin.setPosition(Math.round(workArea.x + (workArea.width - w) / 2), Math.round(workArea.y + workArea.height * 0.2));
  quickWin.webContents.send('quick:show', mode);
  quickShownAt = Date.now();
  // Opened via a global shortcut, Gnomon isn't the active app yet; take focus so typing goes to the switcher.
  app.focus({ steal: true });
  quickWin.show();
  quickWin.focus();
  quickWin.webContents.focus();
}

ipcMain.on('quick:action', (_e, action) => {
  quickWin?.hide();
  sendAction(action);
});
ipcMain.on('quick:hide', () => quickWin?.hide());
ipcMain.on('quick:open', () => {
  quickWin?.hide();
  showWindow();
});

// ---- Activity trail (opt-in) -------------------------------------------------
// Once a minute while you're clocked in, note the name of the frontmost app (never window titles),
// merged into spans per day. Stored locally in trail.json and only shown in Gnomon's reviews.

const { execFile } = require('child_process');
const IGNORED_APPS = new Set(['Gnomon', 'Electron', 'loginwindow', 'ScreenSaverEngine']);
const TRAIL_DAYS = 62;

function readTrail() {
  try {
    return JSON.parse(fs.readFileSync(trailFile(), 'utf8'));
  } catch {
    return {};
  }
}

function frontmostApp() {
  return new Promise((resolve) => {
    execFile('lsappinfo', ['front'], (err, asn) => {
      if (err || !asn.trim()) return resolve(null);
      execFile('lsappinfo', ['info', '-only', 'name', asn.trim()], (err2, out) => resolve(err2 ? null : (out.match(/"([^"]+)"/) || [])[1] || null));
    });
  });
}

async function sampleTrail() {
  const s = lastState;
  if (companyProfile?.allowActivityTrail === false) return; // switched off by the company profile
  if (!s?.trailEnabled || !s.dayActive || s.onBreak || powerMonitor.getSystemIdleTime() > 120) return;
  const appName = await frontmostApp();
  if (!appName || IGNORED_APPS.has(appName)) return;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const trail = readTrail();
  const spans = (trail[day] ??= []);
  const last = spans[spans.length - 1];
  const lastEnd = last ? Number(last.end.slice(0, 2)) * 60 + Number(last.end.slice(3)) : -10;
  if (last && last.app === appName && minutes - lastEnd <= 2) last.end = hhmm;
  else spans.push({ app: appName, start: hhmm, end: hhmm });
  // Keep about two months.
  for (const k of Object.keys(trail).sort().slice(0, -TRAIL_DAYS)) delete trail[k];
  writeAtomic(trailFile(), JSON.stringify(trail));
}

ipcMain.handle('trail:get', (_e, day) => readTrail()[day] ?? []);
ipcMain.handle('trail:clear', () => fs.rmSync(trailFile(), { force: true }));

// ---- Local REST API ------------------------------------------------------------
// Off by default. Listens on 127.0.0.1 (or the network, if allowed) and needs a Bearer key.
// Requests are answered by the window's state logic (src/api.ts), so the UI updates live.

const http = require('http');
const crypto = require('crypto');
let apiServer = null;
let apiConfigKey = '';
const pendingApi = new Map();

// Decrypted once per launch (each decrypt can ask for the keychain password), then kept in memory.
let apiKeyCache;
function readApiKey() {
  if (apiKeyCache !== undefined) return apiKeyCache;
  try {
    const stored = JSON.parse(fs.readFileSync(apiKeyFile(), 'utf8'));
    const buf = Buffer.from(stored.value, 'base64');
    apiKeyCache = stored.encrypted ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch {
    apiKeyCache = null;
  }
  return apiKeyCache;
}

function generateApiKey() {
  const key = `gnomon_${crypto.randomBytes(24).toString('base64url')}`;
  apiKeyCache = key;
  const encrypted = safeStorage.isEncryptionAvailable();
  const value = encrypted ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8');
  writeAtomic(apiKeyFile(), JSON.stringify({ encrypted, value: value.toString('base64') }));
  return key;
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' });
  res.end(text);
}

function handleApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/v1/')) return sendJson(res, 404, { error: 'not_found', message: 'Use /api/v1/…' });
  const key = readApiKey();
  const auth = req.headers.authorization || '';
  if (!key || !auth.startsWith('Bearer ') || !sameSecret(auth.slice(7), key)) return sendJson(res, 401, { error: 'unauthorized', message: 'Missing or wrong API key' });
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });

  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > 1_000_000) req.destroy();
    else chunks.push(c);
  });
  req.on('end', () => {
    let body = null;
    if (chunks.length) {
      if (!String(req.headers['content-type'] || '').includes('application/json')) return sendJson(res, 415, { error: 'unsupported_media_type', message: 'Send JSON with Content-Type: application/json' });
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return sendJson(res, 400, { error: 'invalid_json' });
      }
    }
    if (!win || win.webContents.isLoading()) return sendJson(res, 503, { error: 'not_ready', message: 'Gnomon is starting, try again' });
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingApi.delete(id);
      sendJson(res, 504, { error: 'timeout' });
    }, 5000);
    pendingApi.set(id, (r) => {
      clearTimeout(timer);
      sendJson(res, r.status, r.body);
    });
    win.webContents.send('api:request', { id, method: req.method, path: url.pathname.slice('/api/v1'.length), query: Object.fromEntries(url.searchParams), body });
  });
}

ipcMain.on('api:response', (_e, { id, status, body }) => {
  const done = pendingApi.get(id);
  if (done) {
    pendingApi.delete(id);
    done({ status, body });
  }
});
ipcMain.handle('api:hasKey', () => Boolean(readApiKey()));
ipcMain.handle('api:generateKey', () => generateApiKey());
ipcMain.handle('api:status', () => ({ running: Boolean(apiServer?.listening), address: apiServer?.address() ?? null }));

function syncApiServer(s) {
  // The company profile can forbid the local API; then it stays off whatever the setting says.
  const config = s.apiEnabled && companyProfile?.allowLocalApi !== false ? `${s.apiPort}|${s.apiLan}` : '';
  if (config === apiConfigKey) return;
  apiConfigKey = config;
  if (apiServer) {
    apiServer.close();
    apiServer = null;
  }
  if (!config) return;
  apiServer = http.createServer(handleApi);
  apiServer.on('error', (err) => {
    console.error('API server:', err.message);
    apiServer = null;
    apiConfigKey = '';
    win?.webContents.send('api:error', err.code === 'EADDRINUSE' ? tr('portInUse', { port: s.apiPort }) : err.message);
  });
  apiServer.listen(s.apiPort, s.apiLan ? '0.0.0.0' : '127.0.0.1');
}

// ---- Idle detection & nudges ------------------------------------------------

let idleSince = null;
let notifiedNothingRunning = false;
let notifiedLongEntry = null;
let nothingRunningSince = null;

// Watch for absence whenever you're clocked in (with or without a timer).
const tracking = (s) => Boolean(s && s.idleMinutes && (s.running || (s.dayActive && !s.onBreak)));

function checkIdle() {
  const s = lastState;
  if (!tracking(s)) {
    idleSince = null;
    return;
  }
  const idle = powerMonitor.getSystemIdleTime();
  if (!idleSince && idle >= s.idleMinutes * 60) idleSince = new Date(Date.now() - idle * 1000);
  if (idleSince && idle < 15) askAboutIdle();
}

let asking = false;
async function askAboutIdle() {
  const since = idleSince;
  idleSince = null;
  if (asking || !since || !tracking(lastState)) return;
  asking = true;
  const minutes = Math.round((Date.now() - since.getTime()) / 60_000);
  const at = since.toLocaleTimeString(lastState?.locale || [], { hour: '2-digit', minute: '2-digit' });
  const away = minutes >= 120 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
  const running = lastState?.running;
  const options = running
    ? [['keep', tr('idleKeep')], ['discard', tr('idleDiscard')], ['break', tr('idleBreak')], ['leave', tr('idleLeave', { time: at })]]
    : [['keep', tr('idleKeep')], ['break', tr('idleBreak')], ['leave', tr('idleLeave', { time: at })]];
  // After a long absence (e.g. overnight) you most likely went home.
  const longAway = minutes >= 180;
  const { response } = await dialog.showMessageBox({
    type: 'question',
    message: tr('idleMessage', { away, time: at }),
    detail: running ? tr('idleDetailRunning', { name: running }) : tr('idleDetail'),
    buttons: options.map((o) => o[1]),
    defaultId: longAway ? options.length - 1 : 0,
    cancelId: 0,
  });
  asking = false;
  const choice = options[response][0];
  if (choice !== 'keep') sendAction({ type: 'idle', since: since.toISOString(), choice });
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  if (onClick) n.on('click', onClick);
  n.show();
}

// Reminders worked out in the window (src/reminders.ts): plain text only; a click opens the window.
ipcMain.on('notify', (_e, msg) => {
  if (msg && typeof msg.title === 'string' && typeof msg.body === 'string') notify(msg.title.slice(0, 120), msg.body.slice(0, 300), showWindow);
});

function trackNudges(s) {
  if (s.reminders === false) return;
  // Clocked in, not on a break, but no timer for 20 minutes (live tracking only: when you clock in and fill in
  // later, no timer is the normal case).
  if (s.workStyle !== 'clock' && s.dayActive && !s.onBreak && !s.running) {
    nothingRunningSince ??= Date.now();
    if (!notifiedNothingRunning && Date.now() - nothingRunningSince > 20 * 60_000) {
      notifiedNothingRunning = true;
      notify(tr('nothingTracked'), tr('nothingTrackedBody'), () => showQuick('start'));
    }
  } else {
    nothingRunningSince = null;
    notifiedNothingRunning = false;
  }
  // The same timer has been running for 4 hours.
  if (s.running && s.runningSince && Date.now() - Date.parse(s.runningSince) > 4 * 3_600_000 && notifiedLongEntry !== s.runningSince) {
    notifiedLongEntry = s.runningSince;
    notify(tr('stillOn', { name: s.running }), tr('stillOnBody'), showWindow);
  }
}

powerMonitor.on('suspend', () => {
  if (tracking(lastState) && !idleSince) idleSince = new Date();
});
powerMonitor.on('lock-screen', () => {
  if (tracking(lastState) && !idleSince) idleSince = new Date();
});
powerMonitor.on('unlock-screen', () => {
  if (idleSince && Date.now() - idleSince.getTime() >= (lastState?.idleMinutes ?? 0) * 60_000) askAboutIdle();
  else idleSince = null;
});

ipcMain.handle('data:load', () => readData());
ipcMain.handle('data:save', (_e, data) => writeAtomic(dataFile(), JSON.stringify(data, null, 2)));
ipcMain.on('data:saveSync', (e, data) => {
  writeAtomic(dataFile(), JSON.stringify(data, null, 2));
  e.returnValue = true;
});
ipcMain.on('tray:update', (_e, state) => updateTray(state));
// Feedback opens a new mail to a fixed address; the page can't choose the target.
ipcMain.on('feedback:open', () => shell.openExternal(`mailto:info@dennha.de?subject=${encodeURIComponent(`Gnomon feedback (v${app.getVersion()})`)}`));
ipcMain.handle('float:setToken', (_e, token) => writeFloatToken(typeof token === 'string' ? token.trim() : null));
ipcMain.handle('float:hasToken', () => Boolean(readFloatToken()));
ipcMain.handle('personio:setCredentials', (_e, creds) => writePersonioCredentials(creds));
ipcMain.handle('personio:hasCredentials', () => Boolean(readPersonioCredentials()));
ipcMain.handle('personio:get', (_e, { path: apiPath, query }) => personioGet(apiPath, query));

// ---- Gnomon server (see server/README.md) ------------------------------------------
// The Mac connects to a self-hosted Gnomon server once (with a pairing code), so it can show a QR code that
// signs in a phone. The key is encrypted with the keychain and never handed to the window. Time sync comes later.
const serverFile = () => path.join(app.getPath('userData'), 'server.json');

let serverCache; // decrypted once per app start: macOS may ask for keychain access on each read

function readServer() {
  if (serverCache !== undefined) return serverCache;
  try {
    const s = JSON.parse(fs.readFileSync(serverFile(), 'utf8'));
    const buf = Buffer.from(s.key, 'base64');
    return (serverCache = { url: s.url, name: s.name, key: s.encrypted ? safeStorage.decryptString(buf) : buf.toString('utf8') });
  } catch {
    return null; // no file, or keychain access denied (then the next read asks again)
  }
}

function writeServer(v) {
  serverCache = v || null;
  if (!v) return fs.rmSync(serverFile(), { force: true });
  const encrypted = safeStorage.isEncryptionAvailable();
  const key = encrypted ? safeStorage.encryptString(v.key) : Buffer.from(v.key, 'utf8');
  writeAtomic(serverFile(), JSON.stringify({ url: v.url, name: v.name, encrypted, key: key.toString('base64') }));
}

/** Only the origin; HTTPS required except for a server on this Mac (testing). */
function serverOrigin(input) {
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(String(input).trim()) ? String(input).trim() : `https://${String(input).trim()}`);
  } catch {
    return null;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
  return u.origin;
}

async function serverCall(origin, method, apiPath, body, key, timeoutMs = 10_000) {
  let res;
  try {
    res = await fetch(`${origin}/api/v1${apiPath}`, {
      method,
      headers: { ...(key && { Authorization: `Bearer ${key}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
  } catch {
    return { ok: false, error: 'unreachable' };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: res.status === 401 ? 'unauthorized' : json.message || `HTTP ${res.status}` };
  return { ok: true, data: json };
}

const serverStatus = () => {
  const s = readServer();
  return s ? { connected: true, url: s.url, name: s.name } : { connected: false };
};

ipcMain.handle('server:status', () => serverStatus());
ipcMain.handle('server:connect', async (_e, { url, code }) => {
  const origin = serverOrigin(url);
  if (!origin) return { ok: false, error: 'bad_url' };
  const value = String(code ?? '').trim();
  if (!value) return { ok: false, error: 'no_code' };
  let key = value;
  if (!/^(gnomon|punch)_/.test(value)) {
    const r = await serverCall(origin, 'POST', '/pair', { code: value });
    if (!r.ok) return { ok: false, error: r.status === 401 ? 'invalid_code' : r.error };
    key = r.data.key;
  }
  const me = await serverCall(origin, 'GET', '/me', undefined, key);
  if (!me.ok) return { ok: false, error: me.error };
  writeServer({ url: origin, name: me.data.name, key });
  fs.rmSync(syncStateFile(), { force: true }); // a new connection starts with a first sync
  return { ok: true, ...serverStatus() };
});
ipcMain.handle('server:disconnect', async () => {
  const s = readServer();
  if (s) await serverCall(s.url, 'DELETE', '/me', undefined, s.key); // revoke this Mac's key; ignore if offline
  writeServer(null);
  fs.rmSync(syncStateFile(), { force: true });
  return serverStatus();
});
ipcMain.handle('server:pairCode', async (_e, name) => {
  const s = readServer();
  if (!s) return { ok: false, error: 'not_connected' };
  const r = await serverCall(s.url, 'POST', '/pair-codes', { name: String(name || 'iPhone').slice(0, 60) }, s.key);
  if (!r.ok) return r;
  return { ok: true, code: r.data.code, expiresAt: r.data.expiresAt, link: `${s.url}/#pair=${r.data.code}` };
});
// Sync (src/sync.ts does the merging in the window; here only the HTTP calls with the key, and the sync state:
// the cursor and the last agreed version of every record, kept next to data.json).
const syncStateFile = () => path.join(app.getPath('userData'), 'server-sync.json');
ipcMain.handle('server:syncState', () => {
  const s = readServer();
  try {
    const st = JSON.parse(fs.readFileSync(syncStateFile(), 'utf8'));
    return s && st.url === s.url ? st : null; // another server: start over
  } catch {
    return null;
  }
});
ipcMain.handle('server:setSyncState', (_e, state) => {
  const s = readServer();
  if (!s || !state || typeof state.cursor !== 'number' || typeof state.base !== 'object') return false;
  writeAtomic(syncStateFile(), JSON.stringify({ url: s.url, cursor: state.cursor, base: state.base, at: new Date().toISOString() }));
  return true;
});
ipcMain.handle('server:syncPull', async (_e, since) => {
  const s = readServer();
  if (!s) return { ok: false, error: 'not_connected' };
  const r = await serverCall(s.url, 'GET', `/sync?since=${Math.max(0, Math.floor(Number(since) || 0))}&limit=5000`, undefined, s.key, 30_000);
  return r.ok ? { ok: true, ...r.data } : r;
});
ipcMain.handle('server:syncPush', async (_e, changes) => {
  const s = readServer();
  if (!s) return { ok: false, error: 'not_connected' };
  if (!Array.isArray(changes)) return { ok: false, error: 'invalid' };
  const r = await serverCall(s.url, 'POST', '/sync', { changes }, s.key, 60_000);
  return r.ok ? { ok: true, ...r.data } : r;
});
ipcMain.handle('float:get', (_e, { path: apiPath, contact }) => floatGet(apiPath, contact));

app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => globalShortcut.unregisterAll());

// ---- Moving over from "Punch", the app's first name -----------------------------------
// Electron names the data folder and the keychain key after the app, so after the rename both start empty.
// On the first launch as Gnomon, copy the data over and re-encrypt saved secrets with Gnomon's key.
// The old folder and keychain item stay as they were.
function migrateFromPunch() {
  if (process.env.USER_DATA_DIR) return;
  const dir = app.getPath('userData');
  const old = path.join(app.getPath('appData'), 'Punch');
  if (fs.existsSync(dataFile()) || !fs.existsSync(path.join(old, 'data.json'))) return;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const f of ['data.json', 'trail.json']) {
    if (fs.existsSync(path.join(old, f))) writeAtomic(path.join(dir, f), fs.readFileSync(path.join(old, f)));
  }
  let oldKey;
  const decryptOld = (buf) => {
    // Chromium's macOS format: "v10" + AES-128-CBC, key derived from the keychain password.
    if (oldKey === undefined) {
      oldKey = null; // ask the keychain once, even if it's denied
      const { execFileSync } = require('child_process');
      const pw = execFileSync('security', ['find-generic-password', '-w', '-s', 'Punch Safe Storage', '-a', 'Punch']).toString().trim();
      oldKey = crypto.pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1');
    }
    if (!oldKey) throw new Error('no access to the old keychain key');
    if (buf.subarray(0, 3).toString() !== 'v10') throw new Error('unknown format');
    const d = crypto.createDecipheriv('aes-128-cbc', oldKey, Buffer.alloc(16, ' '));
    return Buffer.concat([d.update(buf.subarray(3)), d.final()]).toString('utf8');
  };
  // Field holding the secret: "key" in server.json, "value" elsewhere.
  for (const [f, field] of [['float-token.json', 'value'], ['personio-credentials.json', 'value'], ['api-key.json', 'value'], ['server.json', 'key']]) {
    if (!fs.existsSync(path.join(old, f))) continue;
    try {
      const stored = JSON.parse(fs.readFileSync(path.join(old, f), 'utf8'));
      if (stored.encrypted) stored[field] = safeStorage.encryptString(decryptOld(Buffer.from(stored[field], 'base64'))).toString('base64');
      writeAtomic(path.join(dir, f), JSON.stringify(stored));
    } catch (err) {
      console.warn(`[migrate] couldn't move ${f}: ${err.message}`); // that connection just needs setting up again
    }
  }
  console.log(`[migrate] moved data from ${old}`);
}

app.whenReady().then(() => {
  migrateFromPunch();
  // In development the Dock would show Electron's icon; the built app gets build/icon.png from electron-builder.
  if (!app.isPackaged && app.dock) app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
  createWindow();
  setInterval(checkIdle, 20_000);
  setInterval(sampleTrail, 60_000);
  app.on('activate', showWindow);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
