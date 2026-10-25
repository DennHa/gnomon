// Today: live tracking. The timer comes first; today's plan and entries follow; "Close the day" appears after you leave.
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { activitiesOn, addEntry, isOnBreak, runningEntry, startTimer, stopTimer, switchActivity, todayWorkday, updateEntry, type TimerInput } from '../actions';
import { ActivityChips, BillableToggle, ProjectSelect, TrailSummary } from '../components';
import { EntryFeed, TaskPicker } from '../feed';
import { Icon } from '../icons';
import { dayKey, entryMs, fmtClock, fmtDayLong, useNow } from '../time';
import { CopyAsText, DayReview, ProjectGoals, StaleBanner } from './day';
import { t } from '../i18n';
import { prettyAccel } from '../shortcuts';
import { isWeb } from '../platform';

function greeting(now: number) {
  const h = new Date(now).getHours();
  return t(h < 11 ? 'today.morning' : h < 17 ? 'today.afternoon' : 'today.evening');
}

/** What you can start from the field: today's plan first, then recent work (description + project), filtered as you type. */
function useSuggestions(query: string) {
  const { data } = useStore();
  return useMemo(() => {
    const today = dayKey(Date.now());
    const seen = new Set<string>();
    const out: (TimerInput & { label: string; sub: string; color?: string })[] = [];
    const push = (x: TimerInput & { sub: string }) => {
      const label = x.description || x.taskName || '';
      const key = `${label.toLowerCase()}|${x.projectId ?? ''}`;
      if (!label || seen.has(key)) return;
      seen.add(key);
      out.push({ ...x, label, color: data.projects.find((p) => p.id === x.projectId)?.color });
    };
    const projectName = (id?: string) => data.projects.find((p) => p.id === id)?.name ?? t('noProject');
    for (const item of data.plan.filter((i) => i.days.includes(today)))
      push({ description: item.name, projectId: item.projectId, taskId: item.floatId, taskName: item.name, sub: `${projectName(item.projectId)} · ${t('sugg.planned', { hours: item.hoursPerDay })}` });
    for (const e of [...data.entries].reverse().slice(0, 300))
      push({ description: e.description, projectId: e.projectId, activityId: e.activityId, taskId: e.taskId, taskName: e.taskName, billable: e.billable, sub: projectName(e.projectId) });
    const q = query.trim().toLowerCase();
    return (q ? out.filter((o) => o.label.toLowerCase().includes(q) || o.sub.toLowerCase().includes(q)) : out).slice(0, 7);
  }, [data.plan, data.entries, data.projects, query]);
}

