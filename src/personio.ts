// Read-only import from Personio (API v2, https://developer.personio.de): your approved absences (vacation,
// sick days, …) become days off, so the overtime balance stays right. Nothing is written back to Personio.
// Requests go through the main process (window.api.personioGet), which holds the credentials and the token.
//
// Half days and hourly absences are not imported as days off: Gnomon has no half day off, and marking the whole
// day off would hide the half you worked. They're counted in the sync message so you can enter them yourself.
import type { Data, Workday } from './types';
import { addDays, atTime, dayKey } from './time';
import { t } from './i18n';

/** Same window as the Float import: recent weeks stay right, upcoming months show what's next. */
const PAST_DAYS = 31;
const FUTURE_DAYS = 90;

type Half = 'FIRST_HALF' | 'SECOND_HALF' | null;
export type PersonioPeriod = {
  id: string;
  person?: { id: string };
  /** Local time without offset, e.g. "2026-10-19T00:00:00". */
  starts_from: { date_time: string; type?: Half };
  /** null while the absence has no end yet. */
  ends_at: { date_time: string; type?: Half } | null;
  absence_type: { id: string };
  approval?: { status: 'PENDING' | 'APPROVED' | 'DELETION_PENDING' | 'SUBSTITUTE_REQUESTED' | string };
  comment?: string | null;
};
export type PersonioAbsenceType = { id: string; name: string; category?: string; unit?: 'DAY' | 'HOUR' };
export type PersonioBreakdown = { date: string; effective_duration: { value: number; unit: 'DAY' | 'MINUTE' } };
type PersonioPerson = { id: string | number; email?: string | null; first_name?: string | null; last_name?: string | null; preferred_name?: string | null; status?: string };

export type PersonioImport = {
  daysOff: { date: string; reason: string }[];
  /** Half days and hourly absences: not imported, shown in the sync message. */
  partial: { date: string; reason: string }[];
  range: { from: string; to: string };
};

/** Approved absences count; so do ones waiting for deletion (still approved until Personio removes them). */
const COUNTS = new Set(['APPROVED', 'DELETION_PENDING']);

function errorText(error: string, status: number): string {
  if (error === 'bad_credentials' || error === 'no_credentials') return t('personio.badCredentials');
  if (error === 'forbidden' || status === 403) return t('personio.forbidden');
  return `Personio ${status || ''}: ${error}`.replace('  ', ' ');
}

async function getAll<T>(path: string, query: Record<string, string | number> = {}, limit = 100): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  // Cursor pagination: follow `_meta.links.next` until there is none (capped as a safety net).
  for (let page = 0; page < 100; page++) {
    const r = await window.api.personioGet(path, { ...query, limit, ...(cursor ? { cursor } : {}) });
    if (!r.ok) throw new Error(errorText(r.error, r.status));
    out.push(...(r.data as T[]));
    if (!r.next || r.next === cursor) return out;
    cursor = r.next;
  }
  return out;
}

