// "Check these days": past days whose numbers look off, for the one-time list in src/views/DayCheck.tsx. It only reads;
// nothing changes until the person picks a fix or says it's right. The same overlap calculation drives the day timeline.
import { awayDays, confirmAutoClose, endsAtMidnight } from './actions';
import { hoursMode, MAX_DAY } from './corridor';
import { targetHoursOn } from './schedule';
import { atTime, dayKey, entryMs, hoursToMs, workdayMs } from './time';
import type { Data, Entry } from './types';

/** Booked this much above clocked counts as far above; the day view already mentions smaller differences. */
export const FAR_ABOVE = 60 * 60_000;

export type CheckReason =
  | { kind: 'timer' } // an entry ends at 23:59: most likely the midnight close, not you
  | { kind: 'closed' } // still closed at midnight, leave time never confirmed
  | { kind: 'crossing' } // an entry runs past midnight
  | { kind: 'overlap'; ms: number }
  | { kind: 'long'; worked: number }
  | { kind: 'overbooked'; booked: number; clocked: number };

export type CheckDay = { date: string; reasons: CheckReason[]; /** It has a leave time to set. */ fix: boolean };

/** Where entries lie over each other: each stretch covered at least twice, merged, oldest first. */
export function overlapSpans(entries: Pick<Entry, 'start' | 'end'>[], now = Date.now()): [number, number][] {
  const marks = entries.flatMap((e) => {
    const a = Date.parse(e.start);
    const b = e.end ? Date.parse(e.end) : now;
    return b > a ? ([[a, 1], [b, -1]] as [number, number][]) : [];
  });
  marks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: [number, number][] = [];
  let depth = 0;
  let from = 0;
  for (const [at, step] of marks) {
    if (depth < 2 && depth + step >= 2) from = at;
    if (depth >= 2 && depth + step < 2 && at > from) {
      const last = out[out.length - 1];
      if (last && last[1] === from) last[1] = at;
      else out.push([from, at]);
    }
    depth += step;
  }
  return out;
}

export const overlapMs = (entries: Pick<Entry, 'start' | 'end'>[], now = Date.now()) => overlapSpans(entries, now).reduce((s, [a, b]) => s + b - a, 0);

/** The days to look at, newest first. Today and days someone already answered for don't count. */
export function daysToCheck(d: Data, now = Date.now()): CheckDay[] {
  const today = dayKey(now);
  const skip = new Set([...(d.settings.checkedDays ?? []), ...awayDays(d)]);
  const byDay = new Map<string, Entry[]>();
  for (const e of d.entries) byDay.set(dayKey(e.start), [...(byDay.get(dayKey(e.start)) ?? []), e]);
  const days = new Set([...byDay.keys(), ...d.workdays.map((w) => w.date)]);
  const out: CheckDay[] = [];
  for (const date of days) {
    if (date >= today || skip.has(date)) continue;
    const wd = d.workdays.find((w) => w.date === date);
    const entries = (byDay.get(date) ?? []).filter((e) => e.end);
    const reasons: CheckReason[] = [];
    const timer = entries.some(endsAtMidnight);
    if (timer) reasons.push({ kind: 'timer' });
    else if (wd?.autoClosed) reasons.push({ kind: 'closed' });
    if (entries.some((e) => dayKey(e.end!) !== date)) reasons.push({ kind: 'crossing' });
    const overlap = overlapMs(entries, now);
    if (overlap >= 60_000) reasons.push({ kind: 'overlap', ms: overlap });
    if (wd && !wd.off && wd.end) {
      const clocked = workdayMs(wd, now);
      const booked = entries.reduce((s, e) => s + entryMs(e, now), 0);
      if (clocked > MAX_DAY && !d.settings.longDaysOk?.includes(date)) reasons.push({ kind: 'long', worked: clocked });
      if (booked - clocked >= FAR_ABOVE) reasons.push({ kind: 'overbooked', booked, clocked });
    }
    if (reasons.length) out.push({ date, reasons, fix: timer || Boolean(wd?.autoClosed) });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * What the sidebar counts: days it doesn't already ask about one by one. Days closed at midnight have their own item
 * there, and in corridor mode so do days over 10 hours. The list itself still shows them.
 */
export function sidebarDays(d: Data, days: CheckDay[]): CheckDay[] {
  return days.filter((c) => !d.workdays.find((w) => w.date === c.date)?.autoClosed && !(hoursMode(d) === 'corridor' && c.reasons.every((r) => r.kind === 'long')));
}

/** "It's right": the day stays as it is and stops being asked about, here and in the target corridor. */
export function confirmDay(d: Data, date: string): Data {
  const next = confirmAutoClose(d, date);
  const { checkedDays = [], longDaysOk = [] } = next.settings;
  return { ...next, settings: { ...next.settings, checkedDays: [...checkedDays, date], longDaysOk: longDaysOk.includes(date) ? longDaysOk : [...longDaysOk, date] } };
}

/**
 * A good guess for when you left on a day you forgot to clock out: the end of your last timer (one cut off at midnight
 * doesn't count), else your arrival plus that day's target and a half-hour break, else 17:00. Never before a timer cut
 * off at midnight started: you were there then, and that time would take the whole timer away.
 */
export function leaveSuggestion(data: Data, date: string): string {
  const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
  const midnightCut = Date.parse(atTime(date, '23:58'));
  const finished = data.entries.filter((e) => e.end && dayKey(e.start) === date);
  const ends = finished.map((e) => Date.parse(e.end!)).filter((ms) => ms < midnightCut);
  const cutFrom = Math.max(0, ...finished.filter((e) => Date.parse(e.end!) >= midnightCut).map((e) => Date.parse(e.start)));
  if (ends.length && Math.max(...ends) > cutFrom) return hhmm(Math.max(...ends));
  const wd = data.workdays.find((w) => w.date === date);
  const target = hoursToMs(targetHoursOn(data, date));
  const guess = wd && target > 0 ? Math.min(midnightCut - 60_000, Date.parse(wd.start) + target + (target >= 6 * 3_600_000 ? 30 * 60_000 : 0)) : Date.parse(atTime(date, '17:00'));
  return hhmm(Math.max(guess, Math.min(midnightCut - 60_000, cutFrom + 30 * 60_000)));
}
