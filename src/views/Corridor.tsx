// The target corridor (src/corridor.ts) on screen: the Reports card with its chart, the one-line status for the sidebar
// and the menu bar, and the sidebar's question about scheduled days without a record.
import { useMemo } from 'react';
import { Icon } from '../icons';
import { useStore } from '../store';
import { markDayOff } from '../actions';
import { corridorOf, type Corridor, type Zone } from '../corridor';
import { targetHoursOn } from '../schedule';
import { addDays, dayKey, fmtDate, fmtDayLabel, useNow } from '../time';
import { locale, t } from '../i18n';
import type { Data } from '../types';

const H = 3_600_000;
const num = (v: number) => new Intl.NumberFormat(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);
const sign = (v: number) => (Math.round(v * 10) === 0 ? '' : v < 0 ? '−' : '+');
/** −6.7 % */
export const fmtPct = (pct: number) => `${sign(pct)}${num(Math.abs(pct))} %`;
/** −1.8 h (signed) or 40.0 h */
const fmtH = (ms: number, signed = false) => `${signed ? sign(ms / H) : ''}${num(Math.abs(ms) / H)} h`;
const ZONE_ICON: Record<Zone, 'check_circle' | 'warning' | 'error'> = { within: 'check_circle', elevated: 'warning', critical: 'error' };

/** "4 weeks: −6.7 % · within", for the sidebar and the menu bar. */
export function corridorShort(c: Corridor): string {
  if (!c.rolling) return t('cor.shortNone');
  return t('cor.short', { n: c.rules.weeks, pct: fmtPct(c.rolling.pct), zone: t(`cor.zone.${c.rolling.zone}`) });
}

/** The company's note, or Gnomon's own (naming Personio when absences come from there). */
function noteFor(d: Data): string {
  const own = d.settings.companyHours?.note?.trim();
  if (own) return own;
  const personio = Boolean(d.settings.personioPersonId) || d.workdays.some((w) => w.offSource === 'personio');
  return t(personio ? 'cor.notePersonio' : 'cor.noteDefault');
}

