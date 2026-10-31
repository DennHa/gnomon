// A day as it happened: the clocked span with its breaks, and the bookings as blocks at their real times. It's the Week's
// data, seen by the clock: dragging a block or its edge changes the entry; a click opens its exact times.
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { updateEntry } from '../actions';
import { TimeField } from '../components';
import { overlapMs, overlapSpans } from '../daycheck';
import { Icon } from '../icons';
import { useStore } from '../store';
import { atTime, dayKey, entryMs, fmtHM, fmtTime, useNow, workdayMs } from '../time';
import { t } from '../i18n';
import type { Entry } from '../types';

const SNAP = 5 * 60_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const LANE = 42;
const TOP = 26;

type Drag = { id: string; start: string; end: string };

/** Each block on the first lane where it doesn't touch another, so overlaps sit visibly below each other. */
function lanes(list: { id: string; a: number; b: number }[]): Map<string, number> {
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

export function DayTimeline({ day, readOnly }: { day: string; readOnly: boolean }) {
  const { data, update } = useStore();
  const now = useNow(60_000);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (selected) editRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const wd = data.workdays.find((w) => w.date === day);
  const stored = data.entries.filter((e) => dayKey(e.start) === day);
  if (!stored.length && (!wd || wd.off)) return null;
  const entries: Entry[] = stored.map((e) => (e.id === drag?.id ? { ...e, ...drag } : e));

  const dayStart = Date.parse(atTime(day, '00:00'));
  const dayEnd = dayStart + 24 * HOUR;
  const last = Date.parse(atTime(day, '23:59'));
  const clocked = wd && !wd.off ? wd : undefined;
  const clockEnd = clocked ? (clocked.end ? Date.parse(clocked.end) : Math.min(now, dayEnd)) : 0;
  const endOf = (e: Entry) => (e.end ? Date.parse(e.end) : Math.min(now, dayEnd));

  // The range fits what's there (from what's stored, so it doesn't jump during a drag), at least 07:00 to 19:00.
  const times = [...stored.flatMap((e) => [Date.parse(e.start), endOf(e)]), ...(clocked ? [Date.parse(clocked.start), clockEnd] : [])];
  const lo = Math.max(dayStart, Math.floor((Math.min(dayStart + 7 * HOUR, ...times) - dayStart) / HOUR) * HOUR + dayStart);
  const hi = Math.min(dayEnd, Math.ceil((Math.max(dayStart + 19 * HOUR, ...times) - dayStart) / HOUR) * HOUR + dayStart);
  const x = (ms: number) => ((Math.max(lo, Math.min(hi, ms)) - lo) / (hi - lo)) * 100;
  const hours = Array.from({ length: (hi - lo) / HOUR + 1 }, (_, i) => lo + i * HOUR).filter((_, i) => i % 2 === 0);

  const blocks = entries.map((e) => ({ id: e.id, a: Date.parse(e.start), b: endOf(e) }));
  const laneOf = lanes(blocks);
  const laneCount = Math.max(1, ...[...laneOf.values()].map((l) => l + 1));
  const overlaps = overlapSpans(entries, now);
  const height = TOP + laneCount * LANE + 20;

  const booked = entries.reduce((s, e) => s + entryMs(e, now), 0);
  const worked = clocked ? workdayMs(clocked, now) : 0;
  const unassigned = worked - booked;
  const overlap = overlapMs(entries, now);

  const nameOf = (e: Entry) => {
    const p = data.projects.find((x) => x.id === e.projectId);
    return [e.description || e.taskName, p?.name].filter(Boolean).join(' · ') || t('untitled');
  };
  const snap = (ms: number) => dayStart + Math.round((ms - dayStart) / SNAP) * SNAP;
  const iso = (ms: number) => new Date(ms).toISOString();
  /** The times after moving by `ms`, or moving one edge; kept inside the day and at least one snap long. */
  const moved = (e: Entry, mode: 'move' | 'start' | 'end', ms: number): Drag => {
    const a = Date.parse(e.start);
    const b = Date.parse(e.end!);
    if (mode === 'start') return { id: e.id, start: iso(Math.max(dayStart, Math.min(b - SNAP, snap(a + ms)))), end: e.end! };
    if (mode === 'end') return { id: e.id, start: e.start, end: iso(Math.min(last, Math.max(a + SNAP, snap(b + ms)))) };
    const at = Math.max(dayStart, Math.min(last - (b - a), snap(a + ms)));
    return { id: e.id, start: iso(at), end: iso(at + b - a) };
  };
  const save = (d: Drag) => update((x) => updateEntry(x, d.id, { start: d.start, end: d.end }));

  const begin = (ev: ReactPointerEvent, e: Entry, mode: 'move' | 'start' | 'end') => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    if (readOnly || !e.end) return setSelected(e.id);
    ev.preventDefault();
    const perPx = (hi - lo) / trackRef.current!.getBoundingClientRect().width;
    const x0 = ev.clientX;
    let next: Drag | null = null;
    const move = (m: PointerEvent) => {
      if (!next && Math.abs(m.clientX - x0) < 3) return;
      next = moved(e, mode, (m.clientX - x0) * perPx);
      setDrag(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (next) save(next);
      else setSelected(e.id);
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const chosen = entries.find((e) => e.id === selected);

  return (
    <div className="timeline">
      <div className="tl-scroll">
        <div className="tl-track" ref={trackRef} style={{ height }} onPointerDown={() => setSelected(null)}>
          {hours.map((h) => (
            <span key={h} className="tl-hour" style={{ left: `${x(h)}%` }}>
              <span>{fmtTime(h)}</span>
            </span>
          ))}
          {clocked && (
            <div className="tl-clocked" style={{ left: `${x(Date.parse(clocked.start))}%`, width: `${x(clockEnd) - x(Date.parse(clocked.start))}%` }}>
              {t('tl.clocked', { from: fmtTime(clocked.start), to: clocked.end ? fmtTime(clocked.end) : t('now') })}
            </div>
          )}
          {clocked?.breaks.map((b) => (
            <div key={b.start} className="tl-break" style={{ left: `${x(Date.parse(b.start))}%`, width: `${x(b.end ? Date.parse(b.end) : now) - x(Date.parse(b.start))}%` }} title={t('break')}>
              <Icon name="coffee" size={13} />
            </div>
          ))}
          {overlaps.map(([a, b]) => (
            <div key={a} className="tl-overlap" style={{ left: `${x(a)}%`, width: `${x(b) - x(a)}%`, top: TOP, height: laneCount * LANE }} title={t('tl.overlap', { time: fmtHM(b - a) })} />
          ))}
          {day === dayKey(now) && <div className="tl-now" style={{ left: `${x(now)}%` }} />}
          {entries.map((e) => {
            const a = Date.parse(e.start);
            const color = data.projects.find((p) => p.id === e.projectId)?.color ?? '#B0BEC5';
            const fixed = readOnly || !e.end;
            return (
              <div
                key={e.id}
                role="button"
                tabIndex={0}
                aria-label={`${nameOf(e)}, ${fmtTime(a)}–${e.end ? fmtTime(e.end) : t('now')}`}
                className={`tl-block ${fixed ? 'fixed' : ''} ${e.id === selected ? 'sel' : ''} ${e.id === drag?.id ? 'dragging' : ''}`}
                style={{ left: `${x(a)}%`, width: `${x(endOf(e)) - x(a)}%`, top: TOP + laneOf.get(e.id)! * LANE, borderColor: color, background: `color-mix(in srgb, ${color} 18%, var(--surface))` }}
                title={`${nameOf(e)}\n${fmtTime(a)}–${e.end ? fmtTime(e.end) : t('now')} · ${fmtHM(entryMs(e, now))}`}
                onPointerDown={(ev) => begin(ev, e, 'move')}
                onKeyDown={(ev) => {
                  const dir = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0;
                  if (ev.key === 'Enter') setSelected(e.id);
                  if (!dir || fixed) return;
                  ev.preventDefault();
                  save(moved(e, ev.shiftKey ? 'end' : 'move', dir * SNAP));
                }}
              >
                {!fixed && <i className="tl-edge start" onPointerDown={(ev) => begin(ev, e, 'start')} />}
                <span className="tl-name">{nameOf(e)}</span>
                <span className="tl-time muted">
                  {fmtTime(a)}–{e.end ? fmtTime(e.end) : t('now')}
                </span>
                {!fixed && <i className="tl-edge end" onPointerDown={(ev) => begin(ev, e, 'end')} />}
              </div>
            );
          })}
        </div>
      </div>
      {chosen && (
        <div className="tl-edit" ref={editRef}>
          <span className="dot" style={{ background: data.projects.find((p) => p.id === chosen.projectId)?.color ?? '#B0BEC5' }} />
          <span className="tl-edit-name">{nameOf(chosen)}</span>
          {readOnly || !chosen.end ? (
            <span className="muted">
              {fmtTime(chosen.start)}–{chosen.end ? fmtTime(chosen.end) : t('now')}
            </span>
          ) : (
            <span className="feed-times">
              <TimeField value={chosen.start} day={day} onChange={(start) => update((d) => updateEntry(d, chosen.id, { start }))} />
              <span className="muted">–</span>
              <TimeField value={chosen.end} day={day} onChange={(end) => update((d) => updateEntry(d, chosen.id, { end }))} />
            </span>
          )}
          <strong>{fmtHM(entryMs(chosen, now))}</strong>
          <button className="icon-btn" aria-label={t('close')} onClick={() => setSelected(null)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      <div className="tl-totals">
        {clocked && !clocked.fromEntries && (
          <span>
            {t('review.clockedIn')} <strong>{fmtHM(worked)}</strong>
          </span>
        )}
        <span>
          {t('review.booked')} <strong>{fmtHM(booked)}</strong>
        </span>
        {overlap >= MIN && <span className="tl-tag">{t('tl.overlap', { time: fmtHM(overlap) })}</span>}
        <span className="spacer" />
        {!readOnly && entries.some((e) => e.end) && <span className="muted small">{t('tl.hint')}</span>}
      </div>
      {clocked && !clocked.fromEntries && (
        <p className="muted small tl-hintline">
          {unassigned >= 5 * MIN ? t('review.notAssigned', { duration: fmtHM(unassigned) }) : unassigned <= -5 * MIN ? t('review.overBooked', { duration: fmtHM(-unassigned) }) : t('review.allAssigned')}
        </p>
      )}
    </div>
  );
}
