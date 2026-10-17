// Pure state transitions. Every function takes the current Data and returns the next one.
import type { Activity, ActivityPreset, Break, Data, Entry, Project, Settings, Workday, WorkStyle } from './types';
import { atTime, dayKey, nowIso, uid } from './time';
import { goalFor, planItemsOn } from './plan';

export const PROJECT_COLORS = ['#03A9F4', '#8BC34A', '#FF9800', '#E91E63', '#9C27B0', '#009688', '#3F51B5', '#795548', '#F44336', '#607D8B'];

export const runningEntry = (d: Data) => d.entries.find((e) => !e.end);
export const todayWorkday = (d: Data) => d.workdays.find((w) => w.date === dayKey(new Date()));
export const isOnBreak = (w?: Workday) => Boolean(w && !w.end && w.breaks.some((b) => !b.end));

const mapToday = (d: Data, fn: (w: Workday) => Workday): Data => {
  const today = dayKey(new Date());
  // Clocking in or out, or a break, is a change by hand: the day no longer follows its entries (src/fit.ts).
  return { ...d, workdays: d.workdays.map((w) => (w.date === today ? { ...fn(w), fromEntries: undefined } : w)) };
};

const closeBreaks = (w: Workday, at: string): Workday => ({ ...w, breaks: w.breaks.map((b) => (b.end ? b : { ...b, end: at })) });

/** Clock in. If today was already closed, resume it and count the gap as a break. */
export function startDay(d: Data): Data {
  const wd = todayWorkday(d);
  const at = nowIso();
  if (!wd || wd.off) {
    const fresh = { date: dayKey(at), start: at, breaks: [] };
    return { ...d, workdays: [...d.workdays.filter((w) => w !== wd), fresh] };
  }
  if (!wd.end) return d;
  return mapToday(d, (w) => ({ ...w, end: undefined, breaks: [...w.breaks, { start: w.end!, end: at }] }));
}

/** Clock out: stops the timer and any break. */
export function leave(d: Data): Data {
  const at = nowIso();
  return mapToday(stopTimer(d), (w) => (w.end ? w : { ...closeBreaks(w, at), end: at }));
}

export function toggleBreak(d: Data): Data {
  const wd = todayWorkday(d);
  if (!wd || wd.end) return d;
  const at = nowIso();
  if (isOnBreak(wd)) return mapToday(d, (w) => closeBreaks(w, at));
  return mapToday(stopTimer(d), (w) => ({ ...w, breaks: [...w.breaks, { start: at }] }));
}

export function updateWorkday(d: Data, date: string, patch: Partial<Workday>): Data {
  // Editing the leave time confirms it, so an auto-closed day stops asking.
  const confirm = patch.end ? { autoClosed: undefined } : {};
  // Changed by hand: it no longer follows the entries.
  return { ...d, workdays: d.workdays.map((w) => (w.date === date ? { ...w, ...patch, ...confirm, fromEntries: undefined } : w)) };
}

/** Close a day you forgot to clock out of. */
export function closeWorkday(d: Data, date: string, end: string): Data {
  return { ...d, workdays: d.workdays.map((w) => (w.date === date ? { ...closeBreaks(w, end), end, autoClosed: undefined, fromEntries: undefined } : w)) };
}

/** Accept an auto-closed day's 23:59 as it is. */
export function confirmAutoClose(d: Data, date: string): Data {
  return { ...d, workdays: d.workdays.map((w) => (w.date === date ? { ...w, autoClosed: undefined } : w)) };
}

/** True when a workday or timer from an earlier calendar day is still open. */
export function hasOvernight(d: Data, today = dayKey(new Date())): boolean {
  return d.workdays.some((w) => !w.end && w.date < today) || d.entries.some((e) => !e.end && dayKey(e.start) < today);
}

/**
 * Midnight auto-stop: close workdays and the timer left open on an earlier day at 23:59 of that day.
 * The workday is marked autoClosed so the UI asks for the real leave time.
 */