/** The rolling average week by week: ±(at least 20 %) around the target, the "within" band shaded, gaps for weeks without data. */
function CorridorChart({ c: all }: { c: Corridor }) {
  // Start where the data starts (a newcomer's first months aren't gaps), but always show at least 8 weeks.
  const first = all.points.findIndex((p) => p.pct !== null);
  const c = { ...all, points: all.points.slice(Math.max(0, Math.min(first < 0 ? Infinity : first, all.points.length - 8))) };
  const W = 640;
  const HT = 190;
  const left = 44;
  const right = 52;
  const top = 10;
  const bottom = 24;
  const max = Math.max(20, Math.ceil((c.rules.critical * 1.25) / 5) * 5);
  const x = (i: number) => left + (i * (W - left - right)) / Math.max(1, c.points.length - 1);
  const y = (pct: number) => top + ((max - Math.max(-max, Math.min(max, pct))) / (2 * max)) * (HT - top - bottom);
  const runs: { i: number; pct: number }[][] = [];
  c.points.forEach((p, i) => {
    if (p.pct === null) return void runs.push([]);
    if (!runs.length) runs.push([]);
    runs[runs.length - 1].push({ i, pct: p.pct });
  });
  const lastIndex = c.points.map((p) => p.pct !== null).lastIndexOf(true);
  const ticks = [max, c.rules.within, 0, -c.rules.within, -max];
  // A month label on the first week that starts in it, every other month when they'd crowd.
  const months = c.points.flatMap((p, i) => (i === 0 || p.monday.slice(5, 7) !== c.points[i - 1].monday.slice(5, 7) ? [{ i, label: fmtDate(p.monday, { month: 'short' }) }] : [])).filter((_, k, all) => all.length <= 8 || k % 2 === 0);
  return (
    <svg className="corridor-chart" viewBox={`0 0 ${W} ${HT}`} role="img" aria-label={t('cor.chart', { n: c.rules.weeks })}>
      <rect className="band" x={left} y={y(c.rules.within)} width={W - left - right} height={y(-c.rules.within) - y(c.rules.within)} />
      {ticks.map((v) => (
        <g key={v}>
          <line className={v === 0 ? 'zero' : 'grid'} x1={left} x2={W - right} y1={y(v)} y2={y(v)} />
          <text className="tick" x={left - 6} y={y(v) + 4} textAnchor="end">
            {v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v)} %`}
          </text>
        </g>
      ))}
      {months.map((m) => (
        <text key={m.i} className="tick" x={x(m.i)} y={HT - 6} textAnchor="middle">
          {m.label}
        </text>
      ))}
      {runs.filter((r) => r.length > 1).map((r) => (
        <polyline key={r[0].i} className="line" points={r.map((p) => `${x(p.i)},${y(p.pct)}`).join(' ')} />
      ))}
      {c.points.map((p, i) =>
        p.pct === null ? null : (
          <circle key={p.monday} className={`dot ${p.zone}`} cx={x(i)} cy={y(p.pct)} r={i === lastIndex ? 5 : 3.5}>
            <title>{`${fmtDayLabel(p.monday)}: ${fmtPct(p.pct)}`}</title>
          </circle>
        ),
      )}
      {lastIndex >= 0 && (
        <text className="last" x={x(lastIndex) + 9} y={y(c.points[lastIndex].pct!) + 4}>
          {fmtPct(c.points[lastIndex].pct!)}
        </text>
      )}
    </svg>
  );
}

/** Reports in corridor mode: in place of the overtime balance. */
export function CorridorCard({ info }: { info: (text: string) => JSX.Element }) {
  const { data } = useStore();
  const now = useNow(60_000);
  const c = useMemo(() => corridorOf(data, now), [data, now]);
  const { rules, rolling, current } = c;
  const sources = [
    c.daysOff.float && t('cor.fromFloat', { n: c.daysOff.float }),
    c.daysOff.personio && t('cor.fromPersonio', { n: c.daysOff.personio }),
    c.daysOff.manual && t('cor.fromYou', { n: c.daysOff.manual }),
  ].filter(Boolean);
  const absent = current.daysOff.reduce((s, o) => s + o.hours, 0);
  const reasons = [...new Set(current.daysOff.map((o) => o.reason?.trim()).filter(Boolean))];
  const banner = rolling && (
    <p className={`corridor-banner ${rolling.zone}`}>
      <Icon name={ZONE_ICON[rolling.zone]} size={18} />
      <span>
        <strong>{t(`cor.${rolling.zone}`)}</strong>{' '}
        {t(rolling.zone === 'within' ? 'cor.bannerWithin' : rolling.zone === 'elevated' ? 'cor.bannerElevated' : 'cor.bannerCritical', {
          n: rules.weeks,
          pct: fmtPct(rolling.pct),
          within: rules.within,
          critical: rules.critical,
          basis: t('cor.basis', { n: rolling.basis }),
        })}
      </span>
    </p>
  );
  return (
    <section className="card corridor">
      <div className="balance-head">
        <h3>
          <Icon name="target" size={20} /> {t('cor.title')}
          {info(t('cor.explain'))}
        </h3>
        <span className="muted small">{sources.length ? t('cor.daysOff', { list: sources.join(' · ') }) : t('cor.daysOffNone')}</span>
      </div>
      <div className="corridor-tiles">
        <div className="corridor-tile">
          <span className="muted small">{t('cor.avg', { n: rules.weeks })}</span>
          <strong className={rolling ? `zone-${rolling.zone}` : ''}>{rolling ? fmtH(rolling.avgPerWeek, true) : '–'}</strong>
          <span className="muted small">{rolling ? t('cor.avgSub', { pct: fmtPct(rolling.pct), basis: t('cor.basis', { n: rolling.basis }) }) : t('cor.noData')}</span>
        </div>
        <div className="corridor-tile">
          <span className="muted small">{t('cor.current')}</span>
          <strong>{fmtH(current.worked - current.targetToDate, true)}</strong>
          <span className="muted small">{t('cor.currentSub', { worked: fmtH(current.worked), target: fmtH(current.targetToDate), week: fmtH(current.target) })}</span>
        </div>
        <div className="corridor-tile">
          <span className="muted small">{t('cor.absences')}</span>
          <strong>{absent ? fmtH(absent) : '0 h'}</strong>
          <span className="muted small">{current.daysOff.length ? [t('count.daysOff', { n: current.daysOff.length }), ...reasons].join(' · ') : t('cor.noAbsences')}</span>
        </div>
      </div>
      {banner}
      <CorridorChart c={c} />
      <div className="corridor-legend muted small">
        <span><i className="dot within" /> {t('cor.zWithin', { within: rules.within })}</span>
        <span><i className="dot elevated" /> {t('cor.zElevated', { within: rules.within, critical: rules.critical })}</span>
        <span><i className="dot critical" /> {t('cor.zCritical', { critical: rules.critical })}</span>
      </div>
      <p className="corridor-note muted small">{noteFor(data)}</p>
    </section>
  );
}

/** Sidebar, only when there's something to do: the latest scheduled day (or week) without a record, and the status when it's outside the corridor. */
export function CorridorSidebar({ onOpenDay }: { onOpenDay: (day: string) => void }) {
  const { data, update } = useStore();
  const now = useNow(60_000);
  const c = useMemo(() => corridorOf(data, now, 1), [data, now]);
  const day = c.ask.days[c.ask.days.length - 1];
  const week = !day ? c.ask.weeks[c.ask.weeks.length - 1] : undefined;
  const more = c.ask.days.length + c.ask.weeks.length - 1;
  const weekOff = (monday: string) =>
    update((d) => {
      let next = d;
      for (let i = 0; i < 7; i++) {
        const date = dayKey(addDays(new Date(`${monday}T12:00`), i));
        if (targetHoursOn(d, date) > 0) next = markDayOff(next, date);
      }
      return next;
    });
  const attention = c.rolling && c.rolling.zone !== 'within';
  if (!day && !week && !attention) return null;
  return (
    <div className="corridor-side">
      {(day || week) && (
        <div className="corridor-ask" title={t('cor.missingHint')}>
          <span className="small">
            <Icon name="event_busy" size={16} /> {day ? t('cor.missingDay', { day: fmtDayLabel(day) }) : t('cor.missingWeek', { day: fmtDayLabel(week!) })}
            {more > 0 && <span className="muted"> · {t('cor.more', { n: more })}</span>}
          </span>
          <span className="corridor-ask-actions">
            <button className="btn small" onClick={() => onOpenDay(day ?? week!)}>
              {t('cor.addHours')}
            </button>
            <button className="btn ghost small" onClick={() => (day ? update((d) => markDayOff(d, day)) : weekOff(week!))}>
              {t(day ? 'cor.dayOff' : 'cor.weekOff')}
            </button>
          </span>
        </div>
      )}
      {/* Only when it needs attention: inside the corridor, Reports and the menu bar say so. */}
      {attention && (
        <span className={`corridor-status small zone-${c.rolling!.zone}`}>
          <Icon name="target" size={16} /> {corridorShort(c)}
        </span>
      )}
    </div>
  );
}
