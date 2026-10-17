import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Activity, Data, Entry, CompanyProfile } from './types';
import { DEFAULT_SHORTCUTS } from './shortcuts';
import { applyFloatImport, fetchFloatPlan } from './float';
import { applyPersonioImport, fetchPersonioAbsences } from './personio';
import { PROJECT_COLORS } from './actions';
import { dayKey, uid } from './time';
import { fullDayHours } from './schedule';
import { t, useLanguage } from './i18n';
import { fitAll, fitWorkdays, type FitNotice } from './fit';
import { applyChanges, baseOf, markChanges, planSync, rebase, type Change } from './sync';

const DEFAULT_DATA: Data = {
  version: 1,
  projects: [],
  activities: [],
  entries: [],
  workdays: [],
  plan: [],
  reviewedWeeks: [],
  settings: { language: 'system', dailyTargetHours: 8, autoStartDay: false, startDayWithTimer: true, shortcutsEnabled: true, shortcuts: DEFAULT_SHORTCUTS, idleMinutes: 10, reviewOnLeave: true, autoStopMidnight: true, billableEnabled: false, balanceStartHours: 0, menuBarLabel: 'task', menuBarColor: 'project', activityTrail: false, apiEnabled: false, apiPort: 7799, apiLan: false },
};

type LegacyData = Omit<Partial<Data>, 'entries'> & { tags?: { id: string; name: string }[]; entries?: (Entry & { tagIds?: string[] })[] };

/** Older versions had multi-select tags: the first tag becomes the activity, a "billable" tag becomes the flag. */
function migrateTags(d: LegacyData): Partial<Data> {
  if (!d.tags || d.activities) return d;
  const billableIds = new Set(d.tags.filter((t) => t.name.trim().toLowerCase() === 'billable').map((t) => t.id));
  const activities: Activity[] = d.tags
    .filter((t) => !billableIds.has(t.id))
    .map((t, i) => ({ id: t.id, name: t.name, color: PROJECT_COLORS[(i + 3) % PROJECT_COLORS.length] }));
  const entries = (d.entries ?? []).map(({ tagIds = [], ...e }) => ({
    ...e,
    activityId: tagIds.find((t) => !billableIds.has(t)),
    billable: tagIds.some((t) => billableIds.has(t)) || undefined,
  }));
  const { tags: _drop, ...rest } = d;
  return { ...rest, activities, entries };
}

function normalize(raw: unknown): Data {
  if (!raw || typeof raw !== 'object') {
    const activities = t('starter.activities').split('|').map((name, i) => ({ id: uid(), name, color: PROJECT_COLORS[(i + 3) % PROJECT_COLORS.length] }));
    return { ...DEFAULT_DATA, activities };
  }
  const d = migrateTags(raw as LegacyData);
  // Older versions had an on/off switch for the time in the menu bar.
  const legacy = d.settings as (Partial<Data['settings']> & { showTimeInMenuBar?: boolean }) | undefined;
  const settings = { ...DEFAULT_DATA.settings, ...legacy };
  settings.shortcuts = { ...DEFAULT_SHORTCUTS, ...legacy?.shortcuts };
  if (legacy?.showTimeInMenuBar === false && !legacy.menuBarLabel) settings.menuBarLabel = 'none';
  delete (settings as { showTimeInMenuBar?: boolean }).showTimeInMenuBar;
  return { ...DEFAULT_DATA, ...d, settings };
}

type SyncState = { busy: boolean; error?: string; message?: string };
/** Sync with the Gnomon server: `at` is the last successful sync. */
type ServerSyncState = SyncState & { connected: boolean; at?: string };

