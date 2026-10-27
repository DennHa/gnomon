// Target corridor: instead of a running overtime balance, how far the rolling average of the last few finished weeks
// is from the schedule's target. Hours count as in the balance (clocked time minus breaks, or the bookings on days
// without a clock-in); the target is the work schedule, minus days off. Unlike the balance, a scheduled workday with
// nothing recorded counts as 0 h (and Gnomon asks about it), but only from the first day you recorded anything on.
// Who sees which (balance or corridor) is the company's choice, else the person's Labs switch: see hoursMode().
import type { CompanyHours, Data, Workday } from './types';
import { addDays, dayKey, hoursToMs, startOfWeek, workdayMs } from './time';
import { targetHoursOn } from './schedule';

export type HoursMode = 'balance' | 'corridor';
export type Zone = 'within' | 'elevated' | 'critical';
export type CorridorRules = { weeks: number; within: number; critical: number };

/** The zones of the reference: a 4-week window, within ±10 %, critical beyond 20 %, elevated in between. */
export const DEFAULT_RULES: CorridorRules = { weeks: 4, within: 10, critical: 20 };

/** Balance or corridor: the company's choice when its server sets one, otherwise the person's own (Labs). */
export function hoursMode(d: Data): HoursMode {
  return d.settings.companyHours?.mode ?? d.settings.hoursView ?? 'balance';
}

/** Whether the company decides (so the Labs switch is greyed out). */
export const companyDecides = (d: Data) => Boolean(d.settings.companyHours?.mode);

/** The company's zones where it set them, otherwise the defaults. */
export function rulesOf(c?: CompanyHours): CorridorRules {
  const ok = (v: unknown, min: number, max: number, dflt: number) => (typeof v === 'number' && v >= min && v <= max ? v : dflt);
  const weeks = Math.round(ok(c?.weeks, 1, 26, DEFAULT_RULES.weeks));
  const within = ok(c?.within, 1, 100, DEFAULT_RULES.within);
  return { weeks, within, critical: Math.max(within, ok(c?.critical, 1, 200, DEFAULT_RULES.critical)) };
}

/** within: under `within` %; elevated: from there up to and including `critical` %; critical: beyond. Over and under alike. */
export function zoneOf(pct: number, r: CorridorRules): Zone {
  const a = Math.abs(pct);
  return a < r.within ? 'within' : a <= r.critical ? 'elevated' : 'critical';
}

export type DayOff = { date: string; reason?: string; source?: Workday['offSource']; hours: number };

export type Week = {
  /** The week's Monday. */
  monday: string;
  worked: number;
  target: number;
  /** Whether anything was recorded (a workday or a day off); weeks without are gaps. */
  recorded: boolean;
  /** Normal days off (vacation, sick, holiday, closure) with the hours the schedule would have had. */
  daysOff: DayOff[];
  /** Past scheduled workdays without any record: they count as 0 h. */
  missing: string[];
};

const mondayOf = (date: string) => dayKey(startOfWeek(new Date(`${date}T12:00`)));
const plusDays = (date: string, n: number) => dayKey(addDays(new Date(`${date}T12:00`), n));

/** One calendar week. Days before `firstDay` (when you started recording) and from `today` on don't count as missing. */
export function weekOf(d: Data, monday: string, now = Date.now(), firstDay = firstRecord(d)): Week {
  const today = dayKey(now);
  const byDate = new Map(d.workdays.map((w) => [w.date, w]));
  const week: Week = { monday, worked: 0, target: 0, recorded: false, daysOff: [], missing: [] };
  for (let i = 0; i < 7; i++) {
    const date = plusDays(monday, i);
    const scheduled = hoursToMs(targetHoursOn(d, date));
    const w = byDate.get(date);
    if (w) week.recorded = true;
    if (w?.off && w.offKind !== 'overtime') {
      week.daysOff.push({ date, reason: w.offReason, source: w.offSource, hours: scheduled });
      continue;
    }
    if (w?.off) {
      // Overtime off: the target stays and nothing is worked, as in the balance.
      week.target += scheduled;
      continue;
    }
    if (w) {
      // A past day still open (forgot to clock out) waits until it's fixed; today counts up to now.
      if (!w.end && date < today) continue;
      week.worked += Math.max(0, workdayMs(w, now));
      week.target += scheduled;
      continue;
    }
    if (!firstDay || date < firstDay || scheduled <= 0) continue;
    week.target += scheduled;
    if (date < today) week.missing.push(date);
  }
  return week;
}

