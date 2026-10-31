// A person's typical day: when they usually start, pause and stop, from their work schedule and recent weeks. The day
// timeline shows it as faint bands and as a ghost on an empty day, and everything that offers a default time uses it.
// Times are minutes since midnight.
import { atTime, dayKey, workdayMs } from './time';
import { fullDayHours, targetHoursOn } from './schedule';
import type { Data, Workday } from './types';

export type Band = [number, number];
export type Typical = {
  in: number;
  out: number;
  /** Missing on short days and for people who don't record breaks. */
  breakStart?: number;
  breakEnd?: number;
  bands: { in: Band; out: Band; break?: Band };
};

const WEEKS = 8;
/** Fewer matching days than this say too little: the schedule decides. */
const MIN_DAYS = 3;
/** From this many hours a day, a break is expected. */
const BREAK_FROM_HOURS = 6;
const MIN_BAND = 30;

const minutes = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};
const round5 = (m: number) => Math.round(m / 5) * 5;
const pick = (sorted: number[], q: number) => sorted[Math.round((sorted.length - 1) * q)];
const asc = (list: number[]) => [...list].sort((a, b) => a - b);

/** The middle half of the values, at least MIN_BAND wide around their median. */
function bandOf(lows: number[], highs = lows): { mid: number; band: Band } {
  const a = asc(lows);
  const b = asc(highs);
  const mid = round5(pick(a, 0.5));
  const center = (mid + round5(pick(b, 0.5))) / 2;
  return { mid, band: [Math.min(round5(pick(a, 0.25)), center - MIN_BAND / 2), Math.max(round5(pick(b, 0.75)), center + MIN_BAND / 2)] };
}

/** The break a finished day had, if it had one worth counting. */
function breakOf(w: Workday): { start: number; end: number } | undefined {
  const longest = w.breaks.filter((b) => b.end).sort((x, y) => Date.parse(y.end!) - Date.parse(y.start) - (Date.parse(x.end!) - Date.parse(x.start)))[0];
  if (!longest || Date.parse(longest.end!) - Date.parse(longest.start) < 10 * 60_000) return undefined;
  return { start: minutes(longest.start), end: minutes(longest.end!) };
}

/** Nothing to go on: 8–9, 12–13 and 17–18 for an eight-hour day; shorter days stop earlier and go without a break. */
function fromSchedule(hours: number): Typical {
  const pause = hours >= BREAK_FROM_HOURS;
  const out = Math.min(23 * 60 + 30, 510 + Math.round(hours * 60) + (pause ? 60 : 0));
  return { in: 510, out, ...(pause && { breakStart: 720, breakEnd: 780 }), bands: { in: [480, 540], out: [out - 30, out + 30], ...(pause && { break: [720, 780] as Band }) } };
}

/**
 * The typical day for `date`: the last eight weeks' finished days with about the same scheduled hours (so a part-timer's
 * short Friday is its own kind of day). Days off, days the midnight close ended and days nobody worked don't count.
 */
export function typicalDay(d: Data, date: string, now = Date.now()): Typical {
  const today = dayKey(now);
  const hours = targetHoursOn(d, date) || fullDayHours(d, date);
  const since = dayKey(new Date(now - WEEKS * 7 * 86_400_000));
  const days = d.workdays.filter(
    (w) => w.end && !w.off && !w.autoClosed && w.date < today && w.date >= since && minutes(w.end) < 23 * 60 + 58 && workdayMs(w, now) >= 30 * 60_000 && Math.abs(targetHoursOn(d, w.date) - hours) <= 1,
  );
  if (days.length < MIN_DAYS) return fromSchedule(hours);
  const start = bandOf(days.map((w) => minutes(w.start)));
  const stop = bandOf(days.map((w) => minutes(w.end!)));
  const pauses = days.flatMap((w) => breakOf(w) ?? []);
  if (pauses.length * 2 < days.length) return { in: start.mid, out: stop.mid, bands: { in: start.band, out: stop.band } };
  const pause = bandOf(pauses.map((b) => b.start), pauses.map((b) => b.end));
  const length = round5(pick(asc(pauses.map((b) => b.end - b.start)), 0.5));
  return { in: start.mid, out: stop.mid, breakStart: pause.mid, breakEnd: pause.mid + length, bands: { in: start.band, out: stop.band, break: pause.band } };
}

/** "HH:MM" of a time in minutes. */
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const atMinutes = (date: string, m: number) => atTime(date, hhmm(m));
