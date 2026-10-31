// The arithmetic of the day timeline (src/views/Timeline.tsx): what a drag does to a block, a break or a clock handle.
import { atTime } from './time';
import type { Workday } from './types';

export const SNAP = 5 * 60_000;

export type Span = { start: string; end: string };
export type DragMode = 'move' | 'start' | 'end';

const iso = (ms: number) => new Date(ms).toISOString();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dayFrom = (day: string) => Date.parse(atTime(day, '00:00'));
const dayLast = (day: string) => Date.parse(atTime(day, '23:59'));
const snapper = (day: string) => (ms: number) => dayFrom(day) + Math.round((ms - dayFrom(day)) / SNAP) * SNAP;

/** A block moved by `ms`, or one of its edges, snapped to 5 minutes, inside lo..hi (default: the day), at least 5 minutes long. */
export function moveSpan(s: Span, mode: DragMode, ms: number, day: string, lo = dayFrom(day), hi = dayLast(day)): Span {
  const snap = snapper(day);
  const a = Date.parse(s.start);
  const b = Date.parse(s.end);
  if (mode === 'start') return { start: iso(clamp(snap(a + ms), lo, b - SNAP)), end: s.end };
  if (mode === 'end') return { start: s.start, end: iso(clamp(snap(b + ms), a + SNAP, hi)) };
  const at = clamp(snap(a + ms), lo, hi - (b - a));
  return { start: iso(at), end: iso(at + b - a) };
}

/** A clock handle moved by `ms`: arrival stays before leaving and leaving after arrival. Bookings never move with it. */
export function moveClock(wd: Workday, edge: 'in' | 'out', ms: number, day: string, now = Date.now()): string {
  const snap = snapper(day);
  const a = Date.parse(wd.start);
  if (edge === 'in') return iso(clamp(snap(a + ms), dayFrom(day), (wd.end ? Date.parse(wd.end) : now) - SNAP));
  return iso(clamp(snap(Date.parse(wd.end!) + ms), a + SNAP, dayLast(day)));
}

/** Each block on the first lane where it doesn't touch another, so overlaps sit visibly below each other. */
export function lanes(list: { id: string; a: number; b: number }[]): Map<string, number> {
  const ends: number[] = [];
  const out = new Map<string, number>();
  for (const x of [...list].sort((p, q) => p.a - q.a)) {
    let lane = ends.findIndex((e) => e <= x.a);
    if (lane < 0) lane = ends.length;
    ends[lane] = x.b;
    out.set(x.id, lane);
  }
  return out;
}
