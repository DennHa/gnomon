import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { copyEntriesTo, fillGaps, lastDayEntries, planGaps, toggleWeekDone, weekCopyPlan } from '../actions';
import { NewProjectInput, TrailSummary } from '../components';
import { EntryFeed } from '../feed';
import { Icon } from '../icons';
import { DayReview, MISSING_LOOKBACK_DAYS, StaleBanner, WorkdayEditor, missingDays, shiftDay } from './day';
import type { Data } from '../types';
import { targetHoursOn } from '../schedule';
import { Burst } from '../motion';
import { addDays, dayKey, entryMs, fmtDate, fmtDayLabel, fmtDayLong, fmtDuration, fmtHM, fmtTime, hoursToMs, startOfWeek, useNow, workdayMs } from '../time';
import { goalFor } from '../plan';
import { t } from '../i18n';

const noProject = () => ({ id: '', name: t('noProject'), color: '#B0BEC5', dailyGoalHours: undefined });

/** Monday–Friday of the week that aren't marked as days off: the days a daily goal applies to. */
/** Days of the week that are scheduled workdays and not days off (for project week goals). */
export function goalDays(data: Data, days: string[]): number {
  return days.filter((d) => targetHoursOn(data, d) > 0 && !data.workdays.find((w) => w.date === d)?.off).length;
}

/** The week's attendance target from the work schedule; normal days off don't count, overtime-off days do. */
const weekTarget = (data: Data, days: string[]) =>
  days.reduce((sum, d) => {
    const w = data.workdays.find((x) => x.date === d);
    return w?.off && w.offKind !== 'overtime' ? sum : sum + hoursToMs(targetHoursOn(data, d));
  }, 0);