const personName = (p: PersonioPerson) => [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || String(p.id);

/** The Personio person with this email, or null. Needs the personio:persons:read scope. */
export async function findPerson(email: string): Promise<{ id: string; name: string } | null> {
  const people = await getAll<PersonioPerson>('/v2/persons', { email: email.trim() }, 50);
  const match = people.find((p) => p.email?.toLowerCase() === email.trim().toLowerCase()) ?? people[0];
  return match ? { id: String(match.id), name: personName(match) } : null;
}

const isWeekday = (date: string) => {
  const day = new Date(`${date}T12:00`).getDay();
  return day !== 0 && day !== 6;
};

/**
 * The days of a period from its start and end alone (used for ongoing absences and when breakdowns can't be read).
 * An end at 00:00 on a later day is exclusive: "Dec 31 00:00 → Jan 1 00:00" is just Dec 31.
 */
export function periodDays(p: PersonioPeriod, range: { from: string; to: string }): { date: string; half: boolean }[] {
  const first = p.starts_from.date_time.slice(0, 10);
  let last = p.ends_at ? p.ends_at.date_time.slice(0, 10) : range.to;
  if (p.ends_at && last > first && /T00:00(:00(\.0+)?)?$/.test(p.ends_at.date_time)) last = dayKey(addDays(new Date(`${last}T12:00`), -1));
  const out = [];
  for (let d = new Date(`${first}T12:00`); dayKey(d) <= last; d = addDays(d, 1)) {
    const date = dayKey(d);
    if (date < range.from || date > range.to || !isWeekday(date)) continue;
    const half = (date === first && Boolean(p.starts_from.type)) || (date === last && Boolean(p.ends_at?.type));
    out.push({ date, half });
  }
  return out;
}

/**
 * Turns absence periods into whole days off and partial days. Breakdowns (Personio's own per-day amounts, which
 * already skip weekends and public holidays) are used when present; otherwise the start and end dates.
 */
export function mapPersonioAbsences(
  periods: PersonioPeriod[],
  types: PersonioAbsenceType[],
  breakdowns: Map<string, PersonioBreakdown[]>,
  range: { from: string; to: string },
  dailyTargetHours: number,
): PersonioImport {
  const typeById = new Map(types.map((x) => [String(x.id), x]));
  const fullDayMinutes = dailyTargetHours > 0 ? dailyTargetHours * 60 : 8 * 60;
  const full = new Map<string, string>();
  const partial = new Map<string, string>();

  for (const p of periods) {
    if (p.approval && !COUNTS.has(p.approval.status)) continue;
    const type = typeById.get(String(p.absence_type?.id));
    const reason = type?.name?.trim() || t('personio.absence');
    const days = breakdowns.get(p.id);
    if (days) {
      for (const b of days) {
        const v = b.effective_duration?.value ?? 0;
        if (v <= 0 || b.date < range.from || b.date > range.to) continue;
        const whole = b.effective_duration.unit === 'DAY' ? v >= 1 : v >= fullDayMinutes;
        (whole ? full : partial).set(b.date, reason);
      }
    } else {
      for (const { date, half } of periodDays(p, range)) (half || type?.unit === 'HOUR' ? partial : full).set(date, reason);
    }
  }
  for (const date of full.keys()) partial.delete(date);
  const list = (m: Map<string, string>) => [...m].sort(([a], [b]) => a.localeCompare(b)).map(([date, reason]) => ({ date, reason }));
  return { daysOff: list(full), partial: list(partial), range };
}

export async function fetchPersonioAbsences(personId: string, dailyTargetHours: number): Promise<PersonioImport> {
  const range = { from: dayKey(addDays(new Date(), -PAST_DAYS)), to: dayKey(addDays(new Date(), FUTURE_DAYS)) };
  // Date-range filters match periods overlapping the window (per the API reference).
  const periods = await getAll<PersonioPeriod>('/v2/absence-periods', {
    'person.id': personId,
    'starts_from.date_time.lte': `${range.to}T23:59:59`,
    'ends_at.date_time.gte': `${range.from}T00:00:00`,
  });
  const mine = periods.filter((p) => !p.person || String(p.person.id) === personId);

  // Names like "Vacation" or "Sick leave"; without them the days still import with a generic reason.
  const types = await getAll<PersonioAbsenceType>('/v2/absence-types').catch(() => []);

  // Per-day amounts for finished periods (an ongoing one only has breakdowns up to today). One request each, in
  // sequence, to stay well inside the rate limit; if one fails, that period falls back to its dates.
  const breakdowns = new Map<string, PersonioBreakdown[]>();
  for (const p of mine) {
    if (!p.ends_at || (p.approval && !COUNTS.has(p.approval.status))) continue;
    try {
      breakdowns.set(p.id, await getAll<PersonioBreakdown>(`/v2/absence-periods/${encodeURIComponent(p.id)}/breakdowns`, {}, 28));
    } catch {
      /* use the period's dates */
    }
  }
  return mapPersonioAbsences(mine, types, breakdowns, range, dailyTargetHours);
}

/** Merge an import into the latest local state: like Float, only Personio's own days off are updated or removed. */
export function applyPersonioImport(d: Data, imp: PersonioImport): Data {
  const off = new Map(imp.daysOff.map((x) => [x.date, x.reason]));
  const inRange = (date: string) => date >= imp.range.from && date <= imp.range.to;
  const workdays: Workday[] = d.workdays.filter((w) => !(w.offSource === 'personio' && inRange(w.date) && !off.has(w.date)));
  for (const [date, reason] of off) {
    const i = workdays.findIndex((w) => w.date === date);
    if (i >= 0) {
      // Personio is the system of record for absences, so it takes over a day Float marked as time off.
      if (workdays[i].offSource === 'personio' || workdays[i].offSource === 'float') workdays[i] = { ...workdays[i], offReason: reason, offSource: 'personio' };
      continue;
    }
    const at = atTime(date, '00:00');
    workdays.push({ date, start: at, end: at, breaks: [], off: true, offReason: reason, offSource: 'personio' });
  }
  return { ...d, workdays, settings: { ...d.settings, personioLastSync: new Date().toISOString() } };
}
