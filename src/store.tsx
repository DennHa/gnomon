import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Data, CompanyHours, CompanyProfile } from './types';
import { applyFloatImport, fetchFloatPlan } from './float';
import { applyPersonioImport, fetchPersonioAbsences } from './personio';
import { dayKey } from './time';
import { fullDayHours } from './schedule';
import { t, useLanguage } from './i18n';
import { normalize } from './datafile';
import { fitAll, fitWorkdays, type FitNotice } from './fit';
import { accountJson, applyChanges, baseOf, markChanges, planAccount, planSync, rebase, withAccountSettings, type Change, type RemoteAccount } from './sync';

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

/** changedAt's key for the account settings (src/sync.ts, planAccount). */
const ACCOUNT_KEY = 'settings:account';

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
      // The account settings come along with every page; the last one's are the latest.
      const pullAll = async (since: number) => {
        const changes: Change[] = [];
        let account: RemoteAccount | null | undefined;
        let company: CompanyHours | undefined;
        for (;;) {
          const r = await window.api.serverSyncPull(since);
          if (!r.ok) throw new Error(r.error);
          changes.push(...r.changes);
          account = r.account;
          company = r.company?.hours;
          since = r.cursor;
          if (!r.more) return { changes, cursor: since, account, company };
        }
      };
      const first = !state;
      const pulled = await pullAll(state?.cursor ?? 0);
      const before = dataRef.current!;
      const now = new Date().toISOString();
      const plan = planSync(before, state?.base ?? {}, pulled.changes, { first, now, changedAt: (k) => changedAt.current.get(k) });
      let merged = plan.merged;
      const acct = planAccount(before, state?.account, pulled.account, { now, changedAt: changedAt.current.get(ACCOUNT_KEY) });
      if (acct.take) merged = withAccountSettings(merged, acct.take);
      // Changed account settings go with the first batch (or alone, when no record changed).
      for (let i = 0; i < plan.push.length || (i === 0 && acct.push); i += 2000) {
        const r = await window.api.serverSyncPush(plan.push.slice(i, i + 2000), i === 0 ? acct.push : undefined);
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
      await window.api.serverSetSyncState({ cursor: after.cursor, base: baseOf(merged), account: acct.agreed });
      // Entries from the phone get their workday fitted too; that change syncs back on the next round.
      // The account's settings come in unless they were changed here during the sync (then they go out next time).
      const take = acct.take;
      setData((d) => {
        if (!d) return d;
        const next = rebase(d, before, merged);
        const fitted = fit(d, take && accountJson(d) === accountJson(before) && accountJson(next) !== accountJson(withAccountSettings(next, take)) ? withAccountSettings(next, take) : next);
        // The company's hours view and zones (src/corridor.ts): kept on this device, never sent back.
        return withCompanyHours(fitted, after.company);
      });
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
    // Without a server, the company no longer decides: the Labs switch does.
    if (!st.connected) setData((d) => (d ? withCompanyHours(d, undefined) : d));
  }, []);

  useEffect(() => {
    void refreshServer();
  }, [refreshServer]);

  useEffect(() => {
    if (!data) return;
    if (prevData.current) {
      const now = new Date().toISOString();
      markChanges(prevData.current, data, changedAt.current, now);
      const prev = prevData.current;
      if ((prev.settings !== data.settings || prev.reviewedWeeks !== data.reviewedWeeks) && accountJson(prev) !== accountJson(data)) changedAt.current.set(ACCOUNT_KEY, now);
    }
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

/** The company's hours setting as the last sync brought it; the same object when nothing changed (no extra save). */
function withCompanyHours(d: Data, c: CompanyHours | undefined): Data {
  if (JSON.stringify(d.settings.companyHours ?? null) === JSON.stringify(c ?? null)) return d;
  const { companyHours: _old, ...settings } = d.settings;
  return { ...d, settings: c ? { ...settings, companyHours: c } : settings };
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
