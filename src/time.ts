import { useEffect, useState } from 'react';
import type { Entry, Workday } from './types';
import { locale, t } from './i18n';

const HOUR = 3_600_000;
const pad = (n: number) => String(n).padStart(2, '0');

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(d: Date | string | number): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Monday of the week containing d. */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() + 6) % 7));
}

/** 1:05:09 */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 7h 05m */
export function fmtDuration(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60_000);
  return `${ms < 0 ? '−' : ''}${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

/** 2:05, for compact table cells. */
export function fmtHM(ms: number): string {
  const m = Math.round(ms / 60_000);
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

/** Parses what people type into a timesheet: "2", "2.5", "2,5", "2:30", "2h 30m", "90m". Empty means 0. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(',', '.');
  if (!s) return 0;
  let m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) return (Number(m[1]) * 60 + Number(m[2])) * 60_000;
  m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/);
  if (m && (m[1] || m[2])) return Math.round((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60_000);
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 3_600_000);
  return null;
}

export const fmtHours = (ms: number) => (ms / HOUR).toFixed(2);

export function fmtTime(iso: string | number): string {
  return new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
}

export function fmtDayLabel(key: string, today = dayKey(new Date())): string {
  if (key === today) return t('today');
  if (key === dayKey(addDays(new Date(), -1))) return t('yesterday');
  return new Date(`${key}T00:00`).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmtDayLong(key: string): string {
  return new Date(`${key}T00:00`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Locale-aware toLocaleDateString for a YYYY-MM-DD day. */
export function fmtDate(key: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${key}T12:00`).toLocaleDateString(locale(), opts);
}

/** "HH:MM" for <input type="time">. */
export function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Combine a local day and "HH:MM" into an ISO timestamp. */
export function atTime(day: string, hhmm: string): string {
  return new Date(`${day}T${hhmm}`).toISOString();
}

export const entryMs = (e: Entry, now = Date.now()) => (e.end ? Date.parse(e.end) : now) - Date.parse(e.start);

/** Break time inside the workday: overlapping breaks count once, and nothing before arrival or after leaving counts. */
export function breakMs(w: Workday, now = Date.now()): number {
  const from = Date.parse(w.start);
  const until = w.end ? Date.parse(w.end) : now;
  const spans = w.breaks
    .map((b) => [Math.max(from, Date.parse(b.start)), Math.min(until, b.end ? Date.parse(b.end) : now)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let sum = 0;
  let at = -Infinity;
  for (const [a, b] of spans) {
    if (b <= at) continue;
    sum += b - Math.max(a, at);
    at = b;
  }
  return sum;
}

/** Time at work minus breaks. */
export function workdayMs(w: Workday, now = Date.now()): number {
  return (w.end ? Date.parse(w.end) : now) - Date.parse(w.start) - breakMs(w, now);
}

export const hoursToMs = (h: number) => h * HOUR;

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
