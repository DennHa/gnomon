// The web app's stand-in for the Mac app's bridge (electron/preload.cjs), like the demo's (src/demo/bridge.ts), but
// talking to the Gnomon server it's served from. The data lives on the server: loading pulls everything of the
// signed-in person, and the store's own sync (src/store.tsx, src/sync.ts) sends each change a few seconds later, the
// same way a Mac does. Nothing is kept in the browser but the highlight colour and a few reminders' "shown today". The session is an HttpOnly
// cookie; every request also carries the CSRF token the server gave at sign-in (server/src/web.ts).
import { version } from '../../package.json';
import { accountJson, applyChanges, baseOf, localChanges, type Change, type RemoteAccount, type SyncState } from '../sync';
import type { Data, Settings } from '../types';

(window as { gnomonWeb?: boolean }).gnomonWeb = true;

export type WebSession = { csrf: string; me: { name: string; email: string | null; role: 'admin' | 'member' }; device: string };

let session: WebSession | null = null;
let syncState: SyncState | null = null;

export class WebError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A request to this server's API with the session cookie and the CSRF token. */
export async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, keepalive = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: { ...(session && { 'X-Gnomon-CSRF': session.csrf }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive,
    });
  } catch {
    throw new WebError(0, 'unreachable');
  }
  const json = (await res.json().catch(() => ({}))) as { message?: string };
  if (res.status === 401 && path !== '/web/login' && path !== '/web/session') {
    // Signed out elsewhere ("Sign out everywhere", the device removed): back to the sign-in page.
    location.reload();
  }
  if (!res.ok) throw new WebError(res.status, json.message || `HTTP ${res.status}`);
  return json as T;
}

/** Who's signed in (null: show the sign-in page). */
export async function loadSession(): Promise<WebSession | null> {
  try {
    session = await call<WebSession>('GET', '/web/session');
  } catch (err) {
    if (err instanceof WebError && err.status === 401) return null;
    throw err;
  }
  return session;
}

export async function signIn(email: string, password: string): Promise<WebSession> {
  session = await call<WebSession>('POST', '/web/login', { email, password });
  return session;
}

async function signOut() {
  try {
    await call('POST', '/web/logout');
  } finally {
    session = null;
    location.reload();
  }
}

// Per browser: the highlight colour, Labs, and what was shown today already (the morning welcome, the daily
// celebration, the week reminder). Everything else comes from the account.
const LOOK_KEY = 'gnomon.web.look';
const LOOK = ['accent', 'labs', 'daylight', 'daylightUnlocked', 'welcomedDay', 'celebratedDay', 'weekReminded'] as const;
function readLook(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(LOOK_KEY) ?? '{}') as Partial<Settings>;
  } catch {
    return {};
  }
}
function saveLook(data: unknown) {
  const s = (data as Data).settings;
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(Object.fromEntries(LOOK.map((k) => [k, s[k]]))));
  } catch {
    /* private window: the look lasts for this visit */
  }
}

type Pull = { cursor: number; more: boolean; changes: Change[]; account?: RemoteAccount | null };
const pull = (since: number) => call<Pull>('GET', `/sync?since=${since}&limit=5000`);

/** Everything of the signed-in person, as the Mac app's Data, and the sync state that goes with it. */
async function loadData(): Promise<Data> {
  const changes: Change[] = [];
  let since = 0;
  let account: RemoteAccount | null | undefined;
  for (;;) {
    const r = await pull(since);
    changes.push(...r.changes);
    account = r.account;
    since = r.cursor;
    if (!r.more) break;
  }
  const empty: Data = { version: 1, projects: [], activities: [], entries: [], workdays: [], plan: [], reviewedWeeks: [], settings: {} as Settings };
  let data = applyChanges(empty, changes.filter((c) => !c.deleted));
  data = {
    ...data,
    reviewedWeeks: account?.values.reviewedWeeks ?? [],
    settings: {
      ...(account?.values as Partial<Settings>),
      ...readLook(),
      // The Mac's first-launch guides, its idle question and its trail don't apply here; the Mac fits workdays itself.
      tourDone: true,
      onboardingDone: true,
      workdaysFitted: true,
      shortcutsEnabled: false,
      idleMinutes: 0,
      activityTrail: false,
      apiEnabled: false,
    } as Settings,
  };
  // What the server has now is the agreed state. Without account settings on the server yet, the browser's defaults
  // are not sent until you change something here (a Mac's own settings should win over them).
  syncState = { cursor: since, base: baseOf(data), account: { json: accountJson(data), at: account?.updatedAt ?? '' } };
  return data;
}

