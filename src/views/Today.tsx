// Today: live tracking. The timer comes first; today's plan and entries follow; "Close the day" appears after you leave.
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { addEntry, isOnBreak, runningEntry, startTimer, stopTimer, switchActivity, todayWorkday, updateEntry, type TimerInput } from '../actions';
import { ActivityChips, BillableToggle, ProjectSelect, TrailSummary } from '../components';
import { EntryFeed, TaskPicker } from '../feed';
import { Icon } from '../icons';
import { dayKey, entryMs, fmtClock, fmtDayLong, useNow } from '../time';
import { DayReview, ProjectGoals, StaleBanner } from './day';
import { t } from '../i18n';
import { prettyAccel } from '../shortcuts';

function greeting(now: number) {
  const h = new Date(now).getHours();
  return t(h < 11 ? 'today.morning' : h < 17 ? 'today.afternoon' : 'today.evening');
}

function TimerHero() {
  const { data, update } = useStore();
  const now = useNow();
  const running = runningEntry(data);
  const [draft, setDraft] = useState<TimerInput>({ description: '' });
  const current: TimerInput = running ?? draft;
  const edit = (p: Partial<TimerInput>) => (running ? update((d) => updateEntry(d, running.id, p)) : setDraft({ ...draft, ...p }));
  const project = data.projects.find((p) => p.id === current.projectId);

  const recent = useMemo(() => [...new Set([...data.entries].reverse().map((e) => e.description).filter(Boolean))].slice(0, 30), [data.entries]);

  const toggle = () => {
    if (running) return update(stopTimer);
    // Re-use project/activity from the last entry with the same description.
    const prev = !draft.projectId && [...data.entries].reverse().find((e) => e.description && e.description === draft.description);
    const input = prev ? { ...draft, projectId: prev.projectId, activityId: draft.activityId ?? prev.activityId, billable: prev.billable } : draft;
    update((d) => startTimer(d, input));
    setDraft({ description: '' });
  };

  const pickActivity = (id: string) => (running ? update((d) => switchActivity(d, id)) : setDraft({ ...draft, activityId: draft.activityId === id ? undefined : id }));

  return (
    <section className={`card hero ${running ? 'running' : ''}`} style={running && project ? ({ '--accent-live': project.color } as React.CSSProperties) : undefined}>
      <div className="hero-main">
        <div className="hero-left">
          <input
            className="hero-input"
            placeholder={t('today.whatNow')}
            value={current.description}
            list="recent-descriptions"
            onChange={(e) => edit({ description: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && !running && toggle()}
          />
          <datalist id="recent-descriptions">
            {recent.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <div className="hero-meta">
            <ProjectSelect value={current.projectId} onChange={(projectId) => edit({ projectId, taskId: undefined, taskName: undefined })} />
            <TaskPicker projectId={current.projectId} day={dayKey(now)} value={current.taskId} name={current.taskName} onChange={(taskId, taskName) => edit({ taskId, taskName })} />
            <BillableToggle value={current.billable} onChange={(billable) => edit({ billable })} />
          </div>
        </div>
        <span className={`hero-clock ${isOnBreak(todayWorkday(data)) ? 'resting' : ''}`}>{fmtClock(running ? entryMs(running, now) : 0)}</span>
        <button className={`hero-btn ${running ? 'stop' : 'start'}`} onClick={toggle} title={t(running ? 'today.stop' : 'today.start', { key: prettyAccel(data.settings.shortcuts.stopResume) })}>
          {/* Keyed, so the icon re-enters with a small turn when play becomes stop and back. */}
          <Icon key={running ? 'stop' : 'play'} name={running ? 'stop' : 'play_arrow'} size={30} className="morph" />
        </button>
      </div>
      <div className="hero-activities">
        <span className="muted small">{t(running ? 'today.switchTo' : 'activity')}</span>
        <ActivityChips value={current.activityId} onPick={pickActivity} />
      </div>
    </section>
  );
}

export default function Today({ onOpenDay }: { onOpenDay: (d: string) => void }) {
  const { data, update } = useStore();
  const now = useNow(60_000);
  const today = dayKey(now);
  const wd = todayWorkday(data);
  const entries = data.entries.filter((e) => dayKey(e.start) === today).sort((a, b) => b.start.localeCompare(a.start));
  const tracked = entries.reduce((s, e) => s + entryMs(e), 0);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{wd ? t('today') : greeting(now)}</h1>
          <span className="muted">{fmtDayLong(today)}</span>
        </div>
      </header>
      <StaleBanner onOpenDay={onOpenDay} />
      <TimerHero />
      <ProjectGoals day={today} />
      <section className="card">
        <div className="card-head">
          <h3>{t('entries')}</h3>
          <span className="muted">{t('today.totalTime', { time: fmtClock(tracked) })}</span>
        </div>
        {entries.length === 0 && <p className="muted empty-state">{t('today.empty', { key: prettyAccel(data.settings.shortcuts.quick) || '—' })}</p>}
        <EntryFeed day={today} entries={entries} mode="times" />
        <button className="btn ghost small" onClick={() => update((d) => addEntry(d, today))}>
          <Icon name="add" size={18} /> {t('today.addEntry')}
        </button>
      </section>
      {data.settings.activityTrail && (
        <section className="card">
          <TrailSummary day={today} live title={t('trail.today')} />
        </section>
      )}
      {wd?.end && !wd.off && (
        <section className="card" id="day-review">
          <DayReview day={today} title={t('today.closeDay')} />
        </section>
      )}
    </div>
  );
}
