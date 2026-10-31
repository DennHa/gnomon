// Day-level pieces shared by the Today page and the Timesheet's day modal.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import {
  addWorkday,
  closeWorkday,
  confirmAutoClose,
  deleteWorkday,
  fillGaps,
  markDayOff,
  setOffKind,
  planGaps,
  runningEntry,
  startDay,
  startTimer,
} from '../actions';
import { TrailSummary } from '../components';
import { Icon } from '../icons';
import { goalFor, planItemsOn, timeWindow } from '../plan';
import type { Data } from '../types';
import { targetHoursOn } from '../schedule';
import { addDays, atTime, dayKey, entryMs, fmtDuration, fmtHM, hoursToMs, useNow, workdayMs } from '../time';
import { t } from '../i18n';
import { copyHoursOn, daysText, type CopyText } from '../copytext';
import { useAddHours, useLeaveEdit } from '../notes';
import { leaveSuggestion } from '../daycheck';

export const MISSING_LOOKBACK_DAYS = 30;

/** Copy day: puts the days' entries on the clipboard as bullet points; nothing when there are none. */
export async function copyDays(data: Data, days: string[]): Promise<CopyText> {
  const r = daysText(data, days, { hours: copyHoursOn(data) });
  if (r.lines) await window.api.copyText(r.text);
  return r;
}

/**
 * "Copy as text": a click copies right away; the arrow opens the options (hours per line) with a preview of the exact
 * text and its own Copy button. Says what it copied for a moment.
 */
export function CopyAsText({ days }: { days: string[] }) {
  const { data, update } = useStore();
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number; maxHeight: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const now = useNow(30_000);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), 2500);
    return () => clearTimeout(timer);
  }, [done]);
  const hours = copyHoursOn(data);
  const multi = days.length > 1;
  const copy = () =>
    copyDays(data, days).then(
      (r) => setDone(r.lines ? t('copy.done', { n: r.lines }) : t('copy.nothing')),
      () => setDone(t('copy.failed')),
    );
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) moreRef.current?.focus();
  };

  // Fixed and in <body>, so the week card's scroll area and the day panel don't clip it: below the button, or above
  // when there's more room there; right-aligned with the button.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 16;
      const above = r.top - 16;
      const right = Math.max(16, window.innerWidth - r.right);
      setPos(below >= 260 || below >= above ? { top: r.bottom + 6, right, maxHeight: below - 6 } : { bottom: window.innerHeight - r.top + 6, right, maxHeight: above - 6 });
    };
    place();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!wrapRef.current?.contains(target) && !popRef.current?.contains(target)) close(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);
  useEffect(() => {
    if (open && pos) popRef.current?.querySelector<HTMLElement>('input')?.focus();
  }, [open, Boolean(pos)]);

  const preview = open ? daysText(data, days, { hours, now }) : null;
  return (
    <span
      className="copy-text"
      ref={wrapRef}
      onKeyDown={(e) => {
        // Escape closes the options first, not the day panel around them.
        if (open && e.key === 'Escape') (e.stopPropagation(), close());
      }}
    >
      <button className="btn ghost small copy-main" onClick={copy} title={t(multi ? 'copy.weekHint' : 'copy.dayHint')} aria-live="polite">
        <Icon name={done ? 'check' : 'notes'} size={16} /> {done ?? t('copy.asText')}
      </button>
      <button
        ref={moreRef}
        className={`btn ghost small copy-more ${open ? 'open' : ''}`}
        title={t('copy.options')}
        aria-label={t('copy.options')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : (setPos(null), setOpen(true)))}
      >
        <Icon name="arrow_drop_down" size={18} />
      </button>
      {open &&
        pos &&
        preview &&
        createPortal(
          <div
            ref={popRef}
            className="copy-pop"
            role="dialog"
            aria-label={t('copy.options')}
            style={{ top: pos.top, bottom: pos.bottom, right: pos.right, maxHeight: Math.max(160, pos.maxHeight) }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') (e.stopPropagation(), close());
            }}
          >
            <label className="check-row">
              <input type="checkbox" checked={hours} onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, copyHours: e.target.checked } }))} />
              {t('copy.withHours')}
            </label>
            {preview.lines ? (
              <pre className="copy-preview" tabIndex={0} aria-label={t('copy.preview')}>
                {preview.text.trimEnd()}
              </pre>
            ) : (
              <p className="muted small">{t('copy.nothing')}</p>
            )}
            <div className="copy-pop-actions">
              <button className="btn primary small" disabled={!preview.lines} onClick={() => (copy(), close())}>
                <Icon name="notes" size={16} /> {t('copy.copy')}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
export const shiftDay = (day: string, n: number) => dayKey(addDays(new Date(`${day}T12:00`), n));

