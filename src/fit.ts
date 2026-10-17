// The workday follows the entries: tracked time always lies inside the time you were clocked in.
// - A day with entries but no clock-in gets a workday made from them (first start to last end, gaps as breaks),
//   marked fromEntries until you change it by hand. Today's stays open until you leave.
// - Entries before your arrival or after your leaving move arrival or leaving to cover them.
// Runs after every change (src/store.tsx) for the days whose entries changed.
import type { Break, Data, Entry, Workday } from './types';
import { dayKey } from './time';

export type FitNotice = { kind: 'created' | 'start' | 'end'; date: string; at: string };

/** Days whose entries changed between two states (entries compared by identity, like the sync does). */
function changedDays(prev: Data, next: Data): Set<string> {
  const days = new Set<string>();
  if (prev.entries === next.entries) return days;
  const before = new Map(prev.entries.map((e) => [e.id, e]));
  for (const e of next.entries) {
    const old = before.get(e.id);
    if (old !== e) {
      days.add(dayKey(e.start));
      if (old) days.add(dayKey(old.start));
    }
    before.delete(e.id);
  }
  for (const e of before.values()) days.add(dayKey(e.start)); // deleted
  return days;
}

/** The entries of a day as merged [start, end] spans (ms), oldest first; a running entry counts up to now. */
function spans(entries: Entry[], now: number): [number, number][] {
  const list = entries.map((e) => [Date.parse(e.start), e.end ? Date.parse(e.end) : now] as [number, number]).filter(([a, b]) => b > a);
  list.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const s of list) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function fitDay(d: Data, date: string, now = Date.now()): { data: Data; notices: FitNotice[] } {
  const wd = d.workdays.find((w) => w.date === date);
  if (wd?.off) return { data: d, notices: [] };
  const entries = d.entries.filter((e) => dayKey(e.start) === date);
  const running = entries.some((e) => !e.end);
  const s = spans(entries, now);

  // No entries left on a day that only existed because of them: remove it again.
  if (!s.length) return wd?.fromEntries ? { data: { ...d, workdays: d.workdays.filter((w) => w !== wd) }, notices: [] } : { data: d, notices: [] };

  const first = s[0][0];
  const last = s[s.length - 1][1];
  if (!wd || wd.fromEntries) {
    const breaks: Break[] = s.slice(1).map(([a], i) => ({ start: iso(s[i][1]), end: iso(a) }));
    // Today stays open (you may still be at work; Leave closes it); other days end with their last entry.
    const open = running || date === dayKey(now);
    const made: Workday = { date, start: iso(first), ...(!open && { end: iso(last) }), breaks, fromEntries: true };
    const same = wd && JSON.stringify({ ...wd }) === JSON.stringify(made);
    if (same) return { data: d, notices: [] };
    const workdays = wd ? d.workdays.map((w) => (w === wd ? made : w)) : [...d.workdays, made];
    return { data: { ...d, workdays }, notices: wd ? [] : [{ kind: 'created', date, at: made.start }] };
  }

  // A day you clocked in yourself: only widen it.
  const notices: FitNotice[] = [];
  let next = wd;
  if (first < Date.parse(wd.start)) {
    next = { ...next, start: iso(first) };
    notices.push({ kind: 'start', date, at: next.start });
  }
  if (wd.end && !running && last > Date.parse(wd.end)) {
    next = { ...next, end: iso(last) };
    notices.push({ kind: 'end', date, at: next.end! });
  }
  if (next === wd) return { data: d, notices };
  return { data: { ...d, workdays: d.workdays.map((w) => (w === wd ? next : w)) }, notices };
}

/** Fit every day whose entries changed from `prev` to `next`. */
export function fitWorkdays(prev: Data, next: Data, now = Date.now()): { data: Data; notices: FitNotice[] } {
  let data = next;
  const notices: FitNotice[] = [];
  for (const date of changedDays(prev, next)) {
    const r = fitDay(data, date, now);
    data = r.data;
    notices.push(...r.notices);
  }
  return { data, notices };
}

/** Fit every day that has entries (used once when updating to this version). */
export function fitAll(d: Data, now = Date.now()): Data {
  let data = d;
  for (const date of new Set(d.entries.map((e) => dayKey(e.start)))) data = fitDay(data, date, now).data;
  return data;
}