export function closeOvernight(d: Data, today = dayKey(new Date())): Data {
  if (!hasOvernight(d, today)) return d;
  const endOf = (day: string) => new Date(Date.parse(atTime(day, '23:59')) + 59_000).toISOString();
  return {
    ...d,
    entries: d.entries.map((e) => (!e.end && dayKey(e.start) < today ? { ...e, end: endOf(dayKey(e.start)) } : e)),
    workdays: d.workdays.map((w) => (!w.end && w.date < today ? { ...closeBreaks(w, endOf(w.date)), end: endOf(w.date), autoClosed: true } : w)),
  };
}

/** Record a day after the fact, e.g. one you forgot to clock in for. */
export function addWorkday(d: Data, date: string, inTime: string, outTime: string, breakMinutes = 30): Data {
  const start = atTime(date, inTime);
  const end = atTime(date, outTime);
  const breaks = breakMinutes > 0 ? [{ start: atTime(date, '12:00'), end: new Date(Date.parse(atTime(date, '12:00')) + breakMinutes * 60_000).toISOString() }] : [];
  return { ...d, workdays: [...d.workdays.filter((w) => w.date !== date), { date, start, end, breaks }] };
}

export function markDayOff(d: Data, date: string, kind?: 'overtime'): Data {
  const at = atTime(date, '00:00');
  return { ...d, workdays: [...d.workdays.filter((w) => w.date !== date), { date, start: at, end: at, breaks: [], off: true, offKind: kind }] };
}

/** Switch a day off between a normal day off and overtime off (time off in lieu). */
export function setOffKind(d: Data, date: string, kind?: 'overtime'): Data {
  return { ...d, workdays: d.workdays.map((w) => (w.date === date && w.off ? { ...w, offKind: kind } : w)) };
}

export function updateBreak(d: Data, date: string, index: number, patch: Partial<Break>): Data {
  return { ...d, workdays: d.workdays.map((w) => (w.date === date ? { ...w, fromEntries: undefined, breaks: w.breaks.map((b, i) => (i === index ? { ...b, ...patch } : b)) } : w)) };
}

export function addBreak(d: Data, date: string): Data {
  return {
    ...d,
    workdays: d.workdays.map((w) => {
      if (w.date !== date) return w;
      const start = atTime(date, '12:00');
      return { ...w, fromEntries: undefined, breaks: [...w.breaks, { start, end: new Date(Date.parse(start) + 30 * 60_000).toISOString() }] };
    }),
  };
}

/** Add a finished break with given times (e.g. the gap between two timers, confirmed as lunch). */
export function addBreakBetween(d: Data, date: string, start: string, end: string): Data {
  return {
    ...d,
    workdays: d.workdays.map((w) =>
      w.date === date ? { ...w, fromEntries: undefined, breaks: [...w.breaks, { start, end }].sort((a, b) => a.start.localeCompare(b.start)) } : w,
    ),
  };
}

/**
 * The pause right before the running timer, if it looks like an unrecorded break: 15 min to 3 h since the previous
 * timer of the day ended, inside the clocked-in time, and not already covered by a break.
 */
export function breakBeforeRunning(d: Data): { date: string; start: string; end: string } | null {
  const run = runningEntry(d);
  if (!run) return null;
  const date = dayKey(run.start);
  const wd = d.workdays.find((w) => w.date === date && !w.off);
  if (!wd) return null;
  const prev = d.entries.filter((e) => e.end && e.id !== run.id && dayKey(e.start) === date && e.end <= run.start).sort((a, b) => b.end!.localeCompare(a.end!))[0];
  if (!prev) return null;
  const gap = Date.parse(run.start) - Date.parse(prev.end!);
  if (gap < 15 * 60_000 || gap > 3 * 3_600_000 || prev.end! < wd.start) return null;
  if (wd.breaks.some((b) => b.start < run.start && (b.end ?? run.start) > prev.end!)) return null;
  return { date, start: prev.end!, end: run.start };
}

