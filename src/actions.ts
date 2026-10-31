// Pure state transitions. Every function takes the current Data and returns the next one.
import type { Activity, ActivityPreset, Away, Break, Data, Entry, Project, Settings, Workday, WorkStyle } from './types';
import { atTime, dayKey, nowIso, toTimeInput, uid, workdayMs } from './time';
import { goalFor, planItemsOn } from './plan';

export const PROJECT_COLORS = ['#03A9F4', '#8BC34A', '#FF9800', '#E91E63', '#9C27B0', '#009688', '#3F51B5', '#795548', '#F44336', '#607D8B'];

export const runningEntry = (d: Data) => d.entries.find((e) => !e.end);
/** Whether activities are in use (Settings → Tracking); data from before the switch keeps them. */
export const activitiesOn = (d: Data) => d.settings.activitiesEnabled !== false && d.activities.length > 0;
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
  // Pressing Start day on a day Gnomon made from your entries makes it yours: it stops following the entries.
  if (!wd.end) return wd.fromEntries ? mapToday(d, (w) => ({ ...w, fromEntries: undefined })) : d;
  return mapToday(d, (w) => ({ ...w, end: undefined, fromEntries: undefined, breaks: [...w.breaks, { start: w.end!, end: at }] }));
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

/** Whether a finished entry ends in the last minute of its day: how an entry the midnight close stopped looks. */
export const endsAtMidnight = (e: Entry) => Boolean(e.end) && dayKey(e.end!) === dayKey(e.start) && toTimeInput(e.end!) === '23:59';

/** Whether the midnight close stopped this entry: it carries the mark, or (from before the mark) ends 23:59:xx on an autoClosed day. */
const autoStopped = (e: Entry, wd?: Workday) => Boolean(e.autoStopped || (wd?.autoClosed && endsAtMidnight(e)));

/** End the entries `which` picks at `end`; one that started later than that has no time left and goes. */
function cutEntries(d: Data, date: string, end: string, which: (e: Entry) => boolean): Data {
  const cut = d.entries.filter((e) => e.end && dayKey(e.start) === date && e.end > end && which(e));
  if (!cut.length) return d;
  const ids = new Set(cut.map((e) => e.id));
  return { ...d, entries: d.entries.flatMap((e) => (!ids.has(e.id) ? [e] : e.start >= end ? [] : [{ ...e, end, autoStopped: undefined }])) };
}

export function updateWorkday(d: Data, date: string, patch: Partial<Workday>): Data {
  const wd = d.workdays.find((w) => w.date === date);
  // Editing the leave time confirms it, so an auto-closed day stops asking, and a timer midnight stopped ends there too.
  const confirm = patch.end ? { autoClosed: undefined } : {};
  const next = patch.end ? cutEntries(d, date, patch.end, (e) => autoStopped(e, wd)) : d;
  // Changed by hand: it no longer follows the entries.
  return { ...next, workdays: d.workdays.map((w) => (w.date === date ? { ...w, ...patch, ...confirm, fromEntries: undefined } : w)) };
}

/** Close a day you forgot to clock out of; a timer midnight stopped is cut to the same time. */
export function closeWorkday(d: Data, date: string, end: string): Data {
  const wd = d.workdays.find((w) => w.date === date);
  if (wd && end <= wd.start) return d;
  const next = cutEntries(d, date, end, (e) => autoStopped(e, wd));
  return { ...next, workdays: d.workdays.map((w) => (w.date === date ? { ...closeBreaks(w, end), end, autoClosed: undefined, fromEntries: undefined } : w)) };
}

/**
 * The check list's fix: the same as closeWorkday, but it also cuts unmarked entries ending at 23:59. Those are days
 * corrected before the mark existed (the workday no longer says autoClosed), and here the person points at them.
 */
export function fixLeave(d: Data, date: string, end: string): Data {
  const wd = d.workdays.find((w) => w.date === date && !w.off);
  if (wd && end <= wd.start) return d;
  const next = cutEntries(d, date, end, endsAtMidnight);
  return wd ? closeWorkday(next, date, end) : next;
}

