import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Activity, Data, Entry } from './types';
import { DEFAULT_SHORTCUTS } from './shortcuts';
import { applyFloatImport, fetchFloatPlan } from './float';
import { applyPersonioImport, fetchPersonioAbsences } from './personio';
import { PROJECT_COLORS } from './actions';
import { uid } from './time';
import { t, useLanguage } from './i18n';

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

type Store = {
  data: Data;
  update: (fn: (d: Data) => Data) => void;
  floatSync: SyncState;
  runFloatSync: () => Promise<void>;
  personioSync: SyncState;
  runPersonioSync: () => Promise<void>;
  /** Synchronous read/write for the API bridge, which needs the result of a change right away. */
  getData: () => Data;
  commit: (next: Data) => void;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Data | null>(null);
  const dataRef = useRef<Data | null>(null);
  dataRef.current = data;
  const [floatSync, setFloatSync] = useState<SyncState>({ busy: false });
  const floatBusy = useRef(false);
  const [personioSync, setPersonioSync] = useState<SyncState>({ busy: false });
  const personioBusy = useRef(false);

  useEffect(() => {
    window.api.load().then((raw) => setData(normalize(raw)));
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

  const update = useCallback((fn: (d: Data) => Data) => setData((d) => (d ? fn(d) : d)), []);

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
      const imp = await fetchPersonioAbsences(s.personioPersonId, s.dailyTargetHours);
      setData((d) => (d ? applyPersonioImport(d, imp) : d));
      const days = t('count.daysOff', { n: imp.daysOff.length });
      setPersonioSync({ busy: false, message: imp.partial.length ? t('personio.importedPartial', { days, n: imp.partial.length }) : t('personio.imported', { days }) });
    } catch (err) {
      setPersonioSync({ busy: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      personioBusy.current = false;
    }
  }, []);

  useLanguage(data?.settings.language);

  const getData = useCallback(() => dataRef.current!, []);
  const commit = useCallback((next: Data) => {
    dataRef.current = next;
    setData(next);
  }, []);

  if (!data) return <div className="loading">{t('loading')}</div>;
  return <StoreContext.Provider value={{ data, update, floatSync, runFloatSync, personioSync, runPersonioSync, getData, commit }}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
