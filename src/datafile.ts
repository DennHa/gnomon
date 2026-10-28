// Reading the data file: defaults for missing settings and migrations from older versions (kept out of store.tsx so
// tests can load old files without React).
import type { Activity, Data, Entry } from './types';
import { DEFAULT_SHORTCUTS } from './shortcuts';
import { PROJECT_COLORS } from './actions';
import { uid } from './time';
import { t } from './i18n';

export const DEFAULT_DATA: Data = {
  version: 1,
  projects: [],
  activities: [],
  entries: [],
  workdays: [],
  plan: [],
  reviewedWeeks: [],
  settings: { language: 'system', dailyTargetHours: 8, autoStartDay: false, startDayWithTimer: true, shortcutsEnabled: true, shortcuts: DEFAULT_SHORTCUTS, idleMinutes: 10, reviewOnLeave: true, autoStopMidnight: true, balanceStartHours: 0, menuBarLabel: 'task', menuBarColor: 'project', activityTrail: false, apiEnabled: false, apiPort: 7799, apiLan: false },
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

export function normalize(raw: unknown): Data {
  if (!raw || typeof raw !== 'object') {
    const activities = t('starter.activities').split('|').map((name, i) => ({ id: uid(), name, color: PROJECT_COLORS[(i + 3) % PROJECT_COLORS.length] }));
    // New installs start without activities (less to think about); they can be switched on under Projects & activities.
    return { ...DEFAULT_DATA, activities, settings: { ...DEFAULT_DATA.settings, activitiesEnabled: false } };
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
