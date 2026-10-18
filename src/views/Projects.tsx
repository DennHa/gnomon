import { useState } from 'react';
import { Icon } from '../icons';
import { useStore } from '../store';
import { ACTIVITY_PRESETS, addActivity, addProject, applyActivityPreset, PROJECT_COLORS, removeActivity, removeProject, updateActivity, updateProject } from '../actions';
import { dayKey, entryMs, fmtDate, fmtDayLabel, fmtDuration, fmtTime, hoursToMs } from '../time';
import { timeWindow } from '../plan';
import type { ActivityPreset, Data, PlanItem, Project } from '../types';
import { t } from '../i18n';

const fmtShort = (d: string) => fmtDate(d, { day: 'numeric', month: 'short' });

/** Float plan for one project: each allocation with its dates, hours per day and what you tracked. */
function PlanList({ data, project }: { data: Data; project: Project }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const today = dayKey(new Date());
  const items = data.plan
    .filter((i) => i.projectId === project.id && i.endDate >= dayKey(new Date(Date.now() - 7 * 86_400_000)))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (!items.length && !project.floatId) return null;

  const entriesOn = (day: string) => data.entries.filter((e) => e.projectId === project.id && dayKey(e.start) === day);
  const trackedOn = (day: string) => entriesOn(day).reduce((s, e) => s + entryMs(e), 0);

  return (
    <div className="plan">
      <div className="plan-head muted small">
        <span className="badge">Float</span>
        {project.clientName && <span>{project.clientName}</span>}
        {!items.length && <span>{t('proj.nothingPlanned')}</span>}
      </div>
      {items.map((item: PlanItem) => {
        const planned = hoursToMs(item.hoursPerDay) * item.days.length;
        const tracked = item.days.reduce((s, d) => s + trackedOn(d), 0);
        const pct = planned ? Math.min(100, (tracked / planned) * 100) : 0;
        const window = timeWindow(item);
        const open = openId === item.floatId;
        return (
          <div key={item.floatId} className={`plan-item ${item.endDate < today ? 'past' : ''}`}>
            <button className="plan-row" onClick={() => setOpenId(open ? null : item.floatId)}>
              <span className="plan-name">
                {item.name || t('plannedWork')}
                {item.tentative && <span className="muted small">{t('proj.tentative')}</span>}
              </span>
              <span className="muted">
                {fmtShort(item.startDate)}
                {item.endDate !== item.startDate && ` – ${fmtShort(item.endDate)}`}
              </span>
              <span>
                {t('proj.perDay', { hours: item.hoursPerDay })}
                {window && <span className="muted"> · {window}</span>}
              </span>
              <span className="plan-progress">
                <span className="hbar-track">
                  <span style={{ width: `${pct}%`, background: project.color }} />
                </span>
                <span className="muted small">
                  {fmtDuration(tracked)} / {fmtDuration(planned)}
                </span>
              </span>
              <span className="muted">{open ? '▾' : '▸'}</span>
            </button>
            {item.notes && open && <p className="plan-notes muted small">{item.notes}</p>}
            {open && (
              <div className="plan-days">
                {item.days.map((d) => {
                  const done = trackedOn(d);
                  const goal = hoursToMs(item.hoursPerDay);
                  const spans = entriesOn(d)
                    .filter((e) => e.end)
                    .sort((a, b) => a.start.localeCompare(b.start))
                    .map((e) => `${fmtTime(e.start)}–${fmtTime(e.end!)}`);
                  return (
                    <div key={d} className={`plan-day ${d === today ? 'today' : ''}`}>
                      <span>{fmtDayLabel(d)}</span>
                      <span className="muted">
                        {t('proj.plannedDur', { duration: fmtDuration(goal) })}
                        {window && ` · ${window}`}
                      </span>
                      <span className={d > today ? 'muted' : done >= goal ? 'pos' : 'neg'}>{d > today ? '–' : t('proj.trackedDur', { duration: fmtDuration(done) })}</span>
                      <span className="muted small">{spans.join(', ')}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** "Custom" by default; picking a role swaps in its activity set (see applyActivityPreset). */
function RolePicker() {
  const { data, update } = useStore();
  const current = data.settings.activityPreset ?? 'custom';
  const pick = (value: string) => {
    if (value === 'custom' || value === current) return;
    const preset = value as ActivityPreset;
    if (!confirm(t('act.roleConfirm', { role: t(`role.${preset}`) }))) return;
    update((d) => applyActivityPreset(d, preset, t(`preset.${preset}`).split('|')));
  };
  return (
    <div className="role-picker">
      <label>
        <span>{t('act.role')}</span>
        <select value={current} onChange={(e) => pick(e.target.value)}>
          <option value="custom">{t('role.custom')}</option>
          {ACTIVITY_PRESETS.map((p) => (
            <option key={p} value={p}>
              {t(`role.${p}`)}
            </option>
          ))}
        </select>
      </label>
      <span className="muted small">{t('act.roleHint')}</span>
    </div>
  );
}

export default function Projects() {
  const { data, update } = useStore();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[data.projects.length % PROJECT_COLORS.length]);
  const [activity, setActivity] = useState('');

  const totalFor = (key: 'projectId' | 'activityId', id: string) =>
    data.entries.filter((e) => e[key] === id).reduce((s, e) => s + entryMs(e), 0);

  const submitProject = () => {
    if (!name.trim()) return;
    update((d) => addProject(d, name, color));
    setName('');
    setColor(PROJECT_COLORS[(data.projects.length + 1) % PROJECT_COLORS.length]);
  };
  const submitActivity = () => {
    if (!activity.trim() || data.activities.some((a) => a.name.toLowerCase() === activity.trim().toLowerCase())) return;
    update((d) => addActivity(d, activity));
    setActivity('');
  };

  return (
    <div className="page">
      <section className="card">
        <h3>{t('proj.projects')}</h3>
        <p className="muted small section-hint">{t('proj.projectsHint')}</p>
        <form className="add-row" onSubmit={(e) => (e.preventDefault(), submitProject())}>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label={t('proj.color')} />
          <input placeholder={t('proj.newPlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" type="submit">
            {t('proj.add')}
          </button>
        </form>
        {data.projects.length === 0 && <p className="muted">{t('proj.none')}</p>}
        <div className="list">
          {data.projects.map((p) => (
            <div key={p.id} className="project-block">
            <div className="list-row">
              <input type="color" value={p.color} onChange={(e) => update((d) => updateProject(d, p.id, { color: e.target.value }))} />
              <input className="grow" value={p.name} onChange={(e) => update((d) => updateProject(d, p.id, { name: e.target.value }))} />
              <label className="goal-field" title={t('proj.goalHint')}>
                <input
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  placeholder="–"
                  value={p.dailyGoalHours ?? ''}
                  onChange={(e) => update((d) => updateProject(d, p.id, { dailyGoalHours: Number(e.target.value) > 0 ? Number(e.target.value) : undefined }))}
                />
                <span className="muted small">{t('proj.goalUnit')}</span>
              </label>
              <span className="muted total-col">{fmtDuration(totalFor('projectId', p.id))}</span>
              <button
                className="icon-btn"
                title={t('delete')}
                onClick={() => confirm(t('proj.removeConfirm', { name: p.name })) && update((d) => removeProject(d, p.id))}
              >
                🗑
              </button>
            </div>
            <PlanList data={data} project={p} />
            </div>
          ))}
        </div>
      </section>

      {data.settings.activitiesEnabled === false ? (
        <section className="card onb-entry">
          <span className="onb-entry-text">
            <strong>{t('act.activities')}</strong>
            <span className="muted small">{t('act.offHint')}</span>
          </span>
          <button className="btn" onClick={() => update((d) => ({ ...d, settings: { ...d.settings, activitiesEnabled: true } }))}>
            {t('act.turnOn')}
          </button>
        </section>
      ) : (
      <section className="card">
        <h3>{t('act.activities')}</h3>
        <p className="muted small section-hint">
          {t('act.hint')}
        </p>
        <RolePicker />
        <form className="add-row" onSubmit={(e) => (e.preventDefault(), submitActivity())}>
          <input placeholder={t('act.newPlaceholder')} value={activity} onChange={(e) => setActivity(e.target.value)} />
          <button className="btn primary" type="submit">
            {t('act.add')}
          </button>
        </form>
        {data.activities.length === 0 && <p className="muted">{t('act.none')}</p>}
        <div className="list">
          {data.activities.map((a) => (
            <div key={a.id} className={`list-row ${a.hidden ? 'is-hidden' : ''}`}>
              <input type="color" value={a.color} onChange={(e) => update((d) => updateActivity(d, a.id, { color: e.target.value }))} />
              <input className="grow" value={a.name} onChange={(e) => update((d) => updateActivity(d, a.id, { name: e.target.value }))} />
              <span className="muted">{fmtDuration(totalFor('activityId', a.id))}</span>
              <button
                className={`icon-btn ${a.hidden ? 'muted' : ''}`}
                title={t(a.hidden ? 'act.show' : 'act.hide')}
                onClick={() => update((d) => updateActivity(d, a.id, { hidden: !a.hidden }))}
              >
                <Icon name={a.hidden ? 'visibility_off' : 'visibility'} size={18} />
              </button>
              <button
                className="icon-btn"
                title={t('delete')}
                onClick={() => confirm(t('act.removeConfirm', { name: a.name })) && update((d) => removeActivity(d, a.id))}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      </section>
      )}
    </div>
  );
}
