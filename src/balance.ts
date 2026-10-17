// Overtime balance ("Überstundenkonto"): worked time minus the daily target on every finished workday.
// Normal days off (vacation, sick, holidays) don't count; "overtime off" days count with 0 worked, so they use the balance.
import type { Data, Workday } from './types';
import { hoursToMs, workdayMs } from './time';

/** The day's target: 0 for normal days off, otherwise the daily target. */
export function targetFor(d: Data, w: Workday): number {
  return w.off && w.offKind !== 'overtime' ? 0 : hoursToMs(d.settings.dailyTargetHours);
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
  for (const w of [...d.workdays].sort((a, b) => a.date.localeCompare(b.date))) {
    if (from && w.date < from) continue;
    const diff = dayBalance(d, w, now);
    if (diff === null) continue;
    const m = byMonth.get(w.date.slice(0, 7)) ?? { target: 0, worked: 0 };
    m.target += targetFor(d, w);
    m.worked += w.off ? 0 : workdayMs(w, now);
    byMonth.set(w.date.slice(0, 7), m);
  }
  let running = start;
  const months = [...byMonth].map(([month, m]) => {
    running += m.worked - m.target;
    return { month, target: m.target, worked: m.worked, diff: m.worked - m.target, running };
  });
  return { start, startDate: from, total: running, months };
}
