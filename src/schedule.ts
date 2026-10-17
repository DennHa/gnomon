// Work schedule: hours per weekday (Mon–Sun), in periods that start on a date, so a change in July doesn't rewrite
// January. Everything that needs "how long should I work on this day" asks targetHoursOn().
import type { Data, WorkSchedule } from './types';

/** Monday = 0 … Sunday = 6, for a YYYY-MM-DD day. */
export const weekdayIndex = (date: string) => (new Date(`${date}T12:00`).getDay() + 6) % 7;

/** Monday to Friday at the given hours, weekend free. */
export const fiveDayWeek = (hours: number) => [hours, hours, hours, hours, hours, 0, 0];

/** Ready-made weeks for the schedule editor. */
export const SCHEDULE_PRESETS: { id: 'full' | 'fourDay' | 'part30' | 'part20'; hours: number[] }[] = [
  { id: 'full', hours: [8, 8, 8, 8, 8, 0, 0] },
  { id: 'fourDay', hours: [8, 8, 8, 8, 0, 0, 0] },
  { id: 'part30', hours: [6, 6, 6, 6, 6, 0, 0] },
  { id: 'part20', hours: [4, 4, 4, 4, 4, 0, 0] },
];

/** The first day any schedule can apply to: before schedules existed, the single daily target applied throughout. */
export const SINCE_ALWAYS = '2000-01-01';

/** All periods, oldest first. Without any: Monday to Friday at the old single daily target. */
export function schedulesOf(d: Data): WorkSchedule[] {
  const list = d.settings.schedules?.length ? d.settings.schedules : [{ from: SINCE_ALWAYS, hours: fiveDayWeek(d.settings.dailyTargetHours) }];
  return [...list].sort((a, b) => a.from.localeCompare(b.from));
}

/** The period that applies on a day (the latest one that started on or before it; the first one before any). */
export function scheduleOn(d: Data, date: string): WorkSchedule {
  const list = schedulesOf(d);
  return [...list].reverse().find((s) => s.from <= date) ?? list[0];
}

/** Hours you're expected to work on a day by your schedule (days off are handled by the callers). */
export const targetHoursOn = (d: Data, date: string) => scheduleOn(d, date).hours[weekdayIndex(date)] ?? 0;

export const weekTotal = (hours: number[]) => hours.reduce((a, b) => a + b, 0);

/** The longest day of the current week, e.g. to judge whether an absence was a full day. */
export const fullDayHours = (d: Data, date: string) => Math.max(0, ...scheduleOn(d, date).hours) || 8;

/** Add a period, or replace the one starting on the same day. Hours are clamped to 0–24 per day. */
export function setSchedule(d: Data, from: string, hours: number[], source?: WorkSchedule['source']): Data {
  const clean = Array.from({ length: 7 }, (_, i) => Math.min(24, Math.max(0, Math.round((Number(hours[i]) || 0) * 100) / 100)));
  const others = schedulesOf(d).filter((s) => s.from !== from);
  const schedules = [...others, { from, hours: clean, ...(source && { source }) }].sort((a, b) => a.from.localeCompare(b.from));
  return { ...d, settings: { ...d.settings, schedules } };
}

/** Remove a period; the very first one always stays, so every day has a schedule. */
export function removeSchedule(d: Data, from: string): Data {
  const list = schedulesOf(d);
  if (list.length <= 1) return d;
  return { ...d, settings: { ...d.settings, schedules: list.filter((s) => s.from !== from) } };
}
