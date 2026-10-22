// The web demo's stand-in for the Mac app's bridge (electron/preload.cjs): data lives in this browser's
// localStorage, starting from made-up demo data. Everything that needs the Mac (menu bar, shortcuts, notifications)
// does nothing; connecting Float, Personio or a server answers that this is a demo. Nothing leaves the browser.
import './clock';
import { readDemo, writeDemo } from './storage';
import { version } from '../../package.json';

const DEMO_ERROR = 'This is the web demo with made-up data. Connections work in the Mac app.';
const off = () => () => {};

window.api = {
  load: async () => readDemo(),
  profile: async () => null,
  setTheme: () => {},
  notify: () => {},
  appInfo: async () => ({ version, electron: '–', chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '–', node: '–', updateSource: null }),
  checkUpdate: async () => ({ ok: true, newer: false, latest: { version, notes: [] } }),
  openLink: (url) => void window.open(url, '_blank', 'noopener'),
  save: async (data) => void writeDemo(data),
  saveSync: (data) => writeDemo(data),
  updateTray: () => {},
  setMenuIcons: () => {},
  onApiRequest: off,
  apiRespond: () => {},
  apiHasKey: async () => false,
  apiGenerateKey: async () => '',
  apiStatus: async () => ({ running: false, address: null }),
  onApiError: off,
  openFeedback: () => void window.open('mailto:info@dennha.de?subject=Gnomon', '_blank'),
  shortcutStatus: async () => ({}),
  suspendShortcuts: () => {},
  trailGet: async () => [],
  trailClear: async () => {},
  quickAction: () => {},
  quickHide: () => {},
  quickOpenMain: () => {},
  onQuickShow: off,
  serverStatus: async () => ({ connected: false }),
  serverConnect: async () => ({ ok: false, error: DEMO_ERROR }),
  serverDisconnect: async () => ({ connected: false }),
  serverPairCode: async () => ({ ok: false, error: DEMO_ERROR }),
  serverAdminLink: async () => ({ ok: false, error: DEMO_ERROR }),
  serverSyncState: async () => null,
  serverSetSyncState: async () => false,
  serverSyncPull: async () => ({ ok: false, error: DEMO_ERROR }),
  serverSyncPush: async () => ({ ok: false, error: DEMO_ERROR }),
  floatSetToken: async () => {},
  floatHasToken: async () => false,
  floatGet: async () => ({ ok: false, status: 0, error: DEMO_ERROR }),
  personioSetCredentials: async () => {},
  personioHasCredentials: async () => false,
  personioGet: async () => ({ ok: false, status: 0, error: DEMO_ERROR }),
  onTrayAction: off,
};
