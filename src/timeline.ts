// The arithmetic of the day timeline (src/views/Timeline.tsx): what a drag does to a block, a break or a clock handle.
import { atTime } from './time';
import type { Workday } from './types';

export const SNAP = 5 * 60_000;

export type Span = { start: string; end: string };
export type DragMode = 'move' | 'start' | 'end';

/** Within this of the usual time, a dragged handle or break settles on it. Arrow keys and typed times stay exact. */
const LEAN = 7 * 60_000;
const leaned = (ms: number, usual?: number) => (usual !== undefined && Math.abs(ms - usual) <= LEAN ? usual : ms);

const iso = (ms: number) => new Date(ms).toISOString();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dayFrom = (day: string) => Date.parse(atTime(day, '00:00'));
const dayLast = (day: string) => Date.parse(atTime(day, '23:59'));
const snapper = (day: string) => (ms: number) => dayFrom(day) + Math.round((ms - dayFrom(day)) / SNAP) * SNAP;

/** A block moved by `ms`, or one of its edges, snapped to 5 minutes, inside lo..hi (default: the day), at least 5 minutes long. */
export function moveSpan(s: Span, mode: DragMode, ms: number, day: string, lo = dayFrom(day), hi = dayLast(day), usual?: number): Span {
  const snap = snapper(day);
  const a = Date.parse(s.start);
  const b = Date.parse(s.end);
  if (mode === 'start') return { start: iso(clamp(snap(a + ms), lo, b - SNAP)), end: s.end };
  if (mode === 'end') return { start: s.start, end: iso(clamp(snap(b + ms), a + SNAP, hi)) };
  const at = clamp(leaned(snap(a + ms), usual), lo, hi - (b - a));
  return { start: iso(at), end: iso(at + b - a) };
}

/** Where a time label beside a clock handle sits, in px from the track's left: `end` means its text ends there. */
export type ClockSpot = { x: number; end: boolean };

const BESIDE = 9; // half a handle, plus air
const BETWEEN = 6;
const charPx = 6;

/**
 * The labels of the clock handles: outside the rail, so a short day can't make them collide; at an edge of the track they
 * turn inside it; and where the rail is too short for that they line up in reading order past the other handle.
 * `fits` is false when they'd leave the track or run into each other. `inX`/`outX` are px; no `out` while the day is running.
 */
export function clockSpots(width: number, inX: number, inText: string, outX?: number, outText?: string): { in: ClockSpot; out?: ClockSpot; fits: boolean } {
  const inW = inText.length * charPx;
  const fitsLeft = inX - BESIDE - inW >= 0;
  if (outX === undefined || outText === undefined) {
    return { in: fitsLeft ? { x: inX - BESIDE, end: true } : { x: inX + BESIDE, end: false }, fits: true };
  }
  const outW = outText.length * charPx;
  const fitsRight = outX + BESIDE + outW <= width;
  const rail = outX - inX - 2 * BESIDE;
  if (fitsLeft && fitsRight) return { in: { x: inX - BESIDE, end: true }, out: { x: outX + BESIDE, end: false }, fits: true };
  if (fitsLeft) {
    if (outW <= rail) return { in: { x: inX - BESIDE, end: true }, out: { x: outX - BESIDE, end: true }, fits: true };
    const x = inX - BESIDE - outW - BETWEEN;
    return { in: { x, end: true }, out: { x: inX - BESIDE, end: true }, fits: x - inW >= 0 };
  }
  if (fitsRight) {
    if (inW <= rail) return { in: { x: inX + BESIDE, end: false }, out: { x: outX + BESIDE, end: false }, fits: true };
    const x = outX + BESIDE + inW + BETWEEN;
    return { in: { x: outX + BESIDE, end: false }, out: { x, end: false }, fits: x + outW <= width };
  }
  return { in: { x: inX + BESIDE, end: false }, out: { x: outX - BESIDE, end: true }, fits: inW + outW + BETWEEN <= rail };
}

/**
 * A clock handle moved by `ms`: arrival stays before leaving and leaving after arrival, and it leans toward `usual`.
 * Bookings never move with it.
 */
export function moveClock(wd: Workday, edge: 'in' | 'out', ms: number, day: string, now = Date.now(), usual?: number): string {
  const snap = snapper(day);
  const a = Date.parse(wd.start);
  if (edge === 'in') return iso(clamp(leaned(snap(a + ms), usual), dayFrom(day), (wd.end ? Date.parse(wd.end) : now) - SNAP));
  return iso(clamp(leaned(snap(Date.parse(wd.end!) + ms), usual), a + SNAP, dayLast(day)));
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
