const { contextBridge, ipcRenderer } = require('electron');

// Screenshots only: with --fake-now=<ms> (set by main.cjs from FAKE_NOW) the page's clock starts at that time and keeps ticking.
const fakeNow = process.argv.find((a) => a.startsWith('--fake-now='));
if (fakeNow) {
  contextBridge.executeInMainWorld({
    func: (at) => {
      const Real = Date;
      const offset = at - Real.now();
      function FakeDate(...a) {
        if (!new.target) return new Real(Real.now() + offset).toString();
        return a.length ? new Real(...a) : new Real(Real.now() + offset);
      }
      FakeDate.prototype = Real.prototype;
      FakeDate.now = () => Real.now() + offset;
      FakeDate.parse = Real.parse;
      FakeDate.UTC = Real.UTC;
      window.Date = FakeDate;
    },
    args: [Number(fakeNow.slice('--fake-now='.length))],
  });
}

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  /** The company settings profile (Iru), or null. Read-only. */
  profile: () => ipcRenderer.invoke('profile:get'),
  setTheme: (value) => ipcRenderer.send('theme:set', value),
  save: (data) => ipcRenderer.invoke('data:save', data),
  saveSync: (data) => ipcRenderer.sendSync('data:saveSync', data),
  updateTray: (state) => ipcRenderer.send('tray:update', state),
  setMenuIcons: (icons) => ipcRenderer.send('tray:icons', icons),
  onApiRequest: (cb) => {
    const handler = (_e, req) => cb(req);
    ipcRenderer.on('api:request', handler);
    return () => ipcRenderer.removeListener('api:request', handler);
  },
  apiRespond: (id, status, body) => ipcRenderer.send('api:response', { id, status, body }),
  apiHasKey: () => ipcRenderer.invoke('api:hasKey'),
  apiGenerateKey: () => ipcRenderer.invoke('api:generateKey'),
  apiStatus: () => ipcRenderer.invoke('api:status'),
  onApiError: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('api:error', handler);
    return () => ipcRenderer.removeListener('api:error', handler);
  },
  openFeedback: () => ipcRenderer.send('feedback:open'),
  shortcutStatus: () => ipcRenderer.invoke('shortcuts:status'),
  suspendShortcuts: (on) => ipcRenderer.send('shortcuts:suspend', on),
  trailGet: (day) => ipcRenderer.invoke('trail:get', day),
  trailClear: () => ipcRenderer.invoke('trail:clear'),
  quickAction: (action) => ipcRenderer.send('quick:action', action),
  quickHide: () => ipcRenderer.send('quick:hide'),
  quickOpenMain: () => ipcRenderer.send('quick:open'),
  onQuickShow: (cb) => {
    const handler = (_e, mode) => cb(mode);
    ipcRenderer.on('quick:show', handler);
    return () => ipcRenderer.removeListener('quick:show', handler);
  },
  serverStatus: () => ipcRenderer.invoke('server:status'),
  serverConnect: (url, code) => ipcRenderer.invoke('server:connect', { url, code }),
  serverDisconnect: () => ipcRenderer.invoke('server:disconnect'),
  serverPairCode: (name) => ipcRenderer.invoke('server:pairCode', name),
  floatSetToken: (token) => ipcRenderer.invoke('float:setToken', token),
  floatHasToken: () => ipcRenderer.invoke('float:hasToken'),
  floatGet: (path, contact) => ipcRenderer.invoke('float:get', { path, contact }),
  personioSetCredentials: (creds) => ipcRenderer.invoke('personio:setCredentials', creds),
  personioHasCredentials: () => ipcRenderer.invoke('personio:hasCredentials'),
  personioGet: (path, query) => ipcRenderer.invoke('personio:get', { path, query }),
  onTrayAction: (cb) => {
    const handler = (_e, action) => cb(action);
    ipcRenderer.on('tray:action', handler);
    return () => ipcRenderer.removeListener('tray:action', handler);
  },
});