/** Saturday and Sunday: shown muted in the week, but still editable. */
const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T12:00`).getDay());

export function weekDays(day: string): string[] {
  const start = startOfWeek(new Date(`${day}T12:00`));
  return Array.from({ length: 7 }, (_, i) => dayKey(addDays(start, i)));
}

type CellRef = { projectId: string; day: string };

function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog">
        <header className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label={t('close')}>
            <Icon name="close" size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** One project on one day: its entries as hours, plus a row to add more. */
function CellModal({ cell, onClose, readOnly }: { cell: CellRef; onClose: () => void; readOnly: boolean }) {
  const { data } = useStore();
  const { projectId, day } = cell;
  const project = data.projects.find((p) => p.id === projectId);
  const entries = data.entries.filter((e) => (e.projectId || '') === projectId && dayKey(e.start) === day).sort((a, b) => a.start.localeCompare(b.start));
  const gap = planGaps(data, day).find((g) => g.projectId === projectId);
  const planned = projectId ? goalFor(data, projectId, day) : 0;
  const tracked = entries.reduce((s, e) => s + entryMs(e), 0);
  const [prefill, setPrefill] = useState<{ ms: number; taskId?: number; taskName?: string } | null>(null);
  const { update } = useStore();
  const repeat = lastDayEntries(data, projectId || undefined, day);

  return (
    <Modal
      onClose={onClose}
      title={
        <>
          <span className="dot" style={{ background: project?.color ?? '#B0BEC5' }} /> <strong>{project?.name ?? t('noProject')}</strong>
          <span className="muted"> · {fmtDayLong(day)}</span>
        </>
      }
    >
      <div className="modal-sum">
        <span>
          <strong>{fmtHM(tracked)}</strong>
          {t('ts.tracked')}
          {planned > 0 && <span className="muted">{t('ts.ofPlanned', { time: fmtHM(planned) })}</span>}
        </span>
        {gap && !readOnly && (
          <button className="btn ghost small" onClick={() => setPrefill({ ms: gap.ms, taskId: gap.taskId, taskName: gap.taskName })}>
            <Icon name="playlist_add" size={18} /> {t('ts.usePlan', { time: fmtHM(gap.ms) })}
            {gap.taskName ? ` ${gap.taskName}` : ''}
          </button>
        )}
      </div>
      {repeat && !readOnly && (
        <div className="repeat">
          <span className="muted small">
            <Icon name="history" size={16} /> {t('ts.repeatFrom', { day: fmtDayLabel(repeat.day) })}
          </span>
          {repeat.entries.map((e) => (
            <button key={e.id} className="repeat-chip" onClick={() => update((d) => copyEntriesTo(d, day, [e]))} title={t('ts.repeatHint')}>
              <Icon name="content_copy" size={14} />
              {e.description || e.taskName || t('untitled')} · {fmtHM(entryMs(e))}
            </button>
          ))}
          {repeat.entries.length > 1 && (
            <button className="btn ghost small" onClick={() => update((d) => copyEntriesTo(d, day, repeat.entries))}>
              {t('ts.repeatAll', { time: fmtHM(repeat.entries.reduce((s, e) => s + entryMs(e), 0)) })}
            </button>
          )}
        </div>
      )}
      <EntryFeed day={day} entries={entries} mode="hours" projectId={projectId || null} readOnly={readOnly} prefill={prefill} />
      {readOnly && <p className="muted small">{t('ts.readOnly')}</p>}
      <TrailSummary day={day} />
    </Modal>
  );
}

/** A whole day: attendance, every entry as hours, and the review. */
function DayModal({ day, onClose, readOnly }: { day: string; onClose: () => void; readOnly: boolean }) {
  const { data } = useStore();
  const entries = data.entries.filter((e) => dayKey(e.start) === day).sort((a, b) => a.start.localeCompare(b.start));
  return (
    <Modal onClose={onClose} wide title={<strong>{fmtDayLong(day)}</strong>}>
      <WorkdayEditor day={day} />
      <div className="modal-section">
        <h4>{t('entries')}</h4>
        <EntryFeed day={day} entries={entries} mode="hours" readOnly={readOnly} />
      </div>
      <div className="modal-section">
        <DayReview day={day} />
      </div>
    </Modal>
  );
}

/** Days under target in the last weeks: a small badge in the page head that opens the list. */
function MissingBadge({ onOpenDay }: { onOpenDay: (d: string) => void }) {
  const { data } = useStore();
  const now = useNow(60_000);
  const [open, setOpen] = useState(false);
  const days = useMemo(() => missingDays(data, now), [data, now]);
  if (!days.length) return null;
  const total = days.reduce((s, d) => s + d.missing, 0);
  return (
    <>
      <button className="under-badge" onClick={() => setOpen(true)} title={t('day.missingDetail', { n: MISSING_LOOKBACK_DAYS, duration: fmtDuration(total) })}>
        <Icon name="warning" size={16} /> {t('day.daysUnder', { n: days.length })}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} title={<strong>{t('day.daysUnder', { n: days.length })}</strong>}>
          <p className="muted small">{t('day.missingDetail', { n: MISSING_LOOKBACK_DAYS, duration: fmtDuration(total) })}</p>
          <div className="missing-list">
            {days.map((d) => (
              <button key={d.date} className="missing-row" onClick={() => (setOpen(false), onOpenDay(d.date))}>
                <span>{fmtDayLabel(d.date)}</span>
                <span className="muted">{d.worked ? t('day.worked', { duration: fmtDuration(d.worked) }) : t('day.nothingRecorded')}</span>
                <span className="neg">−{fmtDuration(d.missing)}</span>
                <Icon name="chevron_right" size={18} />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

/** "+ Add project" for the timesheet: pick an existing project or create one inline. */
function AddRow({ exclude, onAdd }: { exclude: Set<string>; onAdd: (id: string) => void }) {
  const { data } = useStore();
  const [creating, setCreating] = useState(false);
  const available = data.projects.filter((p) => !exclude.has(p.id));
  if (creating) return <NewProjectInput onDone={(id) => (setCreating(false), id && onAdd(id))} />;
  return (
    <select
      className="ts-add"
      value=""
      onChange={(e) => (e.target.value === '__new__' ? setCreating(true) : e.target.value && onAdd(e.target.value))}
    >
      <option value="">{t('ts.addProject')}</option>
      {available.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
      <option value="__new__">{t('ts.newProject')}</option>
    </select>
  );
}

type TimesheetProps = { day: string; setDay: (d: string) => void; dayModal: string | null; setDayModal: (d: string | null) => void };

export default function Timesheet({ day, setDay, dayModal, setDayModal }: TimesheetProps) {
  const openDay = (d: string) => setDayModal(d);
  const { data, update } = useStore();
  const now = useNow(30_000);
  const today = dayKey(now);
  const days = useMemo(() => weekDays(day), [day]);
  // Rows added by hand stay visible for this week even while they're still empty.
  const [extraRows, setExtraRows] = useState<string[]>([]);
  useEffect(() => setExtraRows([]), [days[0]]);
  const [showFillHelp, setShowFillHelp] = useState(false);
  const [cell, setCell] = useState<CellRef | null>(null);
  const done = data.reviewedWeeks.includes(days[0]);
  const [weekBurst, setWeekBurst] = useState(0);
  useEffect(() => setWeekBurst(0), [days[0]]);
  const fillable = useMemo(
    () => days.filter((d) => d <= dayKey(new Date())).flatMap((d) => planGaps(data, d).map((g) => ({ ...g, day: d }))),
    [data, days],
  );
  const fillableMs = fillable.reduce((s, g) => s + g.ms, 0);
  const lastWeek = useMemo(() => weekCopyPlan(data, weekDays(shiftDay(day, -7)), days), [data, day, days]);
  const lastWeekMs = lastWeek.reduce((s, x) => s + x.entries.reduce((t, e) => t + entryMs(e), 0), 0);
  const copyLastWeek = () => {
    const n = lastWeek.reduce((s, x) => s + x.entries.length, 0);
    if (!confirm(t('ts.copyConfirm', { entries: t('count.entries', { n }), duration: fmtDuration(lastWeekMs) }))) return;
    update((d) => lastWeek.reduce((acc, x) => copyEntriesTo(acc, x.day, x.entries), d));
  };
  const fillWeek = () => {
    if (!confirm(t('ts.fillConfirm', { duration: fmtDuration(fillableMs) }))) return;
    update((d) => days.reduce((acc, day) => fillGaps(acc, day, fillable.filter((g) => g.day === day)), d));
  };

  const sheet = useMemo(() => {
    const cells = new Map<string, Map<string, number>>(); // projectId -> day -> ms
    const running = new Set<string>(); // "projectId|day" with a running timer
    for (const e of data.entries) {
      const d = dayKey(e.start);
      if (!days.includes(d)) continue;
      const pid = e.projectId && data.projects.some((p) => p.id === e.projectId) ? e.projectId : '';
      const row = cells.get(pid) ?? new Map<string, number>();
      row.set(d, (row.get(d) ?? 0) + entryMs(e, now));
      cells.set(pid, row);
      if (!e.end) running.add(`${pid}|${d}`);
    }
    // Projects with time, a plan or a manual row this week, in the order of the Projects page; "No project" last.
    const rows = [
      ...data.projects.filter((p) => cells.has(p.id) || extraRows.includes(p.id) || days.some((d) => goalFor(data, p.id, d) > 0)),
      ...(cells.has('') ? [noProject()] : []),
    ];
    const dayTotal = (d: string) => [...cells.values()].reduce((s, r) => s + (r.get(d) ?? 0), 0);
    return { cells, rows, running, dayTotal };
  }, [data, days, now, extraRows]);

  const weekTracked = days.reduce((s, d) => s + sheet.dayTotal(d), 0);
  const weekAtWork = days.reduce((s, d) => {
    const w = data.workdays.find((x) => x.date === d);
    return s + (w && !w.off ? workdayMs(w, now) : 0);
  }, 0);

  const thisWeek = days.includes(today);
  const fmtShort = (d: string) => fmtDate(d, { day: 'numeric', month: 'short' });
  const weekNo = (() => {
    const th = addDays(new Date(`${days[0]}T12:00`), 3);
    return Math.ceil(((th.getTime() - new Date(th.getFullYear(), 0, 1).getTime()) / 86_400_000 + 1) / 7);
  })();

  return (
    <div className="page wide">
    <header className="page-head">
      <div className="week-nav">
        <button className="icon-btn big" onClick={() => setDay(shiftDay(day, -7))} aria-label={t('ts.prevWeek')}>
          <Icon name="chevron_left" size={26} />
        </button>
        <div>
          <h1>{thisWeek ? t('ts.thisWeek') : t('ts.weekNo', { n: weekNo })}</h1>
          <span className="muted">
            {fmtShort(days[0])} – {fmtShort(days[6])}
          </span>
        </div>
        <button className="icon-btn big" onClick={() => setDay(shiftDay(day, 7))} disabled={thisWeek} aria-label={t('ts.nextWeek')}>
          <Icon name="chevron_right" size={26} />
        </button>
      </div>
      <span className="spacer" />
      <MissingBadge onOpenDay={openDay} />
      {!thisWeek && (
        <button className="btn" onClick={() => setDay(today)}>
          <Icon name="today" size={18} /> {t('ts.thisWeek')}
        </button>
      )}
    </header>
    <StaleBanner onOpenDay={openDay} />
    <section className={`card week ${done ? 'done' : ''}`}>
      <div className="week-bar">
        {done ? (
          <span className={`pos week-done ${weekBurst ? 'pop-in' : ''}`}>
            <Icon name="done_all" size={18} /> {t('ts.weekDone')}
            <Burst trigger={weekBurst} rays={12} style={{ left: 10, top: '50%' }} />
          </span>
        ) : null}
        <span className="spacer" />
        {!done && lastWeekMs >= 60_000 && (
          <button className="btn small" onClick={copyLastWeek} title={t('ts.copyHint')}>
            <Icon name="content_copy" size={18} /> {t('ts.copyLastWeek', { time: fmtHM(lastWeekMs) })}
          </button>
        )}
        {!done && fillableMs >= 60_000 && (
          <>
            <button className="btn small" onClick={fillWeek} title={t('ts.fillHint')}>
              <Icon name="playlist_add" size={18} /> {t('ts.fillFromPlan', { time: fmtHM(fillableMs) })}
            </button>
            <button className={`icon-btn ${showFillHelp ? 'live' : ''}`} onClick={() => setShowFillHelp(!showFillHelp)} title={t('ts.fillHelpToggle')}>
              <Icon name="info" size={18} />
            </button>
          </>
        )}
        <button
          className={`btn small ${done ? '' : 'primary'}`}
          onClick={() => {
            // Marking a week as done is a small celebration; reopening it isn't.
            setWeekBurst(done ? 0 : Date.now());
            update((d) => toggleWeekDone(d, days[0]));
          }}
        >
          <Icon name={done ? 'restart_alt' : 'done_all'} size={18} /> {t(done ? 'ts.reopenWeek' : 'ts.markDone')}
        </button>
      </div>
      {showFillHelp && (
        <p className="fill-help small">
          <Icon name="info" size={16} /> {t('ts.fillHelp')}
        </p>
      )}
      {cell && <CellModal cell={cell} readOnly={done} onClose={() => setCell(null)} />}
      {dayModal && <DayModal day={dayModal} readOnly={data.reviewedWeeks.includes(weekDays(dayModal)[0])} onClose={() => setDayModal(null)} />}
      <table className="timesheet">
        <thead>
          <tr>
            <th className="ts-project">{t('project')}</th>
            {days.map((d) => {
              const w = data.workdays.find((x) => x.date === d);
              return (
                <th key={d} className={`ts-day ${d === today ? 'today' : ''} ${d > today ? 'future' : ''} ${isWeekend(d) ? 'weekend' : ''}`}>
                  <button onClick={() => openDay(d)} title={t('openThisDay')}>
                    <span className="ts-weekday">{fmtDate(d, { weekday: 'short' })}</span>
                    <span className="ts-date">{fmtDate(d, { day: 'numeric', month: 'numeric' })}</span>
                    <span className="ts-attendance">
                      {w?.off ? (w.offKind === 'overtime' ? t('dayOff.overtime') : w.offReason ?? t('dayOff')) : w ? `${fmtTime(w.start)}–${w.end ? fmtTime(w.end) : t('now')}` : ''}
                    </span>
                  </button>
                </th>
              );
            })}
            <th className="ts-total">{t('total')}</th>
            <th className="ts-goal">{t('ts.weekGoal')}</th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((p) => {
            const row = sheet.cells.get(p.id);
            const total = days.reduce((s, d) => s + (row?.get(d) ?? 0), 0);
            const goal = p.id ? days.reduce((s, d) => s + goalFor(data, p.id, d), 0) : 0;
            const pct = goal ? Math.min(100, (total / goal) * 100) : 0;
            return (
              <tr key={p.id || 'none'}>
                <td className="ts-project">
                  <span className="dot" style={{ background: p.color }} /> {p.name}
                </td>
                {days.map((d) => {
                  const ms = row?.get(d) ?? 0;
                  const planned = p.id ? goalFor(data, p.id, d) : 0;
                  const short = planned > 0 && d <= today && ms < planned;
                  return (
                    <td key={d} className={`ts-cell ${d === today ? 'today' : ''} ${isWeekend(d) ? 'weekend' : ''}`}>
                      <button
                        className={`ts-btn ${ms ? (short ? 'short' : '') : planned ? 'planned' : 'empty'} ${sheet.running.has(`${p.id}|${d}`) ? 'live' : ''}`}
                        title={planned ? t('ts.plannedTime', { time: fmtHM(planned) }) : t('ts.addTime')}
                        onClick={() => setCell({ projectId: p.id, day: d })}
                      >
                        {ms ? fmtHM(ms) : planned ? fmtHM(planned) : '·'}
                      </button>
                    </td>
                  );
                })}
                <td className="ts-total">{fmtHM(total)}</td>
                <td className="ts-goal">
                  {goal ? (
                    <div className="goal-mini" title={t('ts.plannedThisWeek')}>
                      <div className="goal-mini-track">
                        <div style={{ width: `${pct}%`, background: p.color }} />
                      </div>
                      <span className={total >= goal ? 'pos' : 'muted'}>
                        {fmtHM(total)} / {fmtHM(goal)}
                      </span>
                    </div>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
              </tr>
            );
          })}
          <tr className="ts-add-row">
            <td className="ts-project" colSpan={10}>
              <AddRow exclude={new Set(sheet.rows.map((r) => r.id))} onAdd={(id) => setExtraRows((r) => [...r, id])} />
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr className="ts-sum">
            <td className="ts-project">{t('tracked')}</td>
            {days.map((d) => {
              // Clocked in but not yet assigned to a project: what's left to fill in afterwards.
              const w = data.workdays.find((x) => x.date === d);
              const open = w && !w.off ? workdayMs(w, now) - sheet.dayTotal(d) : 0;
              return (
                <td key={d} className={`ts-cell ${d === today ? 'today' : ''} ${isWeekend(d) ? 'weekend' : ''}`}>
                  {sheet.dayTotal(d) ? fmtHM(sheet.dayTotal(d)) : ''}
                  {open >= 15 * 60_000 && (
                    <button className="ts-open" onClick={() => openDay(d)} title={t('ts.toAssignHint')}>
                      {t('ts.toAssign', { duration: fmtHM(open) })}
                    </button>
                  )}
                </td>
              );
            })}
            <td className="ts-total">{fmtHM(weekTracked)}</td>
            <td className="ts-goal small">{t('ts.clockedTarget', { worked: fmtHM(weekAtWork), duration: fmtDuration(weekTarget(data, days)) })}</td>
          </tr>
        </tfoot>
      </table>
      {!done && <p className="ts-hint muted small">{t('ts.hint')}</p>}
    </section>
    </div>
  );
}