/** Closing the tab right after a change: send what the store hasn't synced yet (the request outlives the page). */
function flush(data: unknown) {
  if (!syncState || !session) return false;
  const d = data as Data;
  const now = new Date().toISOString();
  const changes = localChanges(d, syncState.base, now);
  const account = syncState.account && accountJson(d) !== syncState.account.json ? { values: JSON.parse(accountJson(d)), updatedAt: now } : undefined;
  if (!changes.length && !account) return true;
  const body = { changes, ...(account && { account }) };
  if (JSON.stringify(body).length > 60_000) return false; // too much for a keepalive request; the next load has it anyway
  void call('POST', '/sync', body, true).catch(() => {});
  return true;
}

const off = () => () => {};
const unavailable = { ok: false as const, error: 'Not available in the web app' };
const server = () => ({ connected: true, url: location.origin, name: session?.me.name });

window.api = {
  load: () => loadData(),
  profile: async () => null,
  setTheme: () => {}, // the page follows the system's appearance
  notify: () => {},
  appInfo: async () => ({ version, electron: '–', chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '–', node: '–', updateSource: null, roadmap: `${location.origin}/roadmap` }),
  checkUpdate: async () => ({ ok: true, newer: false, latest: { version, notes: [] } }),
  openLink: (url) => void window.open(url, '_blank', 'noopener'),
  save: async (data) => saveLook(data),
  saveSync: (data) => (saveLook(data), flush(data)),
  updateTray: () => {},
  setMenuIcons: () => {},
  onApiRequest: off,
  apiRespond: () => {},
  apiHasKey: async () => false,
  apiGenerateKey: async () => '',
  apiStatus: async () => ({ running: false, address: null }),
  onApiError: off,
  openFeedback: () => {},
  shortcutStatus: async () => ({}),
  suspendShortcuts: () => {},
  trailGet: async () => [],
  trailClear: async () => {},
  quickAction: () => {},
  quickHide: () => {},
  quickOpenMain: () => {},
  onQuickShow: off,
  serverStatus: async () => server(),
  serverConnect: async () => unavailable,
  serverDisconnect: async () => (await signOut(), { connected: false }),
  serverPairCode: async () => unavailable,
  // The account page and the Admin page have their own sign-in: a one-time link opens them signed in.
  serverAdminLink: async () => openLink('/admin-link'),
  serverAccountLink: async () => openLink('/account-link'),
  serverMyDevices: async () => {
    try {
      return { ok: true, devices: await call<{ id: string; name: string; client: string | null; lastSeenAt: string | null; current: boolean }[]>('GET', '/me/devices') };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
  serverSignIn: async () => unavailable,
  serverRegister: async () => unavailable,
  serverAccount: async () => session?.me ?? null,
  feedbackAvailable: async () => false,
  feedbackSend: async () => unavailable,
  feedbackThreads: async () => [],
  feedbackReply: async () => unavailable,
  feedbackSeen: async () => {},
  feedbackUnread: async () => 0,
  onFeedbackUnread: off,
  serverSyncState: async () => syncState,
  serverSetSyncState: async (state) => ((syncState = state), true),
  serverSyncPull: async (since) => {
    try {
      return { ok: true, ...(await pull(since)) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
  serverSyncPush: async (changes, account) => {
    try {
      return { ok: true, ...(await call<{ applied: number; skipped: { kind: string; id: string; reason: string }[]; cursor: number }>('POST', '/sync', { changes, ...(account && { account }) })) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
  floatSetToken: async () => {},
  floatHasToken: async () => false,
  floatGet: async () => ({ ok: false, status: 0, error: unavailable.error }),
  personioSetCredentials: async () => {},
  personioHasCredentials: async () => false,
  personioGet: async () => ({ ok: false, status: 0, error: unavailable.error }),
  onTrayAction: off,
};

async function openLink(path: string) {
  // Opened before the request, so the browser doesn't block it as a pop-up.
  const tab = window.open('about:blank', '_blank');
  try {
    const r = await call<{ path: string }>('POST', path, {});
    if (tab) tab.location.href = r.path;
    else location.href = r.path;
    return { ok: true as const };
  } catch (err) {
    tab?.close();
    return { ok: false as const, error: err instanceof WebError && err.status === 403 ? 'not_admin' : (err as Error).message };
  }
}
