import { Icon } from '../icons';
import { balanceByMonth, targetFor } from '../balance';
import { hoursMode } from '../corridor';
import { CorridorCard } from './Corridor';
import { targetHoursOn } from '../schedule';
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { activitiesOn } from '../actions';
import {
  addDays,
  breakMs,
  dayKey,
  entryMs,
  fmtDate,
  fmtDayLabel,
  fmtDuration,
  fmtHours,
  fmtTime,
  hoursToMs,
  startOfDay,
  startOfWeek,
  useNow,
  workdayMs,
} from '../time';
import { getLang, locale, t } from '../i18n';

type Range = 'week' | 'month';
const noProject = () => ({ id: '', name: t('noProject'), color: '#B0BEC5' });
const noActivity = () => ({ id: '', name: t('noActivity'), color: '#B0BEC5' });

type BreakdownRow = { id: string; name: string; color: string; ms: number };

function Breakdown({ title, rows, total }: { title: string; rows: BreakdownRow[]; total: number }) {
  return (
    <div className="breakdown">
      <h4>{title}</h4>
      {rows.length === 0 && <p className="muted">{t('rep.nothing')}</p>}
      {rows.map((r) => {
        const pct = total ? (r.ms / total) * 100 : 0;
        return (
          <div key={r.id} className="hbar">
            <span className="hbar-name">
              <span className="dot" style={{ background: r.color }} /> {r.name}
            </span>
            <div className="hbar-track">
              <div style={{ width: `${pct}%`, background: r.color }} />
            </div>
            <span className="hbar-val">
              {fmtDuration(r.ms)} <span className="muted">{pct.toFixed(0)}%</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A small ⓘ button that shows an explanation in a bubble; closes on a second click, Escape or clicking elsewhere. */
function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="info-tip" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button className="icon-btn" aria-expanded={open} aria-label={t('rep.explain')} onClick={() => setOpen(!open)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
        <Icon name="info" size={18} />
      </button>
      {open && (
        <span className="info-bubble" role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}

function rangeFor(kind: Range, offset: number): { from: Date; to: Date; label: string } {
  const now = new Date();
  if (kind === 'week') {
    const from = addDays(startOfWeek(now), offset * 7);
    const to = addDays(from, 7);
    const fmt = (d: Date) => d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
    return { from, to, label: `${fmt(from)} – ${fmt(addDays(to, -1))}` };
  }
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  return { from, to, label: from.toLocaleDateString(locale(), { month: 'long', year: 'numeric' }) };
}

// German spreadsheet apps expect ";" between columns (the comma is the decimal separator there).
function downloadCsv(name: string, rows: (string | number)[][]) {
  const sep = getLang() === 'de' ? ';' : ',';
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(sep)).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** The running overtime balance across all months, independent of the selected period. */
function OvertimeBalance({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { data } = useStore();
  const now = useNow(60_000);
  const { total, start, startDate, months } = useMemo(() => balanceByMonth(data, now), [data, now]);
  const signed = (ms: number) => `${ms >= 0 ? '+' : '−'}${fmtDuration(Math.abs(ms))}`;
  const monthLabel = (m: string) => new Date(`${m}-01T12:00`).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
  return (
    <section className="card balance">
      <div className="balance-head">
        <div>
          <h3>
            <Icon name="savings" size={20} /> {t('bal.title')}
            <InfoTip text={t('bal.explain')} />
          </h3>
          <button className="link-btn muted small" onClick={onOpenSettings} title={t('bal.startHint')}>
            {start !== 0 || startDate
              ? t('bal.start', { duration: signed(start), date: startDate ? new Date(`${startDate}T12:00`).toLocaleDateString(locale()) : '—' })
              : t('bal.setStart')}
            <Icon name="chevron_right" size={16} />
          </button>
        </div>
        <div className="balance-total">
          <span className="muted small">{t('bal.current')}</span>
          <strong className={total >= 0 ? 'pos' : 'neg'}>{signed(total)}</strong>
        </div>
      </div>
      {months.length === 0 ? (
        <p className="muted">{t('bal.empty')}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('bal.month')}</th>
              <th>{t('bal.target')}</th>
              <th>{t('bal.worked')}</th>
              <th>{t('bal.diff')}</th>
              <th>{t('bal.running')}</th>
            </tr>
          </thead>
          <tbody>
            {[...months].reverse().slice(0, 12).map((m) => (
              <tr key={m.month}>
                <td>{monthLabel(m.month)}</td>
                <td>{fmtDuration(m.target)}</td>
                <td>{fmtDuration(m.worked)}</td>
                <td className={m.diff >= 0 ? 'pos' : 'neg'}>{signed(m.diff)}</td>
                <td>
                  <strong className={m.running >= 0 ? 'pos' : 'neg'}>{signed(m.running)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function Reports({ onOpenDay, onOpenSettings }: { onOpenDay: (day: string) => void; onOpenSettings: () => void }) {
  const { data } = useStore();
  const now = useNow(30_000);
  const [kind, setKind] = useState<Range>('week');
  const [offset, setOffset] = useState(0);
  const { from, to, label } = rangeFor(kind, offset);
  const fromKey = dayKey(from);
  const toKey = dayKey(to);

  const report = useMemo(() => {
    const entries = data.entries.filter((e) => {
      const k = dayKey(e.start);
      return k >= fromKey && k < toKey;
    });
    const days: string[] = [];
    for (let d = startOfDay(from); d < to; d = addDays(d, 1)) days.push(dayKey(d));

    const projectOf = (id?: string) => data.projects.find((p) => p.id === id) ?? noProject();
    const perDay = new Map(days.map((d) => [d, new Map<string, number>()]));
    const activityOf = (id?: string) => data.activities.find((a) => a.id === id) ?? noActivity();
    const perProject = new Map<string, number>();
    const perActivity = new Map<string, number>();
    let billable = 0;
    for (const e of entries) {
      const ms = entryMs(e, now);
      const aid = activityOf(e.activityId).id;
      perActivity.set(aid, (perActivity.get(aid) ?? 0) + ms);
      if (e.billable) billable += ms;
      const pid = projectOf(e.projectId).id;
      const day = perDay.get(dayKey(e.start))!;
      day.set(pid, (day.get(pid) ?? 0) + ms);
      perProject.set(pid, (perProject.get(pid) ?? 0) + ms);
    }
    const tracked = [...perProject.values()].reduce((a, b) => a + b, 0);
    const workdays = data.workdays.filter((w) => w.date >= fromKey && w.date < toKey).sort((a, b) => a.date.localeCompare(b.date));
    const attended = workdays.reduce((s, w) => s + workdayMs(w, now), 0);
    const worked = workdays.filter((w) => !w.off);
    // Overtime-off days keep their target (they use the balance); normal days off don't.
    // The schedule's target on recorded days (overtime-off days keep theirs); with "count every scheduled day", also on
    // past scheduled days without a record.
    const recorded = new Set(workdays.map((w) => w.date));
    const today = dayKey(now);
    const target =
      workdays.reduce((sum, w) => sum + targetFor(data, w), 0) +
      (data.settings.countAllScheduledDays ? days.filter((d) => !recorded.has(d) && d < today).reduce((sum, d) => sum + hoursToMs(targetHoursOn(data, d)), 0) : 0);
    const dayTotals = days.map((d) => [...perDay.get(d)!.values()].reduce((a, b) => a + b, 0));
    return { entries, days, perDay, perProject, perActivity, billable, activityOf, tracked, workdays, daysWorked: worked.length, attended, target, projectOf, maxDay: Math.max(1, ...dayTotals) };
  }, [data, fromKey, toKey, from, to, now]);

  const exportCsv = () => {
    const hours = (ms: number) => (getLang() === 'de' ? fmtHours(ms).replace('.', ',') : fmtHours(ms));
    const head = t('csv.header').split('|');
    // With a name set in Settings, every row starts with it, so exports from several people can be combined.
    const name = data.settings.userName?.trim();
    const withName = (row: (string | number)[]) => (name ? [name, ...row] : row);
    const rows: (string | number)[][] = [withName(data.settings.billableEnabled ? head : head.filter((_, i) => i !== 6)).map((c, i) => (name && i === 0 ? t('csv.name') : c))];
    for (const e of [...report.entries].sort((a, b) => a.start.localeCompare(b.start))) {
      rows.push(withName([
        dayKey(e.start),
        fmtTime(e.start),
        e.end ? fmtTime(e.end) : '',
        hours(entryMs(e, now)),
        report.projectOf(e.projectId).name,
        e.activityId ? report.activityOf(e.activityId).name : '',
        ...(data.settings.billableEnabled ? [e.billable ? t('csv.yes') : ''] : []),
        e.description,
      ]));
    }
    rows.push([], withName(t('csv.attendance').split('|')).map((c, i) => (name && i === 0 ? t('csv.name') : c)));
    for (const w of report.workdays) {
      rows.push(withName(w.off ? [w.date, t('dayOff'), '', '', ''] : [w.date, fmtTime(w.start), w.end ? fmtTime(w.end) : '', hours(breakMs(w, now)), hours(workdayMs(w, now))]));
    }
    const slug = name ? `${name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '')}-` : '';
    downloadCsv(`gnomon-report-${slug}${fromKey}.csv`, rows);
  };

  const toRows = (m: Map<string, number>, of: (id?: string) => { name: string; color: string }): BreakdownRow[] =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id, ms]) => ({ id, ms, ...of(id || undefined) }));
  const projectRows = toRows(report.perProject, report.projectOf);
  const activityRows = toRows(report.perActivity, report.activityOf);
  const balance = report.attended - report.target;
  const corridor = hoursMode(data) === 'corridor';

  return (
    <div className="page">
      <div className="toolbar">
        <div className="segmented">
          {(['week', 'month'] as Range[]).map((k) => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => (setKind(k), setOffset(0))}>
              {t(k === 'week' ? 'rep.week' : 'rep.month')}
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={() => setOffset(offset - 1)} aria-label={t('rep.prev')}>
          ‹
        </button>
        <strong className="range-label">{label}</strong>
        <button className="icon-btn" onClick={() => setOffset(offset + 1)} disabled={offset >= 0} aria-label={t('rep.next')}>
          ›
        </button>
        <span className="spacer" />
        <button className="btn" onClick={exportCsv}>
          {t('rep.exportCsv')}
        </button>
      </div>

      <div className="stats">
        <div className="card stat">
          <span className="muted small">{t('tracked')}</span>
          <strong>{fmtDuration(report.tracked)}</strong>
          {data.settings.billableEnabled && report.billable > 0 && <span className="muted small">{t('rep.billable', { duration: fmtDuration(report.billable) })}</span>}
        </div>
        <div className="card stat">
          <span className="muted small">{t('atWork')}</span>
          <strong>{fmtDuration(report.attended)}</strong>
        </div>
        <div className="card stat">
          <span className="muted small">{t('rep.daysWorked')}</span>
          <strong>{report.daysWorked}</strong>
        </div>
        {corridor ? (
          <div className="card stat">
            <span className="muted small">{t('bal.target')}</span>
            <strong>{fmtDuration(report.target)}</strong>
          </div>
        ) : (
          <div className="card stat">
            <span className="muted small">{t('rep.balance')}</span>
            <strong className={balance >= 0 ? 'pos' : 'neg'}>
              {balance >= 0 ? '+' : ''}
              {fmtDuration(balance)}
            </strong>
          </div>
        )}
      </div>

      {/* The company's choice, or the Labs switch: the target corridor replaces the overtime balance. */}
      {corridor ? <CorridorCard info={(text) => <InfoTip text={text} />} /> : <OvertimeBalance onOpenSettings={onOpenSettings} />}

      <section className="card">
        <h3>{t('rep.timeTitle')}</h3>
        <h4>{t('rep.perDay')}</h4>
        <div className={`bars ${kind}`}>
          {report.days.map((d) => {
            const segs = [...report.perDay.get(d)!.entries()];
            const total = segs.reduce((s, [, ms]) => s + ms, 0);
            return (
              <button key={d} className="bar-col" title={`${fmtDayLabel(d)}: ${fmtDuration(total)}`} onClick={() => onOpenDay(d)}>
                <span className="bar-value">{total ? (kind === 'month' ? `${Math.max(1, Math.round(total / 3_600_000))}h` : fmtDuration(total)) : ''}</span>
                <div className="bar-track">
                  <div className="bar-stack" style={{ height: `${(total / report.maxDay) * 100}%` }}>
                    {segs.map(([pid, ms]) => (
                      <div key={pid} style={{ flexGrow: ms, background: report.projectOf(pid || undefined).color }} />
                    ))}
                  </div>
                </div>
                <span className="bar-label">
                  {kind === 'week' ? fmtDate(d, { weekday: 'short' }) : Number(d.slice(8))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="two-col breakdowns">
          <Breakdown title={t('rep.byProject')} rows={projectRows} total={report.tracked} />
          {activitiesOn(data) && <Breakdown title={t('rep.byActivity')} rows={activityRows} total={report.tracked} />}
        </div>
      </section>
    </div>
  );
}
