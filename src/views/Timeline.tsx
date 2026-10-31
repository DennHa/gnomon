// One day, the one place to change it: the clocked rail with its handles and breaks, and the bookings as blocks at their
// real times, over the list of what the timeline can't show (project, description, activity, duration). Both read the same
// state, including a drag in progress, and share the selection. Clock times stay apart from bookings: moving a handle never
// moves an entry (src/fit.ts), except that correcting a midnight-closed day cuts the timer midnight stopped (src/actions.ts).
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { addBreak, deleteWorkday, markDayOff, removeBreak, updateBreak, updateEntry, updateWorkday } from '../actions';
import { TimeField } from '../components';
import { overlapMs, overlapSpans } from '../daycheck';
import { EntryFeed } from '../feed';
import { Icon } from '../icons';
import { useLeaveEdit } from '../notes';
import { useStore } from '../store';
import { lanes, moveClock, moveSpan, SNAP, type DragMode, type Span } from '../timeline';
import { atTime, dayKey, entryMs, fmtHM, fmtTime, useNow, workdayMs } from '../time';
import { t } from '../i18n';
import type { Entry, Workday } from '../types';
import { DayStatus } from './day';

const MIN = 60_000;
const HOUR = 60 * MIN;
const LANE = 42;
const TOP = 30;

/** What's being dragged, shown everywhere before it's saved. Keys: "in", "out", "b:<break index>", "e:<entry id>". */
type Drag = { key: string; start?: string; end?: string };

/** Something on the timeline that can be selected, and moved unless it's `fixed`. */
type Item = { key: string; fixed: boolean; preview: (mode: DragMode, ms: number) => Drag; save: (d: Drag) => void };

const nameOf = (e: Entry, project?: string) => [e.description || e.taskName, project].filter(Boolean).join(' · ') || t('untitled');