export function removeBreak(d: Data, date: string, index: number): Data {
  return { ...d, workdays: d.workdays.map((w) => (w.date === date ? { ...w, fromEntries: undefined, breaks: w.breaks.filter((_, i) => i !== index) } : w)) };
}

export function deleteWorkday(d: Data, date: string): Data {
  return { ...d, workdays: d.workdays.filter((w) => w.date !== date) };
}

export type TimerInput = { description: string; projectId?: string; activityId?: string; billable?: boolean; taskId?: number; taskName?: string };

export function startTimer(d: Data, input: TimerInput): Data {
  let next = stopTimer(d);
  const wd = todayWorkday(next);
  if (next.settings.startDayWithTimer && (!wd || wd.end)) next = startDay(next);
  if (isOnBreak(todayWorkday(next))) next = toggleBreak(next);
  // Pick the task automatically when the project has exactly one Float task today.
  if (input.projectId && !input.taskId) {
    const tasks = planItemsOn(next, input.projectId, dayKey(new Date()));
    if (tasks.length === 1) input = { ...input, taskId: tasks[0].floatId, taskName: tasks[0].name || undefined };
  }
  const entry: Entry = { id: uid(), ...input, start: nowIso() };
  return { ...next, entries: [...next.entries, entry] };
}

/**
 * Where a new entry of `ms` goes on a day: the first free stretch inside the time you were clocked in (between your
 * arrival, breaks and existing entries) that fits it; otherwise right after the last entry or break. Without a
 * clock-in, after the day's last entry, or at 09:00. So typing hours in later never moves your arrival.
 */
export function freeStart(d: Data, day: string, ms: number): string {
  const wd = d.workdays.find((w) => w.date === day && !w.off);
  const taken = [
    ...d.entries.filter((e) => e.end && dayKey(e.start) === day).map((e) => [Date.parse(e.start), Date.parse(e.end!)]),
    ...(wd?.breaks ?? []).filter((b) => b.end).map((b) => [Date.parse(b.start), Date.parse(b.end!)]),
  ].sort((a, b) => a[0] - b[0]);
  if (!wd) {
    const lastEnd = d.entries.filter((e) => e.end && dayKey(e.start) === day).map((e) => Date.parse(e.end!));
    return lastEnd.length ? new Date(Math.max(...lastEnd)).toISOString() : atTime(day, '09:00');
  }
  const until = wd.end ? Date.parse(wd.end) : Infinity;
  let at = Date.parse(wd.start);
  for (const [a, b] of taken) {
    if (b <= at) continue;
    if (a - at >= ms && at + ms <= until) return new Date(at).toISOString();
    at = Math.max(at, b);
  }
  return new Date(at).toISOString();
}

/** Add a finished one-hour entry on any day, right after that day's last entry. */
export function addEntry(d: Data, date: string): Data {
  const last = d.entries.filter((e) => e.end && dayKey(e.start) === date).sort((a, b) => b.end!.localeCompare(a.end!))[0];
  const start = freeStart(d, date, 3_600_000);
  const end = new Date(Date.parse(start) + 3_600_000).toISOString();
  return { ...d, entries: [...d.entries, { id: uid(), description: '', projectId: last?.projectId, start, end }] };
}

/**
 * Timesheet editing: make a project's finished entries on a day add up to `targetMs`.
 * More time is appended as one entry after the day's last entry; less time trims the latest entries.
 */