/** Accept an auto-closed day's 23:59 as it is; its timer then counts as set by you and is never cut. */
export function confirmAutoClose(d: Data, date: string): Data {
  return {
    ...d,
    entries: d.entries.map((e) => (e.autoStopped && dayKey(e.start) === date ? { ...e, autoStopped: undefined } : e)),
    workdays: d.workdays.map((w) => (w.date === date ? { ...w, autoClosed: undefined } : w)),
  };
}

export type CutNote = { date: string; end?: string; ms: number; entries: Entry[]; workday?: Workday };

/** What a leave-time correction cut (for the note with Undo), or null when no entry changed. */
export function cutNote(before: Data, after: Data, date: string): CutNote | null {
  const now = new Map(after.entries.map((e) => [e.id, e]));
  const entries = before.entries.filter((e) => e.end && dayKey(e.start) === date && now.get(e.id) !== e);
  const ms = entries.reduce((s, e) => {
    const x = now.get(e.id);
    return s + Date.parse(e.end!) - (x?.end ? Date.parse(x.end) : Date.parse(e.start));
  }, 0);
  if (ms <= 0) return null;
  return { date, end: after.workdays.find((w) => w.date === date)?.end, ms, entries, workday: before.workdays.find((w) => w.date === date) };
}

/** Undo a cut: the entries and the workday as they were. */
export function undoCut(d: Data, note: CutNote): Data {
  const back = new Map(note.entries.map((e) => [e.id, e]));
  const kept = d.entries.map((e) => {
    const old = back.get(e.id);
    back.delete(e.id);
    return old ?? e;
  });
  return {
    ...d,
    entries: [...kept, ...back.values()],
    workdays: note.workday ? d.workdays.map((w) => (w.date === note.date ? note.workday! : w)) : d.workdays,
  };
}

/** True when a workday or timer from an earlier calendar day is still open. */
export function hasOvernight(d: Data, today = dayKey(new Date())): boolean {
  return d.workdays.some((w) => !w.end && w.date < today) || d.entries.some((e) => !e.end && dayKey(e.start) < today);
}

/**
 * Midnight auto-stop: close workdays and the timer left open on an earlier day at 23:59 of that day.
 * The workday is marked autoClosed so the UI asks for the real leave time, the timer autoStopped so it can be cut to it.
 */