type Store = {
  data: Data;
  update: (fn: (d: Data) => Data) => void;
  floatSync: SyncState;
  runFloatSync: () => Promise<void>;
  personioSync: SyncState;
  runPersonioSync: () => Promise<void>;
  serverSync: ServerSyncState;
  runServerSync: () => Promise<void>;
  /** Re-read whether this Mac is connected to a server (after connecting or disconnecting in Settings). */
  refreshServer: () => Promise<void>;
  /** Synchronous read/write for the API bridge, which needs the result of a change right away. */
  getData: () => Data;
  commit: (next: Data) => void;
  /** The company settings profile (Iru), or null on a personal Mac. */
  profile: CompanyProfile | null;
  /** What the last change moved or created to keep the workday around the entries. */
  fitNotices: FitNotice[];
  dismissFitNotices: () => void;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Data | null>(null);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const dataRef = useRef<Data | null>(null);
  dataRef.current = data;
  const [floatSync, setFloatSync] = useState<SyncState>({ busy: false });
  const floatBusy = useRef(false);
  const [personioSync, setPersonioSync] = useState<SyncState>({ busy: false });
  const personioBusy = useRef(false);
  const [serverSync, setServerSync] = useState<ServerSyncState>({ busy: false, connected: false });
  const serverBusy = useRef(false);
  const serverAgain = useRef(false);
  // When each record last changed on this Mac, so a conflict with the phone goes to the later edit.
  const changedAt = useRef(new Map<string, string>());
  const prevData = useRef<Data | null>(null);

  useEffect(() => {
    Promise.all([window.api.load(), window.api.profile().catch(() => null)]).then(([raw, p]) => {
      let d = normalize(raw);
      // On a fresh install, the company's defaults are the starting values; the person can change them later.
      if (!raw && p) d = { ...d, settings: { ...d.settings, ...(p.dailyTargetHours && { dailyTargetHours: p.dailyTargetHours }), ...(p.language && { language: p.language }) } };
      setProfile(p);
      // Once: give days that have entries but no fitting workday one (see src/fit.ts).
      if (!d.settings.workdaysFitted) d = { ...fitAll(d), settings: { ...d.settings, workdaysFitted: true } };
      setData(d);
    });
  }, []);

  // Debounced save, plus a synchronous flush when the window unloads (e.g. on quit).
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => window.api.save(data), 300);
    return () => clearTimeout(t);
  }, [data]);

  useEffect(() => {
    const flush = () => dataRef.current && window.api.saveSync(dataRef.current);
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // Every change goes through fitWorkdays, so the workday always covers the day's entries (src/fit.ts).
  const pendingNotices = useRef(new Map<string, FitNotice>());
  const fit = (prev: Data, next: Data) => {
    const r = fitWorkdays(prev, next);
    for (const n of r.notices) pendingNotices.current.set(`${n.kind}:${n.date}:${n.at}`, n);
    return r.data;
  };
  const [fitNotices, setFitNotices] = useState<FitNotice[]>([]);
  useEffect(() => {
    if (!pendingNotices.current.size) return;
    setFitNotices([...pendingNotices.current.values()]);
    pendingNotices.current.clear();
  }, [data]);
  const dismissFitNotices = useCallback(() => setFitNotices([]), []);

  const update = useCallback((fn: (d: Data) => Data) => setData((d) => (d ? fit(d, fn(d)) : d)), []);

  const runFloatSync = useCallback(async () => {
    const s = dataRef.current?.settings;
    if (floatBusy.current || !s?.floatPersonId) return;
    floatBusy.current = true;
    setFloatSync({ busy: true });
    try {
      const imp = await fetchFloatPlan(s.floatPersonId, s.floatRegionId, s.floatEmail);
      // Merge into the latest state, so edits made while Float was loading are kept.
      setData((d) => (d ? applyFloatImport(d, imp) : d));
      const n = imp.plan.length;
      setFloatSync({ busy: false, message: t('float.imported', { allocations: t('count.allocations', { n }), projects: t('count.projects', { n: imp.projects.length }) }) });
    } catch (err) {
      setFloatSync({ busy: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      floatBusy.current = false;
    }
  }, []);

  const runPersonioSync = useCallback(async () => {
    const s = dataRef.current?.settings;
    if (personioBusy.current || !s?.personioPersonId) return;
    personioBusy.current = true;
    setPersonioSync({ busy: true });
    try {
      const imp = await fetchPersonioAbsences(s.personioPersonId, fullDayHours(dataRef.current!, dayKey(new Date())));
      setData((d) => (d ? applyPersonioImport(d, imp) : d));
      const days = t('count.daysOff', { n: imp.daysOff.length });
      setPersonioSync({ busy: false, message: imp.partial.length ? t('personio.importedPartial', { days, n: imp.partial.length }) : t('personio.imported', { days }) });
    } catch (err) {
      setPersonioSync({ busy: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      personioBusy.current = false;
    }
  }, []);

  // ---- Sync with the Gnomon server (src/sync.ts) -----------------------------------------------------------

  const runServerSync = useCallback(async () => {
    if (!dataRef.current) return;
    if (serverBusy.current) {
      serverAgain.current = true; // something changed meanwhile: go again right after this one
      return;
    }
    serverBusy.current = true;
    setServerSync((s) => ({ ...s, busy: true }));
    const fail = (error: string) => setServerSync((s) => ({ ...s, busy: false, error }));
    try {
      const state = await window.api.serverSyncState();
      const pullAll = async (since: number) => {
        const changes: Change[] = [];
        for (;;) {
          const r = await window.api.serverSyncPull(since);
          if (!r.ok) throw new Error(r.error);
          changes.push(...r.changes);
          since = r.cursor;
          if (!r.more) return { changes, cursor: since };
        }
      };
      const first = !state;
      const pulled = await pullAll(state?.cursor ?? 0);
      const before = dataRef.current!;
      const now = new Date().toISOString();
      const plan = planSync(before, state?.base ?? {}, pulled.changes, { first, now, changedAt: (k) => changedAt.current.get(k) });
      let merged = plan.merged;
      for (let i = 0; i < plan.push.length; i += 2000) {
        const r = await window.api.serverSyncPush(plan.push.slice(i, i + 2000));
        if (!r.ok) throw new Error(r.error);
        // The server kept its own (newer) version of these: take it.
        for (const sk of r.skipped) {
          const k = `${sk.kind}:${sk.id}`;
          if (plan.remote.has(k)) merged = applyChanges(merged, [{ kind: sk.kind as Change['kind'], id: sk.id, updatedAt: now, deleted: !plan.remote.get(k), data: plan.remote.get(k) ?? null }]);
        }
      }
      // The server's final word after our push (our own changes come back, plus e.g. a timer it stopped).
      const after = plan.push.length ? await pullAll(pulled.cursor) : pulled;
      if (after !== pulled) merged = applyChanges(merged, after.changes);
      await window.api.serverSetSyncState({ cursor: after.cursor, base: baseOf(merged) });
      // Entries from the phone get their workday fitted too; that change syncs back on the next round.
      setData((d) => (d ? fit(d, rebase(d, before, merged)) : d));
      // Edits up to the start of this sync are settled; later ones keep their time for the next sync.
      for (const [k, at] of changedAt.current) if (at <= now) changedAt.current.delete(k);
      setServerSync((s) => ({ ...s, busy: false, error: plan.invalid.length ? t('srv.syncInvalid', { n: plan.invalid.length }) : undefined, at: new Date().toISOString() }));
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    } finally {
      serverBusy.current = false;
      if (serverAgain.current) {
        serverAgain.current = false;
        setTimeout(() => void runServerSync(), 1000);
      }
    }
  }, []);

  const refreshServer = useCallback(async () => {
    const st = await window.api.serverStatus();
    setServerSync((s) => ({ ...s, connected: st.connected, error: undefined, ...(st.connected ? {} : { at: undefined }) }));
  }, []);

  useEffect(() => {
    void refreshServer();
  }, [refreshServer]);

  useEffect(() => {
    if (!data) return;
    if (prevData.current) markChanges(prevData.current, data, changedAt.current, new Date().toISOString());
    prevData.current = data;
  }, [data]);

  // While connected: sync now, every minute, and a few seconds after each change (a sync that only brings the
  // server's state leaves `data` untouched, so it doesn't trigger another one).
  useEffect(() => {
    if (!serverSync.connected) return;
    void runServerSync();
    const i = setInterval(() => void runServerSync(), 60_000);
    return () => clearInterval(i);
  }, [serverSync.connected, runServerSync]);
  useEffect(() => {
    if (!serverSync.connected || !data) return;
    const tm = setTimeout(() => void runServerSync(), 4000);
    return () => clearTimeout(tm);
  }, [data, serverSync.connected, runServerSync]);

  useLanguage(data?.settings.language);

  const getData = useCallback(() => dataRef.current!, []);
  const commit = useCallback((next: Data) => {
    const fitted = dataRef.current ? fit(dataRef.current, next) : next;
    dataRef.current = fitted;
    setData(fitted);
  }, []);

  if (!data) return <div className="loading">{t('loading')}</div>;
  return <StoreContext.Provider value={{ data, update, floatSync, runFloatSync, personioSync, runPersonioSync, serverSync, runServerSync, refreshServer, getData, commit, profile, fitNotices, dismissFitNotices }}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