export function setDayTotal(d: Data, projectId: string | undefined, day: string, targetMs: number): Data {
  const mine = d.entries
    .filter((e) => e.end && (e.projectId || undefined) === projectId && dayKey(e.start) === day)
    .sort((a, b) => b.start.localeCompare(a.start));
  const current = mine.reduce((s, e) => s + Date.parse(e.end!) - Date.parse(e.start), 0);
  const diff = Math.round((Math.max(0, targetMs) - current) / 60_000) * 60_000;
  if (diff === 0) return d;

  if (diff > 0) return appendEntry(d, day, diff, { projectId });

  let toRemove = -diff;
  const changes = new Map<string, string | null>(); // id -> new end, or null to delete
  for (const e of mine) {
    if (toRemove <= 0) break;
    const dur = Date.parse(e.end!) - Date.parse(e.start);
    if (dur <= toRemove) {
      changes.set(e.id, null);
      toRemove -= dur;
    } else {
      changes.set(e.id, new Date(Date.parse(e.end!) - toRemove).toISOString());
      toRemove = 0;
    }
  }
  return {
    ...d,
    entries: d.entries.flatMap((e) => (!changes.has(e.id) ? [e] : changes.get(e.id) === null ? [] : [{ ...e, end: changes.get(e.id)! }])),
  };
}

export function stopTimer(d: Data): Data {
  const at = nowIso();
  return { ...d, entries: d.entries.map((e) => (e.end ? e : { ...e, end: at })) };
}

export function updateEntry(d: Data, id: string, patch: Partial<Entry>): Data {
  return {
    ...d,
    entries: d.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  };
}

export function deleteEntry(d: Data, id: string): Data {
  return { ...d, entries: d.entries.filter((x) => x.id !== id) };
}

export function addProject(d: Data, name: string, color?: string, id = uid()): Data {
  const p: Project = { id, name: name.trim(), color: color ?? PROJECT_COLORS[d.projects.length % PROJECT_COLORS.length] };
  return { ...d, projects: [...d.projects, p] };
}