function TimerHero({ onOpenProjects }: { onOpenProjects: () => void }) {
  const { data, update } = useStore();
  const now = useNow();
  const running = runningEntry(data);
  const [draft, setDraft] = useState<TimerInput>({ description: '' });
  const current: TimerInput = running ?? draft;
  const edit = (p: Partial<TimerInput>) => (running ? update((d) => updateEntry(d, running.id, p)) : setDraft({ ...draft, ...p }));
  const project = data.projects.find((p) => p.id === current.projectId);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(-1);
  const suggestions = useSuggestions(running ? '' : current.description);

  const start = (input: TimerInput) => {
    update((d) => startTimer(d, input));
    setDraft({ description: '' });
    setOpen(false);
  };
  const toggle = () => {
    if (running) return update(stopTimer);
    // Re-use project/activity from the last entry with the same description.
    const prev = !draft.projectId && [...data.entries].reverse().find((e) => e.description && e.description === draft.description);
    start(prev ? { ...draft, projectId: prev.projectId, activityId: draft.activityId ?? prev.activityId, billable: prev.billable } : draft);
  };
  const pick = (i: number) => {
    const { label: _l, sub: _s, color: _c, ...input } = suggestions[i];
    if (running) edit({ description: input.description, projectId: input.projectId, taskId: input.taskId, taskName: input.taskName });
    else setDraft({ ...draft, ...input });
    setOpen(false);
  };
  const pickActivity = (id: string) => (running ? update((d) => switchActivity(d, id)) : setDraft({ ...draft, activityId: draft.activityId === id ? undefined : id }));
  const showSuggestions = open && !running && suggestions.length > 0;

  return (
    <section className={`card hero ${running ? 'running' : ''}`} style={running && project ? ({ '--accent-live': project.color } as React.CSSProperties) : undefined}>
      {/* One row: the field, the time and the button, aligned. */}
      <div className="hero-bar">
        <div className="hero-field">
          <input
            className="hero-input"
            placeholder={t('today.whatNow')}
            value={current.description}
            onChange={(e) => (edit({ description: e.target.value }), setOpen(true), setSel(-1))}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (showSuggestions && e.key === 'ArrowDown') (e.preventDefault(), setSel((sel + 1) % suggestions.length));
              else if (showSuggestions && e.key === 'ArrowUp') (e.preventDefault(), setSel((sel - 1 + suggestions.length) % suggestions.length));
              else if (e.key === 'Escape') setOpen(false);
              else if (e.key === 'Enter') {
                if (showSuggestions && sel >= 0) pick(sel);
                else if (!running) toggle();
              }
            }}
            role="combobox"
            aria-expanded={showSuggestions}
            aria-autocomplete="list"
          />
          {/* Project and task sit inside the field: one shape that reads as "what, on which project". */}
          <div className="hero-meta">
            <ProjectSelect value={current.projectId} onChange={(projectId) => edit({ projectId, taskId: undefined, taskName: undefined })} />
            <TaskPicker projectId={current.projectId} day={dayKey(now)} value={current.taskId} name={current.taskName} onChange={(taskId, taskName) => edit({ taskId, taskName })} />
            <BillableToggle value={current.billable} onChange={(billable) => edit({ billable })} />
          </div>
          {showSuggestions && (
            <ul className="hero-suggest" role="listbox">
              {suggestions.map((sg, i) => (
                <li key={`${sg.label}|${sg.projectId}`} role="option" aria-selected={i === sel} className={i === sel ? 'sel' : ''} onMouseDown={(e) => (e.preventDefault(), pick(i))}>
                  <span className="dot" style={{ background: sg.color ?? 'var(--muted)' }} />
                  <span className="hs-label">{sg.label}</span>
                  <span className="muted small">{sg.sub}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className={`hero-clock ${isOnBreak(todayWorkday(data)) ? 'resting' : ''}`}>{fmtClock(running ? entryMs(running, now) : 0)}</span>
        <button className={`hero-btn ${running ? 'stop' : 'start'}`} onClick={toggle} title={t(running ? 'today.stop' : 'today.start', { key: prettyAccel(data.settings.shortcuts.stopResume) })}>
          {/* Keyed, so the icon re-enters with a small turn when play becomes stop and back. */}
          <Icon key={running ? 'stop' : 'play'} name={running ? 'stop' : 'play_arrow'} size={28} className="morph" />
        </button>
      </div>
      {/* Activities on their own row, so they wrap cleanly. */}
      {activitiesOn(data) && (
        <div className="hero-activities">
          <span className="muted small">{t(running ? 'today.switchTo' : 'activity')}</span>
          <ActivityChips value={current.activityId} onPick={pickActivity} onEdit={onOpenProjects} />
        </div>
      )}
    </section>
  );
}

export default function Today({ onOpenDay, onOpenProjects }: { onOpenDay: (d: string) => void; onOpenProjects: () => void }) {
  const { data, update } = useStore();
  const now = useNow(60_000);
  const today = dayKey(now);
  const wd = todayWorkday(data);
  // Oldest first, like a day reads; the newest entry and the Add button sit at the bottom.
  const entries = data.entries.filter((e) => dayKey(e.start) === today).sort((a, b) => a.start.localeCompare(b.start));
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
      <TimerHero onOpenProjects={onOpenProjects} />
      <ProjectGoals day={today} />
      <section className="card">
        <div className="card-head">
          <h3>{t('entries')}</h3>
          <span className="card-head-end">
            {entries.length > 0 && <CopyAsText days={[today]} />}
            <span className="muted">{t('today.totalTime', { time: fmtClock(tracked) })}</span>
          </span>
        </div>
        {entries.length === 0 && <p className="muted empty-state">{isWeb() ? t('today.emptyWeb') : t('today.empty', { key: prettyAccel(data.settings.shortcuts.quick) || '—' })}</p>}
        <EntryFeed day={today} entries={entries} mode="times" />
        <button className="link-add" onClick={() => update((d) => addEntry(d, today))}>
          + {t('today.addEntry')}
        </button>
      </section>
      {data.settings.activityTrail && (
        <section className="quiet-section">
          <TrailSummary day={today} live title={t('trail.today')} />
        </section>
      )}
      {wd?.end && !wd.off && (
        <section className="plain-section" id="day-review">
          <DayReview day={today} title={t('today.closeDay')} />
        </section>
      )}
    </div>
  );
}
