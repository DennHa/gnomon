import { locale } from './i18n';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(d: Date | string | number = new Date()): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00`);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
export const mondayOf = (key: string) => addDays(key, -((new Date(`${key}T12:00`).getDay() + 6) % 7));

export const entryMs = (e: { start: string; end: string | null }, now = Date.now()) => (e.end ? Date.parse(e.end) : now) - Date.parse(e.start);

/** 1:05:09 */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
/** 7:05 */
export function fmtHM(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
export const fmtDay = (key: string, o: Intl.DateTimeFormatOptions) => new Date(`${key}T12:00`).toLocaleDateString(locale, o);
/** "HH:MM" for <input type="time">. */
export const toTimeInput = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const atTime = (day: string, hhmm: string) => new Date(`${day}T${hhmm}`).toISOString();

/** What people type as a duration: "2", "1.5", "1,5", "1:30", "1h 30m", "90m". Returns minutes, or null. */
export function parseMinutes(input: string): number | null {
  const s = input.trim().toLowerCase().replace(',', '.');
  let m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/);
  if (m && (m[1] || m[2])) return Math.round(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0));
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 60);
  return null;
}
