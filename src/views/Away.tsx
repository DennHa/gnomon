// The question after you were away, in the app window. The facts come from stored data (src/actions.ts, Time away), so it
// comes back after a restart. Nothing is preselected and Esc only postpones: the time stays as it is until you answer.
import { useEffect, useRef, useState } from 'react';
import { awayChoices, awayOverMidnight, awayResult, pendingAway, resolveAway, type AwayChoice } from '../actions';
import { Icon } from '../icons';
import { useLeaveEdit } from '../notes';
import { useStore } from '../store';
import { atTime, dayKey, fmtDate, fmtDuration, fmtHM, fmtTime, toTimeInput, useNow } from '../time';
import { t } from '../i18n';
import type { Away } from '../types';

/** After Later: how long until it asks again by itself. The sidebar and the menu bar can bring it back sooner. */
const LATER_MS = 30 * 60_000;

export const showAway = () => window.dispatchEvent(new Event('gnomon:show-away'));

function Question({ away, onLater }: { away: Away; onLater: () => void }) {
  const { data } = useStore();
  const leaveEdit = useLeaveEdit();
  const date = dayKey(away.since);
  const [stopAt, setStopAt] = useState(toTimeInput(away.since));
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => boxRef.current?.focus(), []);
  // On top of the day panel: Esc postpones this and leaves the panel open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (e.stopImmediatePropagation(), onLater());
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onLater]);

  const back = away.back!;
  const night = awayOverMidnight(away);
  const entry = data.entries.find((e) => e.id === away.entryId);
  const wd = data.workdays.find((w) => w.date === date && !w.off);
  const project = data.projects.find((p) => p.id === entry?.projectId);
  const label = entry && ([entry.description || entry.taskName, project?.name].filter(Boolean).join(' · ') || t('timer'));
  const weekday = (iso: string) => (night ? `, ${fmtDate(dayKey(iso), { weekday: 'short' })}` : '');
  const goneMs = Date.parse(back) - Date.parse(away.since);
  const gone = goneMs < 3_600_000 ? `${Math.round(goneMs / 60_000)} min` : fmtDuration(goneMs);
  const stopIso = stopAt ? atTime(date, stopAt) : away.since;
  const choices = awayChoices(data, away);
  const clockedIn = Boolean(wd && !wd.fromEntries);

  const result = (c: AwayChoice) => {
    const r = awayResult(data, away, c, c === 'stop' ? stopIso : undefined);
    const dayName = night ? fmtDate(date, { weekday: 'short' }) : t('away.day');
    const parts = [r.timer !== undefined && t('away.timer', { time: fmtHM(r.timer) }), clockedIn && r.day !== undefined && `${dayName} ${fmtHM(r.day)}`].filter(Boolean).join(' · ');
    const goesOn = entry && !entry.end && (c === 'break' || c === 'remove');
    return goesOn ? `${parts}${t('away.runsOn')}` : c === 'stop' && !night ? `${parts}${t(clockedIn ? 'away.closed' : 'away.stopped')}` : parts;
  };
  const text = (c: AwayChoice) => (c === 'working' ? t(night ? 'away.untilMidnight' : entry ? 'away.working' : 'away.workingNoTimer') : c === 'break' ? t('away.break') : t('away.remove'));
  const answer = (c: AwayChoice) => leaveEdit(date, (d) => resolveAway(d, away, c, c === 'stop' ? stopIso : undefined));
  const stopParts = t(night ? 'away.stopNight' : clockedIn ? 'away.stopClose' : 'away.stop', { day: fmtDate(date, { weekday: 'long' }) }).split('{time}');

  return (
    <div className="modal-backdrop away-backdrop">
      <div className="modal away" role="alertdialog" aria-modal="true" aria-labelledby="away-title" tabIndex={-1} ref={boxRef}>
        <h3 id="away-title">{t(night ? 'away.titleNight' : 'away.title', { away: gone })}</h3>
        <div className="away-facts">
          <div>
            <span className="muted small">
              {t(`away.${away.reason}`)}
              {weekday(away.since)}
            </span>
            <strong>{fmtTime(away.since)}</strong>
          </div>
          <Icon name="chevron_right" size={20} className="muted" />
          <div>
            <span className="muted small">
              {t('away.back')}
              {weekday(back)}
            </span>
            <strong>{fmtTime(back)}</strong>
          </div>
        </div>
        <p className="away-task">
          {entry ? (
            <>
              <span className="dot" style={{ background: project?.color ?? '#B0BEC5' }} /> <strong>{label}</strong>
              <span className="muted small">
                {' · '}
                {night ? t('away.ranFrom', { time: fmtTime(entry.start), day: fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short' }) }) : t(clockedIn ? 'away.runningSince' : 'away.runningNoDay', { time: fmtTime(entry.start) })}
              </span>
            </>
          ) : (
            wd && <span className="muted small">{t('away.clockedIn', { time: fmtTime(wd.start) })}</span>
          )}
        </p>
        {night && (wd?.autoClosed || entry?.autoStopped) && <p className="muted small away-note">{t('away.midnightNote')}</p>}
        <p className="away-ask">{t('away.ask')}</p>
        <div className="away-choices">
          {choices.map((c) =>
            c === 'stop' ? (
              // A row with a time field in it, so a div: a button can't hold an input.
              <div key={c} className="away-choice" role="button" tabIndex={0} onClick={() => answer(c)} onKeyDown={(e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), answer(c))}>
                <span>
                  {stopParts[0]}
                  <input className="time-field" type="time" value={stopAt} aria-label={t('away.stopTime')} onClick={(e) => e.stopPropagation()} onChange={(e) => setStopAt(e.target.value)} />
                  {stopParts[1]}
                </span>
                <span className="away-result">{result(c)}</span>
              </div>
            ) : (
              <button key={c} className="away-choice" onClick={() => answer(c)}>
                <span>{text(c)}</span>
                <span className="away-result">{result(c)}</span>
              </button>
            ),
          )}
        </div>
        <div className="away-foot">
          <span className="muted small">{t('away.laterHint')}</span>
          <button className="btn small" onClick={onLater}>
            {t('away.later')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AwayPanel() {
  const { data } = useStore();
  const now = useNow(60_000);
  const away = pendingAway(data);
  const [laterUntil, setLaterUntil] = useState(0);
  useEffect(() => {
    const show = () => setLaterUntil(0);
    window.addEventListener('gnomon:show-away', show);
    return () => window.removeEventListener('gnomon:show-away', show);
  }, []);
  if (!away || now < laterUntil) return null;
  return <Question key={away.since} away={away} onLater={() => setLaterUntil(Date.now() + LATER_MS)} />;
}