export function updateProject(d: Data, id: string, patch: Partial<Project>): Data {
  return { ...d, projects: d.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

export function removeProject(d: Data, id: string): Data {
  return {
    ...d,
    projects: d.projects.filter((x) => x.id !== id),
    entries: d.entries.map((e) => (e.projectId === id ? { ...e, projectId: undefined } : e)),
  };
}

// Any manual change to the activity list makes it the user's own ("Custom").
const custom = (d: Data): Data => (d.settings.activityPreset && d.settings.activityPreset !== 'custom' ? { ...d, settings: { ...d.settings, activityPreset: 'custom' } } : d);

export function addActivity(d: Data, name: string, color?: string): Data {
  const a: Activity = { id: uid(), name: name.trim(), color: color ?? PROJECT_COLORS[(d.activities.length + 3) % PROJECT_COLORS.length] };
  return custom({ ...d, activities: [...d.activities, a] });
}

export function updateActivity(d: Data, id: string, patch: Partial<Activity>): Data {
  const next = { ...d, activities: d.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
  return patch.name !== undefined ? custom(next) : next;
}

export function removeActivity(d: Data, id: string): Data {
  return custom({
    ...d,
    activities: d.activities.filter((x) => x.id !== id),
    entries: d.entries.map((e) => (e.activityId === id ? { ...e, activityId: undefined } : e)),
  });
}

export const ACTIVITY_PRESETS: ActivityPreset[] = ['designer', 'pm', 'director', '3d', 'ux', 'ui'];

/**
 * Switch to a role's activity set. Activities with the same name are kept (with their colour), missing ones are added,
 * and the rest are removed unless entries use them, so no tracked time loses its activity.
 */
export function applyActivityPreset(d: Data, preset: ActivityPreset, names: string[]): Data {
  const used = new Set(d.entries.map((e) => e.activityId).filter(Boolean));
  const byName = new Map(d.activities.map((a) => [a.name.trim().toLowerCase(), a]));
  const wanted = names.map((n) => n.trim()).filter(Boolean);
  const keep = new Set(wanted.map((n) => n.toLowerCase()));
  const fromPreset = wanted.map((name, i) => byName.get(name.toLowerCase()) ?? { id: uid(), name, color: PROJECT_COLORS[(i + 3) % PROJECT_COLORS.length] });
  const stillUsed = d.activities.filter((a) => !keep.has(a.name.trim().toLowerCase()) && used.has(a.id));
  return { ...d, activities: [...fromPreset, ...stillUsed], settings: { ...d.settings, activityPreset: preset } };
}

/**
 * One-click switch from the running entry to another activity on the same project.
 * A timer that has no activity yet (or just started) simply gets it assigned instead of being split.
 */
export function switchActivity(d: Data, activityId: string): Data {
  const running = runningEntry(d);
  if (!running || running.activityId === activityId || !d.activities.some((a) => a.id === activityId)) return d;
  const justStarted = Date.now() - Date.parse(running.start) < 60_000;
  if (!running.activityId || justStarted) return updateEntry(d, running.id, { activityId });
  const { projectId, billable, taskId, taskName } = running;
  return startTimer(d, { description: '', projectId, activityId, billable, taskId, taskName });
}

/** Continue the most recently finished entry (used by the stop/resume shortcut). */
export function resumeLast(d: Data): Data {
  if (runningEntry(d)) return d;
  const last = d.entries.filter((e) => e.end).sort((a, b) => b.end!.localeCompare(a.end!))[0];
  if (!last) return d;
  const { description, projectId, activityId, billable, taskId, taskName } = last;
  return startTimer(d, { description, projectId, activityId, billable, taskId, taskName });
}

/**
 * You came back after being idle since `since`. "discard" cuts the idle time out of the running timer
 * and restarts it now; "break" does the same and records the time as a break; "leave" clocks you out at `since`.
 */
export function resolveIdle(d: Data, since: string, choice: 'keep' | 'discard' | 'break' | 'leave'): Data {
  if (choice === 'keep') return d;
  const running = runningEntry(d);
  // "leave": you went home at `since`. Stop the timer and end the open workday there.
  if (choice === 'leave') {
    const entries = d.entries.map((e) => (e.end ? e : { ...e, end: since > e.start ? since : e.start }));
    const workdays = d.workdays.map((w) => (w.end || w.off ? w : { ...closeBreaks(w, since > w.start ? since : w.start), end: since > w.start ? since : w.start }));
    return { ...d, entries, workdays };
  }
  if (!running || since <= running.start) {
    if (choice === 'break') return mapToday(d, (w) => (w.end ? w : { ...w, breaks: [...w.breaks, { start: since, end: nowIso() }] }));
    return d;
  }
  const now = nowIso();
  const { description, projectId, activityId, billable, taskId, taskName } = running;
  let next: Data = {
    ...d,
    entries: [
      ...d.entries.map((e) => (e.id === running.id ? { ...e, end: since } : e)),
      { id: uid(), description, projectId, activityId, billable, taskId, taskName, start: now },
    ],
  };
  if (choice === 'break') next = mapToday(next, (w) => (w.end ? w : { ...w, breaks: [...w.breaks, { start: since, end: now }] }));
  return next;
}

/** Append a finished entry of `ms` on a day, in the first free stretch of the clocked-in time (see freeStart). */
export function appendEntry(d: Data, day: string, ms: number, fields: Partial<Entry>): Data {
  if (ms < 60_000) return d;
  const start = freeStart(d, day, ms);
  const end = new Date(Date.parse(start) + ms).toISOString();
  return { ...d, entries: [...d.entries, { id: uid(), description: '', ...fields, start, end }] };
}

export type PlanGap = { projectId: string; taskId?: number; taskName?: string; ms: number };

/** What's still missing against the plan on a day, per planned task (entries without a task count toward the first). */
export function planGaps(d: Data, day: string): PlanGap[] {
  const gaps: PlanGap[] = [];
  for (const p of d.projects) {
    const items = planItemsOn(d, p.id, day);
    const entries = d.entries.filter((e) => e.projectId === p.id && dayKey(e.start) === day);
    const ms = (pred: (e: Entry) => boolean) => entries.filter(pred).reduce((s, e) => s + (e.end ? Date.parse(e.end) : Date.now()) - Date.parse(e.start), 0);
    if (!items.length) {
      const goal = goalFor(d, p.id, day);
      const missing = goal - ms(() => true);
      if (missing >= 60_000) gaps.push({ projectId: p.id, ms: missing });
      continue;
    }
    let untasked = ms((e) => !e.taskId || !items.some((i) => i.floatId === e.taskId));
    for (const item of items) {
      let missing = item.hoursPerDay * 3_600_000 - ms((e) => e.taskId === item.floatId);
      const used = Math.min(untasked, Math.max(0, missing));
      missing -= used;
      untasked -= used;
      if (missing >= 60_000) gaps.push({ projectId: p.id, taskId: item.floatId, taskName: item.name || undefined, ms: Math.round(missing / 60_000) * 60_000 });
    }
  }
  return gaps;
}

export function fillGaps(d: Data, day: string, gaps: PlanGap[]): Data {
  return gaps.reduce((acc, g) => appendEntry(acc, day, g.ms, { projectId: g.projectId, taskId: g.taskId, taskName: g.taskName }), d);
}

/** The most recent earlier day (up to 3 weeks back) with finished time on this project, and those entries. */
export function lastDayEntries(d: Data, projectId: string | undefined, day: string): { day: string; entries: Entry[] } | null {
  const earlier = d.entries
    .filter((e) => e.end && (e.projectId || undefined) === projectId && dayKey(e.start) < day && dayKey(e.start) >= dayKey(new Date(Date.parse(`${day}T12:00`) - 21 * 86_400_000)))
    .sort((a, b) => b.start.localeCompare(a.start));
  if (!earlier.length) return null;
  const last = dayKey(earlier[0].start);
  return { day: last, entries: earlier.filter((e) => dayKey(e.start) === last).reverse() };
}

/** Copy entries (description, project, task, activity, billable, duration) onto another day. */
export function copyEntriesTo(d: Data, day: string, entries: Entry[]): Data {
  return entries.reduce((acc, e) => {
    const { description, projectId, activityId, billable, taskId, taskName } = e;
    return appendEntry(acc, day, Date.parse(e.end!) - Date.parse(e.start), { description, projectId, activityId, billable, taskId, taskName });
  }, d);
}

/**
 * Last week's entries for "Copy last week": per weekday and project, only where this week's day has nothing yet
 * for that project, isn't a day off, and isn't in the future.
 */
export function weekCopyPlan(d: Data, fromDays: string[], toDays: string[]): { day: string; entries: Entry[] }[] {
  const today = dayKey(new Date());
  return toDays.flatMap((to, i) => {
    if (to > today || d.workdays.find((w) => w.date === to)?.off) return [];
    const source = d.entries.filter((e) => e.end && dayKey(e.start) === fromDays[i]).sort((a, b) => a.start.localeCompare(b.start));
    const busy = new Set(d.entries.filter((e) => dayKey(e.start) === to).map((e) => e.projectId ?? ''));
    const entries = source.filter((e) => !busy.has(e.projectId ?? ''));
    return entries.length ? [{ day: to, entries }] : [];
  });
}

export function toggleWeekDone(d: Data, monday: string): Data {
  const done = d.reviewedWeeks.includes(monday);
  return { ...d, reviewedWeeks: done ? d.reviewedWeeks.filter((w) => w !== monday) : [...d.reviewedWeeks, monday] };
}

/**
 * Defaults for a way of working. Clocking in first: the day is started by hand, "Close the day" helps fill it in
 * afterwards. Tracking live: the first timer clocks you in, and you're asked about time away from the computer.
 */
export function workStyleDefaults(style: WorkStyle): Partial<Settings> {
  return style === 'live'
    ? { workStyle: style, startDayWithTimer: true, idleMinutes: 10, reviewOnLeave: false }
    : { workStyle: style, startDayWithTimer: true, reviewOnLeave: true };
}