export function closeOvernight(d: Data, today = dayKey(new Date())): Data {
  if (!hasOvernight(d, today)) return d;
  const endOf = (day: string) => new Date(Date.parse(atTime(day, '23:59')) + 59_000).toISOString();
  return {
    ...d,
    entries: d.entries.map((e) => (!e.end && dayKey(e.start) < today ? { ...e, end: endOf(dayKey(e.start)), autoStopped: true } : e)),
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

/** Change a break's times; a break that would end before (or when) it starts is refused, and nothing changes. */
export function updateBreak(d: Data, date: string, index: number, patch: Partial<Break>): Data {
  const b = d.workdays.find((w) => w.date === date)?.breaks[index];
  const next = b && { ...b, ...patch };
  if (!next || (next.end && next.end <= next.start)) return d;
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

type Span = [number, number];

/** A day as ms; it ends at 23:59, so nothing placed in it crosses midnight. */
const dayBounds = (day: string): Span => [Date.parse(atTime(day, '00:00')), Date.parse(atTime(day, '23:59'))];

/** What's taken on a day, merged and oldest first: entries (also ones reaching in from the day before) and breaks. */
function busySpans(d: Data, day: string, now: number, skip?: string): Span[] {
  const [from, to] = dayBounds(day);
  const wd = d.workdays.find((w) => w.date === day && !w.off);
  const list = [...d.entries.filter((e) => e.id !== skip), ...(wd?.breaks ?? [])]
    .map((x): Span => [Math.max(from, Date.parse(x.start)), Math.min(to, x.end ? Date.parse(x.end) : now)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  for (const s of list) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}

/**
 * Where an entry of `ms` goes on a day: never over another entry or a break, never past midnight. First the first free
 * stretch inside the time you were clocked in; if it doesn't fit there, the free time outside it (later that day, or
 * right before you arrived; a day still open has no "later" yet, so before comes first). Without a clock-in, after the
 * day's last entry, or at 09:00. Null when the day has no stretch that long. Typing hours in never moves your arrival.
 */
export function freeStart(d: Data, day: string, ms: number, now = Date.now(), skip?: string): string | null {
  const [from, to] = dayBounds(day);
  const free: Span[] = [];
  let at = from;
  for (const [a, b] of busySpans(d, day, now, skip)) {
    if (a > at) free.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < to) free.push([at, to]);

  const wd = d.workdays.find((w) => w.date === day && !w.off);
  const ends = d.entries.filter((e) => e.end && e.id !== skip && dayKey(e.start) === day).map((e) => Date.parse(e.end!));
  const open = Boolean(wd && !wd.end && day === dayKey(now));
  const lo = wd ? Date.parse(wd.start) : ends.length ? Math.max(...ends) : Date.parse(atTime(day, '09:00'));
  const hi = wd?.end ? Date.parse(wd.end) : open ? now : to;
  const iso = (v: number) => new Date(v).toISOString();

  for (const [a, b] of free) if (Math.min(b, hi) - Math.max(a, lo) >= ms) return iso(Math.max(a, lo));
  const after = () => {
    for (const [a, b] of free) if (b - Math.max(a, hi) >= ms) return iso(Math.max(a, hi));
    return null;
  };
  const before = () => {
    for (const [a, b] of [...free].reverse()) if (Math.min(b, lo) - a >= ms) return iso(Math.min(b, lo) - ms);
    return null;
  };
  // Longer than either side alone: a free stretch reaching over your arrival or leaving.
  const across = () => free.find(([a, b]) => b - a >= ms)?.[0];
  const spot = open ? (before() ?? after()) : (after() ?? before());
  return spot ?? (across() !== undefined ? iso(across()!) : null);
}

/** Add a finished one-hour entry on any day, in that day's free time (see freeStart); nothing when there's none. */
export function addEntry(d: Data, date: string): Data {
  const last = d.entries.filter((e) => e.end && dayKey(e.start) === date).sort((a, b) => b.end!.localeCompare(a.end!))[0];
  const start = freeStart(d, date, 3_600_000);
  if (!start) return d;
  const end = new Date(Date.parse(start) + 3_600_000).toISOString();
  return { ...d, entries: [...d.entries, { id: uid(), description: '', projectId: last?.projectId, start, end }] };
}

/**
 * Timesheet editing: make a project's finished entries on a day add up to `targetMs`.
 * More time is added as one entry where it fits (see freeStart); less time trims the latest entries.
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
  // A new end is yours: the entry no longer counts as stopped by the midnight close.
  const mine = patch.end ? { autoStopped: undefined } : {};
  return {
    ...d,
    entries: d.entries.map((e) => (e.id === id ? { ...e, ...patch, ...mine } : e)),
  };
}

/**
 * Type a finished entry's hours: it stays where it starts when that's free, otherwise it moves to where the hours fit
 * (see freeStart). Unchanged when the day has no room.
 */
export function setEntryHours(d: Data, id: string, ms: number, now = Date.now()): Data {
  const e = d.entries.find((x) => x.id === id);
  if (!e?.end || ms < 60_000) return d;
  const start = Date.parse(e.start);
  const day = dayKey(e.start);
  const end = start + ms;
  const iso = (v: number) => new Date(v).toISOString();
  const fits = end <= Date.parse(e.end) || (end <= dayBounds(day)[1] && !busySpans(d, day, now, e.id).some(([a, b]) => a < end && b > start));
  if (fits) return updateEntry(d, id, { end: iso(end) });
  const at = freeStart(d, day, ms, now, id);
  return at ? updateEntry(d, id, { start: at, end: iso(Date.parse(at) + ms) }) : d;
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

export function addActivity(d: Data, name: string, color?: string, id = uid()): Data {
  const a: Activity = { id, name: name.trim(), color: color ?? PROJECT_COLORS[(d.activities.length + 3) % PROJECT_COLORS.length] };
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

// ---- Time away ------------------------------------------------------------------------------------------------
// The question after an absence (src/views/Away.tsx). Its facts live in Data.away, so it survives a restart and the
// midnight close, which may run first. The Mac's main process reports when you left and came back.

/** You left (the laptop closed, the screen locked, no input). Remembers what was running, if anything was. */
export function noteAway(d: Data, since: string, reason: Away['reason']): Data {
  const list = d.away ?? [];
  if (list.some((a) => !a.back)) return d;
  const run = runningEntry(d);
  const entryId = run && run.start < since ? run.id : undefined;
  const wd = d.workdays.find((w) => !w.end && !w.off && w.date === dayKey(since));
  if (!entryId && !wd) return d;
  return { ...d, away: [...list, { since, reason, entryId }] };
}

/** You're back: the open absence gets its end; one shorter than the idle setting isn't worth a question and goes. */
export function markBack(d: Data, back: string): Data {
  const open = d.away?.find((a) => !a.back);
  if (!open) return d;
  const tooShort = Date.parse(back) - Date.parse(open.since) < d.settings.idleMinutes * 60_000;
  const away = tooShort ? d.away!.filter((a) => a !== open) : d.away!.map((a) => (a === open ? { ...a, back } : a));
  return { ...d, away: away.length ? away : undefined };
}

/** The timer of an absence, and the workday it fell on. */
const awayFacts = (d: Data, a: Away) => ({
  entry: d.entries.find((e) => e.id === a.entryId),
  wd: d.workdays.find((w) => w.date === dayKey(a.since) && !w.off),
});

/** Nothing left to decide: the time already ended when you left (you fixed it another way), or its records are gone. */
function settled(d: Data, a: Away): boolean {
  const { entry, wd } = awayFacts(d, a);
  const after = (x?: { end?: string }) => Boolean(x && (!x.end || x.end > a.since));
  return !after(entry) && !after(wd);
}

/** The absence to ask about now: the oldest one that has ended and still has time to decide on. */
export const pendingAway = (d: Data): Away | undefined => d.away?.find((a) => a.back && !settled(d, a));

/** Days a pending absence will settle: nothing else asks about them, so an absence over midnight asks once. */
export const awayDays = (d: Data): string[] => (d.away ?? []).filter((a) => !settled(d, a)).map((a) => dayKey(a.since));

export const awayOverMidnight = (a: Away) => dayKey(a.since) !== dayKey(a.back ?? a.since);

export type AwayChoice = 'working' | 'break' | 'stop' | 'remove';

/** The choices an absence offers. A break can't span midnight; removing is for a timer without a workday of its own. */
export function awayChoices(d: Data, a: Away): AwayChoice[] {
  const { entry, wd } = awayFacts(d, a);
  if (awayOverMidnight(a)) return ['stop', 'working'];
  if (!wd || wd.fromEntries) return entry ? ['working', 'remove', 'stop'] : ['working', 'stop'];
  return ['working', 'break', 'stop'];
}

/** Take [since, back] out of an entry: it ends at `since`, and what came after `back` goes on as a new entry. */
function cutHole(d: Data, e: Entry, since: string, back: string): { data: Data; rest?: Entry } {
  const { description, projectId, activityId, billable, taskId, taskName } = e;
  const rest: Entry | undefined = !e.end || e.end > back ? { id: uid(), description, projectId, activityId, billable, taskId, taskName, start: back, ...(e.end && { end: e.end }) } : undefined;
  const entries = d.entries.map((x) => (x.id === e.id ? { ...x, end: since, autoStopped: undefined } : x));
  return { data: { ...d, entries: rest ? [...entries, rest] : entries }, rest };
}

/**
 * Answer the question about `a`. working: the time stays (over midnight: until midnight, as the auto-stop left it).
 * break: the time comes out of the timer and becomes a break; the timer goes on from when you came back. remove: the
 * same without a break. stop: you stopped at `at` (default: when you left), so the timer ends there and the day closes.
 */
export function resolveAway(d: Data, a: Away, choice: AwayChoice, at?: string): Data {
  const back = a.back ?? a.since;
  const { entry, wd } = awayFacts(d, a);
  const date = dayKey(a.since);
  const rest = (d.away ?? []).filter((x) => x.since !== a.since);
  const done = (next: Data, list = rest): Data => ({ ...next, away: list.length ? list : undefined });

  if (choice === 'working') return done(wd?.autoClosed || entry?.autoStopped ? confirmAutoClose(d, date) : d);

  if (choice === 'stop') {
    const low = Math.max(...[entry?.start, wd?.start].map((x) => (x ? Date.parse(x) + 60_000 : 0)));
    const high = Math.min(Date.parse(back), dayBounds(date)[1]);
    const stop = new Date(Math.max(low, Math.min(Date.parse(at ?? a.since), high))).toISOString();
    const stopped = entry && (!entry.end || entry.end > stop) ? { ...d, entries: d.entries.map((e) => (e.id === entry.id ? { ...e, end: stop, autoStopped: undefined } : e)) } : d;
    const closed = wd ? closeWorkday(stopped, date, stop) : stopped;
    // Later absences of a day that has now ended have nothing left to ask.
    return done(closed, rest.filter((x) => dayKey(x.since) !== date || x.since < stop));
  }

  const cut = entry && a.since > entry.start ? cutHole(d, entry, a.since, back) : { data: d, rest: undefined };
  // Later absences of this timer belong to the part that goes on.
  const list = rest.map((x) => (cut.rest && x.entryId === entry?.id ? { ...x, entryId: cut.rest.id } : x));
  if (choice === 'remove' || !wd) return done(cut.data, list);
  const addPause = (w: Workday) => ({ ...w, fromEntries: undefined, breaks: [...w.breaks, { start: a.since, end: back }].sort((x, y) => x.start.localeCompare(y.start)) });
  return done({ ...cut.data, workdays: cut.data.workdays.map((w) => (w.date === date ? addPause(w) : w)) }, list);
}

export type AwayResult = { timer?: number; day?: number };

/** What a choice leads to, shown next to it: counted as of when you came back. */
export function awayResult(d: Data, a: Away, choice: AwayChoice, at?: string): AwayResult {
  const next = resolveAway(d, a, choice, at);
  const count = Date.parse(a.back ?? a.since);
  const e = next.entries.find((x) => x.id === a.entryId);
  const wd = next.workdays.find((w) => w.date === dayKey(a.since) && !w.off);
  return { timer: e && (e.end ? Date.parse(e.end) : count) - Date.parse(e.start), day: wd && workdayMs(wd, count) };
}

/** Append a finished entry of `ms` on a day where it fits (see freeStart); unchanged when the day has no room. */
export function appendEntry(d: Data, day: string, ms: number, fields: Partial<Entry>): Data {
  if (ms < 60_000) return d;
  const start = freeStart(d, day, ms);
  if (!start) return d;
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
 * Defaults for a way of working. Clocking in first: the day is started by hand, the menu bar shows today's work time
 * and "Close the day" helps fill it in afterwards. Tracking live: the first timer clocks you in, the menu bar shows the
 * running task, and you're asked about time away from the computer.
 */
export function workStyleDefaults(style: WorkStyle): Partial<Settings> {
  return style === 'live'
    ? { workStyle: style, startDayWithTimer: true, idleMinutes: 10, reviewOnLeave: false, menuBarLabel: 'task-time' }
    : { workStyle: style, startDayWithTimer: true, reviewOnLeave: true, menuBarLabel: 'workday' };
}
