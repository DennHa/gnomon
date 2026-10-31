// "Check these days": the days that look off (src/daycheck.ts), each with its fix or "It's right". Nothing changes without
// a choice. The sidebar offers the list until it's gone through; Reports can open it later.
import { useEffect, useMemo, useRef, useState } from 'react';
import { fixLeave } from '../actions';
import { confirmDay, daysToCheck, leaveSuggestion, sidebarDays, type CheckDay, type CheckReason } from '../daycheck';
import { Icon } from '../icons';
import { useLeaveEdit } from '../notes';
import { useStore } from '../store';
import { atTime, fmtDayLabel, fmtHM, toTimeInput, useNow } from '../time';
import { t } from '../i18n';
import { Modal } from './Timesheet';
import type { Data } from '../types';

export function useDaysToCheck() {
  const { data } = useStore();
  const now = useNow(60_000);
  return useMemo(() => daysToCheck(data, now), [data, Math.floor(now / 3_600_000)]);
}

const reasonText = (r: CheckReason): { tag: string; detail?: string; strong?: boolean } => {
  if (r.kind === 'timer') return { tag: t('check.timer') };
  if (r.kind === 'closed') return { tag: t('check.closed'), detail: t('check.closedDetail') };
  if (r.kind === 'crossing') return { tag: t('check.crossing'), strong: true };
  if (r.kind === 'overlap') return { tag: t('check.overlap'), detail: t('check.overlapDetail', { time: fmtHM(r.ms) }), strong: true };
  if (r.kind === 'long') return { tag: t('check.long'), detail: t('check.clocked', { time: fmtHM(r.worked) }) };
  return { tag: t('check.overbooked'), detail: t('check.overbookedDetail', { booked: fmtHM(r.booked), clocked: fmtHM(r.clocked) }) };
};

/** The leave time to offer: one already corrected by hand, else the usual guess. */
function suggestion(d: Data, date: string): string {
  const wd = d.workdays.find((w) => w.date === date);
  return wd?.end && !wd.autoClosed && toTimeInput(wd.end) < '23:58' ? toTimeInput(wd.end) : leaveSuggestion(d, date);
}

function Row({ day, onOpenDay }: { day: CheckDay; onOpenDay: (d: string) => void }) {
  const { data, update } = useStore();
  const leaveEdit = useLeaveEdit();
  const [at, setAt] = useState(() => suggestion(data, day.date));
  const wd = data.workdays.find((w) => w.date === day.date);
  const iso = at ? atTime(day.date, at) : '';
  const valid = Boolean(iso) && (!wd || iso > wd.start);
  return (
    <div className="check-row-day">
      <strong className="small">{fmtDayLabel(day.date)}</strong>
      <span className="check-reasons">
        {day.reasons.map(reasonText).map((r) => (
          <span key={r.tag}>
            <span className={`check-tag ${r.strong ? 'strong' : ''}`}>{r.tag}</span>
            {r.detail && <span className="muted small"> {r.detail}</span>}
          </span>
        ))}
      </span>
      <span className="check-actions">
        {day.fix && (
          <>
            <input className="time-field" type="time" value={at} aria-label={t('check.leaveTime')} onChange={(e) => setAt(e.target.value)} />
            <button className="btn small" disabled={!valid} onClick={() => leaveEdit(day.date, (d) => fixLeave(d, day.date, iso))}>
              {t(day.reasons.some((r) => r.kind === 'timer') ? 'check.setCut' : 'check.set')}
            </button>
          </>
        )}
        <button className="btn small" onClick={() => onOpenDay(day.date)}>
          {t('check.openDay')}
        </button>
        <button className="btn ghost small" onClick={() => update((d) => confirmDay(d, day.date))}>
          {t('cor.longOk')}
        </button>
      </span>
    </div>
  );
}

export function DayCheckList({ onOpenDay, onClose }: { onOpenDay: (d: string) => void; onClose: () => void }) {
  const { update } = useStore();
  const days = useDaysToCheck();
  const had = useRef(days.length > 0);
  // Gone through: the sidebar has nothing more to offer.
  useEffect(() => {
    if (days.length) had.current = true;
    else if (had.current) update((d) => ({ ...d, settings: { ...d.settings, dayCheckDone: true } }));
  }, [days.length]);
  return (
    <Modal wide onClose={onClose} title={<strong>{t('check.title')}</strong>}>
      <p className="muted small">{days.length ? t('check.intro', { n: days.length }) : t('check.none')}</p>
      {days.length > 0 && (
        <div className="check-list">
          {days.map((day) => (
            <Row key={day.date} day={day} onOpenDay={onOpenDay} />
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Sidebar, until the list is gone through or put away. */
export function DayCheckSidebar({ onOpen }: { onOpen: () => void }) {
  const { data, update } = useStore();
  const days = sidebarDays(data, useDaysToCheck());
  if (data.settings.dayCheckDone || !days.length) return null;
  return (
    <div className="corridor-side">
      <div className="corridor-ask">
        <span className="small">
          <Icon name="warning" size={16} /> {t('check.side', { n: days.length })}
        </span>
        <span className="corridor-ask-actions">
          <button className="btn small" onClick={onOpen}>
            {t('check.open')}
          </button>
          <button className="btn ghost small" onClick={() => update((d) => ({ ...d, settings: { ...d.settings, dayCheckDone: true } }))} title={t('check.dismissHint')}>
            {t('check.dismiss')}
          </button>
        </span>
      </div>
    </div>
  );
}
