// Reminders for clocking in first and filling in later (live tracking gets its own nudges in main: no timer for
// 20 minutes, a timer running for 4 hours). Pure functions; App runs them once a minute and on leaving.
import type { Data } from './types';
import { addDays, dayKey, startOfWeek, workdayMs } from './time';
import { targetHoursOn } from './schedule';

const DAY_MS = 86_400_000;

/** Clocked-in time not yet on any entry, for one day (finished entries and a running one up to now). */
export function toAssign(d: Data, date: string, now = Date.now()): number {
  const w = d.workdays.find((x) => x.date === date);
  if (!w || w.off) return 0;
  const tracked = d.entries.filter((e) => dayKey(e.start) === date).reduce((s, e) => s + (e.end ? Date.parse(e.end) : now) - Date.parse(e.start), 0);
  return Math.max(0, workdayMs(w, now) - tracked);
}

/** The week so far (Monday up to and including `date`). */
export function weekToAssign(d: Data, date: string, now = Date.now()): number {
  const monday = startOfWeek(new Date(`${date}T12:00`));
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const day = dayKey(addDays(monday, i));
    if (day > date) break;
    sum += toAssign(d, day, now);
  }
  return sum;
}

/**
 * Whether to remind about filling in the week now: clock-in style, reminders on, the last scheduled workday of the week
 * from 15:00, not yet shown this week, and at least half an hour still to assign (or, in corridor mode, a day left empty).
 */
export function weekReminderDue(d: Data, now = Date.now(), openDays: string[] = []): { monday: string; ms: number; open: number } | null {
  const s = d.settings;
  if (s.workStyle !== 'clock' || s.reminders === false) return null;
  const date = dayKey(now);
  if (new Date(now).getHours() < 15 || targetHoursOn(d, date) <= 0) return null;
  const monday = dayKey(startOfWeek(new Date(now)));
  if (s.weekReminded === monday) return null;
  const laterThisWeek = Array.from({ length: 6 }, (_, i) => dayKey(now + (i + 1) * DAY_MS)).filter((day) => dayKey(startOfWeek(new Date(`${day}T12:00`))) === monday);
  if (laterThisWeek.some((day) => targetHoursOn(d, day) > 0)) return null;
  const ms = weekToAssign(d, date, now);
  // Target corridor: scheduled days this week with nothing recorded (they count as 0 h) are a reason too.
  const open = openDays.filter((day) => day >= monday && day < date);
  return ms >= 30 * 60_000 || open.length ? { monday, ms, open: open.length } : null;
}