/** The first day with any record: before it, nothing counts as missing. */
export function firstRecord(d: Data): string | undefined {
  let first: string | undefined;
  for (const w of d.workdays) if (!first || w.date < first) first = w.date;
  return first;
}

/** A week counts toward the average when something was recorded and it had a target at all. */
export const counts = (w: Week) => w.recorded && w.target > 0;

export type Rolling = { pct: number; avgPerWeek: number; basis: number; zone: Zone };

/** The rolling average over the given weeks (gaps left out): deviation in % of the target, and per week. */
export function rollingOf(weeks: Week[], r: CorridorRules): Rolling | null {
  const used = weeks.filter(counts);
  if (!used.length) return null;
  const dev = used.reduce((s, w) => s + w.worked - w.target, 0);
  const target = used.reduce((s, w) => s + w.target, 0);
  const pct = (dev / target) * 100;
  return { pct, avgPerWeek: dev / used.length, basis: used.length, zone: zoneOf(pct, r) };
}

export type Corridor = {
  rules: CorridorRules;
  /** The current, unfinished week: its own tile, never in the average. */
  current: Week;
  /** The last `rules.weeks` finished weeks, oldest first. */
  window: Week[];
  rolling: Rolling | null;
  /** The chart: the rolling value at the end of each finished week (null where that week has no data), oldest first. */
  points: { monday: string; pct: number | null; zone: Zone | null }[];
  /** What to ask about: past scheduled days without a record, and finished weeks with nothing at all, in the window. */
  ask: { days: string[]; weeks: string[] };
  /** Days off in the window and this week, by where they came from (the header line). */
  daysOff: { float: number; personio: number; manual: number };
};

/** Everything the corridor view needs. `chartWeeks`: how many finished weeks the chart shows. */
export function corridorOf(d: Data, now = Date.now(), chartWeeks = 52): Corridor {
  const rules = rulesOf(d.settings.companyHours);
  const first = firstRecord(d);
  const thisMonday = mondayOf(dayKey(now));
  const current = weekOf(d, thisMonday, now, first);
  const span = chartWeeks + rules.weeks - 1;
  const finished = Array.from({ length: span }, (_, i) => weekOf(d, plusDays(thisMonday, -7 * (span - i)), now, first));
  const window = finished.slice(-rules.weeks);
  const points = finished.slice(rules.weeks - 1).map((w, i) => {
    const r = counts(w) ? rollingOf(finished.slice(i, i + rules.weeks), rules) : null;
    return { monday: w.monday, pct: r ? r.pct : null, zone: r ? r.zone : null };
  });
  // Before the first record there's nothing to ask about (a new user's past isn't missing).
  const askWeeks = window.filter((w) => !w.recorded && first && w.monday >= mondayOf(first) && weekTarget(d, w.monday) > 0).map((w) => w.monday);
  const daysOff = { float: 0, personio: 0, manual: 0 };
  for (const w of [...window, current]) for (const o of w.daysOff) daysOff[o.source ?? 'manual']++;
  return {
    rules,
    current,
    window,
    rolling: rollingOf(window, rules),
    points,
    // This week's empty days are asked about too (yesterday is the likeliest one to forget).
    ask: { days: [...window.flatMap((w) => (w.recorded ? w.missing : [])), ...current.missing], weeks: askWeeks },
    daysOff,
  };
}

/** The schedule's hours for a whole week, before days off. */
export function weekTarget(d: Data, monday: string): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += hoursToMs(targetHoursOn(d, plusDays(monday, i)));
  return sum;
}
