// Overtime balance ("Überstundenkonto"): worked time minus the scheduled target on every finished workday
// (and, with countAllScheduledDays, on every scheduled workday without a record).
// Normal days off (vacation, sick, holidays) don't count; "overtime off" days count with 0 worked, so they use the balance.
import type { Data, Workday } from './types';
import { addDays, dayKey, hoursToMs, workdayMs } from './time';
import { targetHoursOn } from './schedule';

const nextDay = (day: string) => dayKey(addDays(new Date(`${day}T12:00`), 1));

/** The day's target: 0 for normal days off, otherwise the hours the work schedule sets for that weekday. */
export function targetFor(d: Data, w: Workday): number {
  return w.off && w.offKind !== 'overtime' ? 0 : hoursToMs(targetHoursOn(d, w.date));
}

/** Worked minus target for a finished day; null when the day doesn't count (normal day off, or still open). */
export function dayBalance(d: Data, w: Workday, now = Date.now()): number | null {
  if (w.off && w.offKind !== 'overtime') return null;
  if (!w.off && !w.end) return null;
  return (w.off ? 0 : workdayMs(w, now)) - targetFor(d, w);
}

export type MonthBalance = { month: string; target: number; worked: number; diff: number; running: number };

/** Per month (oldest first) with the running balance, plus the current total including the starting balance. */
export function balanceByMonth(d: Data, now = Date.now()): { start: number; startDate?: string; total: number; months: MonthBalance[] } {
  const start = hoursToMs(d.settings.balanceStartHours || 0);
  const from = d.settings.balanceStartDate;
  const byMonth = new Map<string, { target: number; worked: number }>();
  const add = (date: string, target: number, worked: number) => {
    const m = byMonth.get(date.slice(0, 7)) ?? { target: 0, worked: 0 };
    m.target += target;
    m.worked += worked;
    byMonth.set(date.slice(0, 7), m);
  };
  const sorted = [...d.workdays].sort((a, b) => a.date.localeCompare(b.date));
  for (const w of sorted) {
    if (from && w.date < from) continue;
    if (dayBalance(d, w, now) === null) continue;
    add(w.date, targetFor(d, w), w.off ? 0 : workdayMs(w, now));
  }
  // Optionally, scheduled workdays without any record count as missing time (up to yesterday).
  if (d.settings.countAllScheduledDays && sorted.length) {
    const recorded = new Set(sorted.map((w) => w.date));
    const today = dayKey(now);
    for (let day = from && from > sorted[0].date ? from : sorted[0].date; day < today; day = nextDay(day)) {
      if (recorded.has(day)) continue;
      const target = hoursToMs(targetHoursOn(d, day));
      if (target > 0) add(day, target, 0);
    }
  }
  let running = start;
  const months = [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => {
    running += m.worked - m.target;
    return { month, target: m.target, worked: m.worked, diff: m.worked - m.target, running };
  });
  return { start, startDate: from, total: running, months };
}