/** Planned hours per project for a day (Float plan or manual goals), with progress. */
export function ProjectGoals({ day }: { day: string }) {
  const { data, update } = useStore();
  const now = useNow();
  const running = runningEntry(data);
  const isToday = day === dayKey(now);
  const goals = data.projects.filter((p) => goalFor(data, p.id, day) > 0);
  if (!goals.length) return null;

  return (
    <section className="card goals">
      <h3>{t(isToday ? 'day.plannedToday' : 'day.planned')}</h3>
      {goals.map((p) => {
        const goal = goalFor(data, p.id, day);
        const tasks = planItemsOn(data, p.id, day);
        const done = data.entries.filter((e) => e.projectId === p.id && dayKey(e.start) === day).reduce((s, e) => s + entryMs(e, now), 0);
        const pct = Math.min(100, (done / goal) * 100);
        const active = running?.projectId === p.id;
        return (
          <div key={p.id} className="goal-row">
            <span className="goal-name">
              <span className="hbar-name">
                <span className="dot" style={{ background: p.color }} /> {p.name}
              </span>
              {tasks.length > 0 && (
                <span className="muted small goal-tasks">{tasks.map((task) => [task.name || t('plannedWork'), timeWindow(task)].filter(Boolean).join(' · ')).join(', ')}</span>
              )}
            </span>
            <div className="hbar-track">
              <div style={{ width: `${pct}%`, background: p.color }} />
            </div>
            <span className="goal-text">
              {fmtDuration(done)} <span className="muted">/ {fmtDuration(goal)}</span>
            </span>
            <span className={`goal-left ${done >= goal ? 'pos' : 'muted'}`}>{done >= goal ? t('day.reached') : t('day.toGo', { duration: fmtDuration(goal - done) })}</span>
            {isToday && (
              <button
                className={`icon-btn ${active ? 'live' : ''}`}
                title={active ? t('day.running') : t('day.startProject', { name: p.name })}
                disabled={active}
                onClick={() => {
                  const only = tasks.length === 1 ? tasks[0] : undefined;
                  update((d) => startTimer(d, { description: '', projectId: p.id, taskId: only?.floatId, taskName: only?.name || undefined }));
                }}
              >
                <Icon name={active ? 'timer' : 'play_arrow'} size={18} />
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Days in the recent past that ended below their scheduled target (scheduled days without any record count too). */
export function missingDays(data: Data, now: number): { date: string; worked: number; missing: number }[] {
  const today = dayKey(now);
  // Don't count days from before you started using Gnomon.
  const first = data.workdays.reduce((min, w) => (w.date < min ? w.date : min), today);
  const out = [];
  for (let i = 1; i <= MISSING_LOOKBACK_DAYS; i++) {
    const date = shiftDay(today, -i);
    if (date < first) break;
    const wd = data.workdays.find((w) => w.date === date);
    const target = hoursToMs(targetHoursOn(data, date));
    if (wd?.off || target <= 0 || (wd && !wd.end)) continue;
    const worked = wd ? workdayMs(wd, now) : 0;
    if (worked < target) out.push({ date, worked, missing: target - worked });
  }
  return out;
}

/**
 * What a day's timeline can't show, in one compact row: no workday yet, a day off, or a past day whose leave time is
 * still open or was set by the midnight close. A normal day has none: its times are changed on the timeline.
 */
export function DayStatus({ day }: { day: string }) {
  const { data, update } = useStore();
  const leaveEdit = useLeaveEdit();
  const now = useNow(30_000);
  const wd = data.workdays.find((w) => w.date === day);
  const isToday = day === dayKey(now);
  const target = hoursToMs(targetHoursOn(data, day));
  const [inTime, setIn] = useState('08:00');
  const [outTime, setOut] = useState('16:30');
  const [leftAt, setLeftAt] = useState<string | null>(null);

  if (!wd) {
    return (
      <div className="wd-editor empty">
        <span className="muted">{t(isToday ? 'wd.notClockedInYet' : 'wd.noWorkday')}</span>
        {isToday ? (
          <button className="btn primary small" onClick={() => update(startDay)}>
            <Icon name="login" size={16} /> {t('startDay')}
          </button>
        ) : (
          <>
            <span className="wd-times">
              <input className="time-field" type="time" aria-label={t('tl.in')} value={inTime} onChange={(e) => setIn(e.target.value)} />
              –
              <input className="time-field" type="time" aria-label={t('tl.out')} value={outTime} onChange={(e) => setOut(e.target.value)} />
            </span>
            <button className="btn primary small" onClick={() => update((d) => addWorkday(d, day, inTime, outTime))}>
              <Icon name="add" size={16} /> {t('wd.addWorkday')}
            </button>
          </>
        )}
        <button className="btn small" onClick={() => update((d) => markDayOff(d, day))}>
          {t('dayOff')}
        </button>
        <button className="btn small" onClick={() => update((d) => markDayOff(d, day, 'overtime'))}>
          {t('dayOff.overtime')}
        </button>
      </div>
    );
  }

  if (wd.off) {
    return (
      <div className="wd-editor off">
        <Icon name={wd.offKind === 'overtime' ? 'savings' : 'event_busy'} size={20} />
        <span>
          <strong>{t(wd.offKind === 'overtime' ? 'dayOff.overtime' : 'dayOff')}</strong>
          <span className="muted">
            {' · '}
            {wd.offKind === 'overtime'
              ? t('wd.overtimeHint', { duration: fmtDuration(target) })
              : wd.offReason
                ? `${wd.offReason}${wd.offSource === 'float' ? ' (Float)' : wd.offSource === 'personio' && !wd.offReason.includes('Personio') ? ' (Personio)' : ''}`
                : t('wd.notMissing')}
          </span>
        </span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={() => update((d) => setOffKind(d, day, wd.offKind === 'overtime' ? undefined : 'overtime'))}>
          {t(wd.offKind === 'overtime' ? 'wd.makeDayOff' : 'wd.makeOvertime')}
        </button>
        <button className="btn small" onClick={() => update((d) => deleteWorkday(d, day))}>
          {t('wd.undoDayOff')}
        </button>
      </div>
    );
  }

  // Today's leave time is open because you're still here; a past day's is a question.
  if (isToday || (wd.end && !wd.autoClosed)) return null;
  const left = leftAt ?? leaveSuggestion(data, day);
  return (
    <div className="wd-editor empty ask">
      <span>{t(wd.end ? 'wd.closedLeft' : 'wd.openLeft')}</span>
      <input className="time-field" type="time" aria-label={t('tl.out')} title={t('stale.suggestHint')} value={left} onChange={(e) => setLeftAt(e.target.value)} />
      <button className="btn primary small" onClick={() => leaveEdit(day, (d) => closeWorkday(d, day, atTime(day, left)))}>
        {t('save')}
      </button>
      {wd.end && (
        <button className="btn ghost small" onClick={() => update((d) => confirmAutoClose(d, day))}>
          {t('stale.keepHint')}
        </button>
      )}
    </div>
  );
}

/** Untracked time, what's left against the plan (one click to add), and the activity trail as a memory aid. */
export function DayReview({ day, title, noStats }: { day: string; title?: string; /** The day timeline shows these already. */ noStats?: boolean }) {
  const { data } = useStore();
  const addHours = useAddHours();
  const now = useNow(60_000);
  const wd = data.workdays.find((w) => w.date === day);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const gaps = useMemo(() => planGaps(data, day), [data, day]);
  if (!wd || wd.off) return <TrailSummary day={day} />;

  const entries = data.entries.filter((e) => dayKey(e.start) === day);
  const tracked = entries.reduce((s, e) => s + entryMs(e, now), 0);
  const atWork = workdayMs(wd, now);
  const unassigned = atWork - tracked;
  const key = (g: { projectId: string; taskId?: number }) => `${g.projectId}|${g.taskId ?? ''}`;
  const chosen = gaps.filter((g) => !skip.has(key(g)));
  const projectOf = (id: string) => data.projects.find((p) => p.id === id);
  const complete = unassigned < 5 * 60_000 && !gaps.length;

  return (
    <div className="review">
      {title && <h3>{complete ? t('review.complete') : title}</h3>}
      {/* Work hours and bookings are separate; their difference is only a hint, with where each number comes from. */}
      {!noStats && <div className="review-stats">
        {wd.fromEntries ? (
          <span>
            {t('review.booked')} <strong>{fmtDuration(tracked)}</strong> <span className="from-bookings">{t('fit.fromEntries')}</span>
          </span>
        ) : (
          <>
            <span>
              {t('review.clockedIn')} <strong>{fmtDuration(atWork)}</strong>
            </span>
            <span>
              {t('review.booked')} <strong>{fmtDuration(tracked)}</strong>
            </span>
            <span className="muted">
              {unassigned >= 5 * 60_000
                ? t('review.notAssigned', { duration: fmtHM(unassigned) })
                : unassigned <= -5 * 60_000
                  ? t('review.overBooked', { duration: fmtHM(-unassigned) })
                  : t('review.allAssigned')}
            </span>
          </>
        )}
      </div>}
      <TrailSummary day={day} />
      {gaps.length > 0 && (
        <div className="review-block">
          <p className="muted small">{t('review.openAgainstPlan')}</p>
          {gaps.map((g) => {
            const p = projectOf(g.projectId);
            return (
              <label key={key(g)} className="check-row">
                <input
                  type="checkbox"
                  checked={!skip.has(key(g))}
                  onChange={(e) =>
                    setSkip((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.delete(key(g));
                      else n.add(key(g));
                      return n;
                    })
                  }
                />
                <span className="dot" style={{ background: p?.color }} /> {p?.name}
                {g.taskName && <span className="muted"> · {g.taskName}</span>}
                <span className="spacer" />
                <strong>{fmtDuration(g.ms)}</strong>
              </label>
            );
          })}
          <button className="btn primary small" disabled={!chosen.length} onClick={() => addHours(chosen.reduce((s, g) => s + g.ms, 0), (d) => fillGaps(d, day, chosen))}>
            <Icon name="playlist_add" size={18} /> {t('review.add', { duration: fmtDuration(chosen.reduce((s, g) => s + g.ms, 0)) })}
          </button>
        </div>
      )}
    </div>
  );
}