/** A day's timeline, summary and list. `drag` overlays both until the drop, so they never disagree. */
export function DayPanel({ day, readOnly }: { day: string; readOnly: boolean }) {
  const { data, update } = useStore();
  const leaveEdit = useLeaveEdit();
  const now = useNow(60_000);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Picked on the timeline: the exact times open. Picked in the list: only the block lights up, so the list stays put.
  const [editing, setEditing] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => (setSelected(null), setDrag(null)), [day]);

  const storedDay = data.workdays.find((w) => w.date === day);
  const stored = data.entries.filter((e) => dayKey(e.start) === day);
  const entries: Entry[] = stored
    .map((e) => (drag?.key === `e:${e.id}` ? { ...e, ...drag } : e))
    .sort((a, b) => a.start.localeCompare(b.start));
  const wd: Workday | undefined = storedDay && {
    ...storedDay,
    ...(drag?.key === 'in' && { start: drag.start }),
    ...(drag?.key === 'out' && { end: drag.end }),
    breaks: storedDay.breaks.map((b, i) => (drag?.key === `b:${i}` ? { ...b, ...drag } : b)),
  } as Workday;
  const clocked = wd && !wd.off ? wd : undefined;
  const hasTimeline = stored.length > 0 || clocked;

  const dayStart = Date.parse(atTime(day, '00:00'));
  const dayEnd = dayStart + 24 * HOUR;
  const nowInDay = Math.min(now, dayEnd);
  const clockEnd = clocked ? (clocked.end ? Date.parse(clocked.end) : nowInDay) : 0;
  const endOf = (e: Entry) => (e.end ? Date.parse(e.end) : nowInDay);

  // The range fits what's stored (so it doesn't jump during a drag), at least 07:00 to 19:00.
  const fixedEnd = storedDay && !storedDay.off ? (storedDay.end ? Date.parse(storedDay.end) : nowInDay) : 0;
  const times = [...stored.flatMap((e) => [Date.parse(e.start), endOf(e)]), ...(storedDay && !storedDay.off ? [Date.parse(storedDay.start), fixedEnd] : [])];
  const lo = Math.max(dayStart, Math.floor((Math.min(dayStart + 7 * HOUR, ...times) - dayStart) / HOUR) * HOUR + dayStart);
  const hi = Math.min(dayEnd, Math.ceil((Math.max(dayStart + 19 * HOUR, ...times) - dayStart) / HOUR) * HOUR + dayStart);
  const x = (ms: number) => ((Math.max(lo, Math.min(hi, ms)) - lo) / (hi - lo)) * 100;
  const hours = Array.from({ length: (hi - lo) / HOUR + 1 }, (_, i) => lo + i * HOUR).filter((_, i) => i % 2 === 0);

  const laneOf = lanes(entries.map((e) => ({ id: e.id, a: Date.parse(e.start), b: endOf(e) })));
  const laneCount = Math.max(1, ...[...laneOf.values()].map((l) => l + 1));
  const overlaps = overlapSpans(entries, now);
  const height = TOP + laneCount * LANE + 20;

  const booked = entries.reduce((s, e) => s + entryMs(e, now), 0);
  const worked = clocked ? workdayMs(clocked, now) : 0;
  const open = worked - booked;
  const overlap = overlapMs(entries, now);

  const project = (e: Entry) => data.projects.find((p) => p.id === e.projectId);

  const entryItem = (e: Entry): Item => ({
    key: `e:${e.id}`,
    fixed: readOnly || !e.end,
    preview: (mode, ms) => ({ key: `e:${e.id}`, ...moveSpan(e as Span, mode, ms, day) }),
    save: (d) => update((x) => updateEntry(x, e.id, { start: d.start, end: d.end })),
  });
  const breakItem = (w: Workday, i: number): Item => ({
    key: `b:${i}`,
    fixed: readOnly || !w.breaks[i].end,
    preview: (mode, ms) => ({ key: `b:${i}`, ...moveSpan(w.breaks[i] as Span, mode, ms, day, Date.parse(w.start), w.end ? Date.parse(w.end) : now) }),
    save: (d) => update((x) => updateBreak(x, day, i, { start: d.start, end: d.end })),
  });
  const inItem = (w: Workday): Item => ({
    key: 'in',
    fixed: readOnly,
    preview: (_m, ms) => ({ key: 'in', start: moveClock(w, 'in', ms, day, now) }),
    save: (d) => update((x) => updateWorkday(x, day, { start: d.start })),
  });
  const outItem = (w: Workday): Item => ({
    key: 'out',
    fixed: readOnly,
    preview: (_m, ms) => ({ key: 'out', end: moveClock(w, 'out', ms, day, now) }),
    save: (d) => leaveEdit(day, (x) => updateWorkday(x, day, { end: d.end })),
  });

  const pick = (key: string) => (setSelected(key), setEditing(true));

  const begin = (ev: ReactPointerEvent, item: Item, mode: DragMode) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    if (item.fixed) return pick(item.key);
    ev.preventDefault();
    const perPx = (hi - lo) / trackRef.current!.getBoundingClientRect().width;
    const x0 = ev.clientX;
    let next: Drag | null = null;
    const move = (m: PointerEvent) => {
      if (!next && Math.abs(m.clientX - x0) < 3) return;
      next = item.preview(mode, (m.clientX - x0) * perPx);
      setSelected(item.key);
      setDrag(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (next) item.save(next);
      else pick(item.key);
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** Keyboard: Enter or Space for exact times, arrows move by 5 minutes, Shift + arrows the end of a block. */
  const keys = (item: Item, resizable: boolean) => (ev: React.KeyboardEvent) => {
    const dir = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0;
    if (ev.key === 'Enter' || ev.key === ' ') (ev.preventDefault(), pick(item.key));
    if (!dir || item.fixed) return;
    ev.preventDefault();
    setSelected(item.key);
    item.save(item.preview(ev.shiftKey && resizable ? 'end' : 'move', dir * SNAP));
  };

  const itemProps = (item: Item, label: string, resizable = true) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    'aria-pressed': selected === item.key,
    onPointerDown: (ev: ReactPointerEvent) => begin(ev, item, 'move'),
    onKeyDown: keys(item, resizable),
  });
  const on = (key: string) => (selected === key ? 'sel' : '');

  const exactRow = () => {
    if (!editing || !selected || !clockedOrEntry()) return null;
    if (selected === 'in' || selected === 'out') {
      const w = clocked!;
      const edge = selected;
      return (
        <div className="tl-edit">
          <span className="tl-edit-name">{t(edge === 'in' ? 'tl.in' : 'tl.out')}</span>
          {readOnly ? (
            <span className="muted">{fmtTime(edge === 'in' ? w.start : w.end!)}</span>
          ) : (
            <TimeField
              value={edge === 'in' ? w.start : w.end!}
              day={day}
              onChange={(v) => {
                if (edge === 'out' ? v > w.start : !w.end || v < w.end) (edge === 'in' ? inItem(w) : outItem(w)).save({ key: edge, start: v, end: v });
              }}
            />
          )}
          <span className="muted small">{t('tl.noMove')}</span>
        </div>
      );
    }
    if (selected.startsWith('b:')) {
      const i = Number(selected.slice(2));
      const b = clocked!.breaks[i];
      return (
        <div className="tl-edit">
          <span className="tl-edit-name">{t('break')}</span>
          {readOnly || !b.end ? (
            <span className="muted">
              {fmtTime(b.start)}–{b.end ? fmtTime(b.end) : t('now')}
            </span>
          ) : (
            <span className="feed-times">
              <TimeField value={b.start} day={day} onChange={(start) => update((d) => updateBreak(d, day, i, { start }))} />
              <span className="muted">–</span>
              <TimeField value={b.end} day={day} onChange={(end) => update((d) => updateBreak(d, day, i, { end }))} />
            </span>
          )}
          {!readOnly && (
            <button className="btn ghost small" onClick={() => (setSelected(null), update((d) => removeBreak(d, day, i)))}>
              {t('wd.removeBreak')}
            </button>
          )}
        </div>
      );
    }
    const e = entries.find((x) => `e:${x.id}` === selected)!;
    return (
      <div className="tl-edit">
        <span className="dot" style={{ background: project(e)?.color ?? '#B0BEC5' }} />
        <span className="tl-edit-name">{nameOf(e, project(e)?.name)}</span>
        {readOnly || !e.end ? (
          <span className="muted">
            {fmtTime(e.start)}–{e.end ? fmtTime(e.end) : t('now')}
          </span>
        ) : (
          <span className="feed-times">
            <TimeField value={e.start} day={day} onChange={(start) => update((d) => updateEntry(d, e.id, { start }))} />
            <span className="muted">–</span>
            <TimeField value={e.end} day={day} onChange={(end) => update((d) => updateEntry(d, e.id, { end }))} />
          </span>
        )}
        <strong>{fmtHM(entryMs(e, now))}</strong>
      </div>
    );
  };
  /** The selection may be gone (a deleted entry or break, or a day off by now). */
  function clockedOrEntry() {
    if (selected === 'in') return clocked;
    if (selected === 'out') return clocked?.end;
    if (selected?.startsWith('b:')) return clocked?.breaks[Number(selected.slice(2))];
    return entries.some((e) => `e:${e.id}` === selected);
  }

  return (
    <div className="timeline">
      {hasTimeline && (
        <div className="tl-totals">
          <span className="tl-sum">
            {clocked && !clocked.fromEntries && (
              <>
                {t('tl.clocked')} <strong>{fmtHM(worked)}</strong>
                {' · '}
              </>
            )}
            {t('review.booked')} <strong>{fmtHM(booked)}</strong>
            {clocked && !clocked.fromEntries && Math.abs(open) >= 5 * MIN && ` · ${t(open > 0 ? 'tl.unbooked' : 'tl.over', { time: fmtHM(Math.abs(open)) })}`}
          </span>
          {clocked?.fromEntries && (
            <span className="from-bookings" title={t('fit.fromEntriesHint')}>
              {t('fit.fromEntries')}
            </span>
          )}
          {overlap >= MIN && <span className="tl-tag">{t('tl.overlap', { time: fmtHM(overlap) })}</span>}
          <span className="spacer" />
          {clocked && !readOnly && (
            <>
              <button className="btn ghost small" onClick={() => update((d) => addBreak(d, day))}>
                <Icon name="add" size={16} /> {t('break')}
              </button>
              <span className="tl-more" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(false)}>
                <button className="icon-btn" aria-label={t('tl.more')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                  <Icon name="more_vert" size={18} />
                </button>
                {menu && (
                  <span className="tl-menu" role="menu">
                    <button role="menuitem" onClick={() => confirm(t('wd.offConfirm')) && (setMenu(false), update((d) => markDayOff(d, day)))}>
                      {t('dayOff')}
                    </button>
                    <button role="menuitem" onClick={() => confirm(t('wd.offConfirm')) && (setMenu(false), update((d) => markDayOff(d, day, 'overtime')))}>
                      {t('dayOff.overtime')}
                    </button>
                    <button role="menuitem" onClick={() => confirm(t('wd.deleteConfirm')) && (setMenu(false), update((d) => deleteWorkday(d, day)))}>
                      {t('wd.deleteHint')}
                    </button>
                  </span>
                )}
              </span>
            </>
          )}
        </div>
      )}
      <DayStatus key={day} day={day} />
      {hasTimeline && (
        <div className="tl-scroll">
          <div className="tl-track" ref={trackRef} style={{ height }} onPointerDown={() => setSelected(null)}>
            {hours.map((h) => (
              <span key={h} className="tl-hour" style={{ left: `${x(h)}%` }}>
                <span>{fmtTime(h)}</span>
              </span>
            ))}
            {clocked && <div className="tl-clocked" style={{ left: `${x(Date.parse(clocked.start))}%`, width: `${x(clockEnd) - x(Date.parse(clocked.start))}%` }} />}
            {clocked?.breaks.map((b, i) => {
              const a = Date.parse(b.start);
              const item = breakItem(clocked, i);
              return (
                <div
                  key={i}
                  {...itemProps(item, `${t('break')}, ${fmtTime(a)}–${b.end ? fmtTime(b.end) : t('now')}`)}
                  className={`tl-break ${item.fixed ? 'fixed' : ''} ${on(item.key)}`}
                  style={{ left: `${x(a)}%`, width: `${x(b.end ? Date.parse(b.end) : now) - x(a)}%` }}
                  title={`${t('break')} ${fmtTime(a)}–${b.end ? fmtTime(b.end) : t('now')}`}
                >
                  {!item.fixed && <i className="tl-edge start" onPointerDown={(ev) => begin(ev, item, 'start')} />}
                  <Icon name="coffee" size={13} />
                  {!item.fixed && <i className="tl-edge end" onPointerDown={(ev) => begin(ev, item, 'end')} />}
                </div>
              );
            })}
            {clocked && (
              <div
                {...itemProps(inItem(clocked), `${t('tl.in')} ${fmtTime(clocked.start)}`, false)}
                className={`tl-handle ${readOnly ? 'fixed' : ''} ${on('in')}`}
                style={{ left: `${x(Date.parse(clocked.start))}%` }}
                title={`${t('tl.in')} ${fmtTime(clocked.start)}`}
              />
            )}
            {clocked?.end && (
              <div
                {...itemProps(outItem(clocked), `${t('tl.out')} ${fmtTime(clocked.end)}`, false)}
                className={`tl-handle ${readOnly ? 'fixed' : ''} ${on('out')}`}
                style={{ left: `${x(Date.parse(clocked.end))}%` }}
                title={`${t('tl.out')} ${fmtTime(clocked.end)}`}
              />
            )}
            {overlaps.map(([a, b]) => (
              <div key={a} className="tl-overlap" style={{ left: `${x(a)}%`, width: `${x(b) - x(a)}%`, top: TOP, height: laneCount * LANE }} title={t('tl.overlap', { time: fmtHM(b - a) })} />
            ))}
            {day === dayKey(now) && <div className="tl-now" style={{ left: `${x(now)}%` }} />}
            {entries.map((e) => {
              const a = Date.parse(e.start);
              const p = project(e);
              const color = p?.color ?? '#B0BEC5';
              const item = entryItem(e);
              const name = nameOf(e, p?.name);
              const times = `${fmtTime(a)}–${e.end ? fmtTime(e.end) : t('now')}`;
              return (
                <div
                  key={e.id}
                  {...itemProps(item, `${name}, ${times}`)}
                  className={`tl-block ${item.fixed ? 'fixed' : ''} ${on(item.key)} ${drag?.key === item.key ? 'dragging' : ''}`}
                  style={{ left: `${x(a)}%`, width: `${x(endOf(e)) - x(a)}%`, top: TOP + laneOf.get(e.id)! * LANE, borderColor: color, background: `color-mix(in srgb, ${color} 18%, var(--surface))` }}
                  title={`${name}\n${times} · ${fmtHM(entryMs(e, now))}`}
                >
                  {!item.fixed && <i className="tl-edge start" onPointerDown={(ev) => begin(ev, item, 'start')} />}
                  <span className="tl-name">
                    <span className="dot" style={{ background: color }} /> {name}
                  </span>
                  <span className="tl-time muted">{times}</span>
                  {!item.fixed && <i className="tl-edge end" onPointerDown={(ev) => begin(ev, item, 'end')} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {exactRow()}
      <EntryFeed
        day={day}
        entries={entries}
        mode="hours"
        readOnly={readOnly}
        selected={selected?.startsWith('e:') ? selected.slice(2) : null}
        onSelect={(id) => (setSelected(`e:${id}`), setEditing(false))}
      />
    </div>
  );
}
