// Day-level pieces shared by the Today page and the Timesheet's day modal.
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  addBreak,
  addWorkday,
  closeWorkday,
  confirmAutoClose,
  deleteWorkday,
  fillGaps,
  markDayOff,
  setOffKind,
  planGaps,
  removeBreak,
  runningEntry,
  startDay,
  startTimer,
  updateBreak,
  updateWorkday,
} from '../actions';
import { TimeField, TrailSummary } from '../components';
import { Icon } from '../icons';
import { goalFor, planItemsOn, timeWindow } from '../plan';
import type { Data } from '../types';
import { targetHoursOn } from '../schedule';
import { addDays, atTime, breakMs, dayKey, entryMs, fmtDayLabel, fmtDuration, fmtTime, hoursToMs, useNow, workdayMs } from '../time';
import { t } from '../i18n';

const MISSING_LOOKBACK_DAYS = 30;
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
function missingDays(data: Data, now: number): { date: string; worked: number; missing: number }[] {
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

export function MissingHours({ onOpenDay }: { onOpenDay: (d: string) => void }) {
  const { data } = useStore();
  const now = useNow(60_000);
  const [open, setOpen] = useState(false);
  const days = useMemo(() => missingDays(data, now), [data, now]);
  const total = days.reduce((s, d) => s + d.missing, 0);

  if (!days.length) {
    return (
      <div className="banner ok">
        <Icon name="check" size={18} /> {t('day.allReached', { n: MISSING_LOOKBACK_DAYS })}
      </div>
    );
  }
  return (
    <section className="card missing">
      <button className="missing-head" onClick={() => setOpen(!open)}>
        <span>
          <strong>{t('day.daysUnder', { n: days.length })}</strong>{' '}
          <span className="muted">{t('day.missingDetail', { n: MISSING_LOOKBACK_DAYS, duration: fmtDuration(total) })}</span>
        </span>
        <span className="muted">{t(open ? 'hide' : 'show')}</span>
      </button>
      {open && (
        <div className="missing-list">
          {days.map((d) => (
            <button key={d.date} className="missing-row" onClick={() => onOpenDay(d.date)}>
              <span>{fmtDayLabel(d.date)}</span>
              <span className="muted">{d.worked ? t('day.worked', { duration: fmtDuration(d.worked) }) : t('day.nothingRecorded')}</span>
              <span className="neg">−{fmtDuration(d.missing)}</span>
              <Icon name="chevron_right" size={18} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * A past workday that's still open, or that the midnight auto-stop closed at 23:59:
 * ask once for the real leave time.
 */
export function StaleBanner({ onOpenDay }: { onOpenDay: (d: string) => void }) {
  const { data, update } = useStore();
  const today = dayKey(new Date());
  const stale = data.workdays.filter((w) => w.date < today && !w.off && (!w.end || w.autoClosed)).sort((a, b) => b.date.localeCompare(a.date))[0];
  const [leftAt, setLeftAt] = useState('17:00');
  if (!stale) return null;
  return (
    <div className="banner warn">
      <Icon name="warning" size={18} />
      <span>
        {t(stale.end ? 'stale.autoBefore' : 'stale.openBefore')}
        <button className="link" onClick={() => onOpenDay(stale.date)}>
          {fmtDayLabel(stale.date)}
        </button>
        {t(stale.end ? 'stale.autoAfter' : 'stale.openAfter', { time: fmtTime(stale.start) })}
      </span>
      <input className="time-field" type="time" value={leftAt} onChange={(e) => setLeftAt(e.target.value)} />
      <button className="btn small primary" onClick={() => update((d) => closeWorkday(d, stale.date, atTime(stale.date, leftAt)))}>
        {t('save')}
      </button>
      {stale.end && (
        <button className="btn small ghost" onClick={() => update((d) => confirmAutoClose(d, stale.date))} title={t('stale.keepHint')}>
          {t('stale.keep')}
        </button>
      )}
    </div>
  );
}

/** In/out, breaks, day off: the attendance part of a day, editable for any date. */
export function WorkdayEditor({ day }: { day: string }) {
  const { data, update } = useStore();
  const now = useNow(30_000);
  const wd = data.workdays.find((w) => w.date === day);
  const isToday = day === dayKey(now);
  const target = hoursToMs(targetHoursOn(data, day));
  const [inTime, setIn] = useState('08:00');
  const [outTime, setOut] = useState('16:30');

  if (!wd) {
    return (
      <div className="wd-editor empty">
        <span className="muted">{t(isToday ? 'wd.notClockedInYet' : 'wd.noWorkday')}</span>
        {isToday ? (
          <>
            <button className="btn primary" onClick={() => update(startDay)}>
              <Icon name="login" size={18} /> {t('startDay')}
            </button>
            <button className="btn" onClick={() => update((d) => markDayOff(d, day))}>
              <Icon name="event_busy" size={18} /> {t('dayOff')}
            </button>
            <button className="btn" onClick={() => update((d) => markDayOff(d, day, 'overtime'))}>
              <Icon name="savings" size={18} /> {t('dayOff.overtime')}
            </button>
          </>
        ) : (
          <>
            <span className="wd-times">
              {t('wd.in')} <input className="time-field" type="time" value={inTime} onChange={(e) => setIn(e.target.value)} />
              {t('wd.out')} <input className="time-field" type="time" value={outTime} onChange={(e) => setOut(e.target.value)} />
            </span>
            <button className="btn primary" onClick={() => update((d) => addWorkday(d, day, inTime, outTime))}>
              <Icon name="add" size={18} /> {t('wd.addWorkday')}
            </button>
            <button className="btn" onClick={() => update((d) => markDayOff(d, day))}>
              <Icon name="event_busy" size={18} /> {t('dayOff')}
            </button>
            <button className="btn" onClick={() => update((d) => markDayOff(d, day, 'overtime'))}>
              <Icon name="savings" size={18} /> {t('dayOff.overtime')}
            </button>
          </>
        )}
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
        <button className="btn" onClick={() => update((d) => deleteWorkday(d, day))}>
          {t('wd.undoDayOff')}
        </button>
      </div>
    );
  }

  const worked = workdayMs(wd, now);
  return (
    <div className="wd-editor">
      <div className="wd-line">
        <span className="wd-times">
          <Icon name="login" size={18} /> {t('wd.in')} <TimeField value={wd.start} day={day} onChange={(start) => update((d) => updateWorkday(d, day, { start }))} />
          <Icon name="logout" size={18} /> {t('wd.out')}{' '}
          {wd.end ? (
            <TimeField value={wd.end} day={day} onChange={(end) => update((d) => updateWorkday(d, day, { end }))} />
          ) : isToday ? (
            <span className="muted">{t('wd.stillAtWork')}</span>
          ) : (
            <>
              <input className="time-field" type="time" value={outTime} onChange={(e) => setOut(e.target.value)} />
              <button className="btn small" onClick={() => update((d) => closeWorkday(d, day, atTime(day, outTime)))}>
                {t('save')}
              </button>
            </>
          )}
        </span>
        <span className="spacer" />
        <span>
          <strong>{fmtDuration(worked)}</strong>{' '}
          {wd.end && <span className={worked >= target ? 'pos' : 'neg'}>{worked >= target ? `+${fmtDuration(worked - target)}` : `−${fmtDuration(target - worked)}`}</span>}
        </span>
        <button className="icon-btn" title={t('wd.deleteHint')} onClick={() => confirm(t('wd.deleteConfirm')) && update((d) => deleteWorkday(d, day))}>
          <Icon name="delete" size={18} />
        </button>
      </div>
      <div className="breaks">
        <span className="muted small">
          <Icon name="coffee" size={16} /> {t('wd.breaks', { duration: fmtDuration(breakMs(wd)) })}
        </span>
        {wd.breaks.map((b, i) => (
          <span key={i} className="break-chip">
            <TimeField value={b.start} day={day} onChange={(start) => update((d) => updateBreak(d, day, i, { start }))} />–
            {b.end ? <TimeField value={b.end} day={day} onChange={(end) => update((d) => updateBreak(d, day, i, { end }))} /> : <span className="muted">{t('now')}</span>}
            <button className="icon-btn" title={t('wd.removeBreak')} onClick={() => update((d) => removeBreak(d, day, i))}>
              <Icon name="close" size={16} />
            </button>
          </span>
        ))}
        <button className="btn ghost small" onClick={() => update((d) => addBreak(d, day))}>
          <Icon name="add" size={16} /> {t('break')}
        </button>
      </div>
    </div>
  );
}

/** Untracked time, what's left against the plan (one click to add), and the activity trail as a memory aid. */
export function DayReview({ day, title }: { day: string; title?: string }) {
  const { data, update } = useStore();
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
      <div className="review-stats">
        <span>
          {t('atWork')} <strong>{fmtDuration(atWork)}</strong>
        </span>
        <span>
          {t('tracked')} <strong>{fmtDuration(tracked)}</strong>
        </span>
        <span className={unassigned >= 5 * 60_000 ? 'neg' : 'pos'}>
          {unassigned >= 5 * 60_000 ? t('review.notAssigned', { duration: fmtDuration(unassigned) }) : t('review.allAssigned')}
        </span>
      </div>
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
          <button className="btn primary small" disabled={!chosen.length} onClick={() => update((d) => fillGaps(d, day, chosen))}>
            <Icon name="playlist_add" size={18} /> {t('review.add', { duration: fmtDuration(chosen.reduce((s, g) => s + g.ms, 0)) })}
          </button>
        </div>
      )}
    </div>
  );
}
