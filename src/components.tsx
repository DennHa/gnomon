import type React from 'react';
import { useEffect, useState } from 'react';
import { useStore } from './store';
import { Icon } from './icons';
import { addActivity, addProject, activitiesOn, updateActivity } from './actions';
import { planItemsOn } from './plan';
import { atTime, dayKey, toTimeInput, uid, useNow } from './time';
import { t } from './i18n';

const NEW_PROJECT = '__new__';

/** Inline "name + Enter" field for creating a project without leaving the current screen. */
export function NewProjectInput({ onDone }: { onDone: (id?: string) => void }) {
  const { update } = useStore();
  const [name, setName] = useState('');
  const create = () => {
    if (!name.trim()) return onDone();
    const id = uid();
    update((d) => addProject(d, name, undefined, id));
    onDone(id);
  };
  return (
    <input
      className="new-project-input"
      autoFocus
      placeholder={t('comp.newProjectName')}
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') create();
        if (e.key === 'Escape') onDone();
      }}
      onBlur={create}
    />
  );
}

export function ProjectSelect({ value, onChange }: { value?: string; onChange: (id?: string) => void }) {
  const { data } = useStore();
  const [creating, setCreating] = useState(false);
  const current = data.projects.find((p) => p.id === value);
  if (creating) {
    return (
      <span className="project-select">
        <span className="dot" style={{ background: 'var(--border)' }} />
        <NewProjectInput
          onDone={(id) => {
            setCreating(false);
            if (id) onChange(id);
          }}
        />
      </span>
    );
  }
  return (
    <label className="project-select" style={{ color: current?.color }}>
      <span className="dot" style={{ background: current?.color ?? 'var(--border)' }} />
      <select value={value ?? ''} onChange={(e) => (e.target.value === NEW_PROJECT ? setCreating(true) : onChange(e.target.value || undefined))}>
        <option value="">{t('noProject')}</option>
        {data.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value={NEW_PROJECT}>{t('comp.newProject')}</option>
      </select>
    </label>
  );
}

export function ActivitySelect({ value, onChange }: { value?: string; onChange: (id?: string) => void }) {
  const { data } = useStore();
  const current = data.activities.find((a) => a.id === value);
  return (
    <label className={`activity-select ${current ? 'has' : ''}`} style={current ? { color: current.color, background: `color-mix(in srgb, ${current.color} 14%, transparent)` } : undefined}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{t('noActivity')}</option>
        {data.activities.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One chip per activity; the selected one is filled with its color. */
/**
 * Activity chips for switching with one click. "+" adds an activity right here; right-click a chip to hide it from
 * here (history and reports keep it) or to open the full list.
 */
export function ActivityChips({ value, onPick, onEdit }: { value?: string; onPick: (id: string) => void; onEdit?: () => void }) {
  const { data, update } = useStore();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => (window.removeEventListener('mousedown', close), window.removeEventListener('keydown', onKey), window.removeEventListener('blur', close));
  }, [menu]);
  if (!activitiesOn(data)) return null;
  const add = () => {
    const n = name.trim();
    setName('');
    setAdding(false);
    if (!n) return;
    const existing = data.activities.find((a) => a.name.toLowerCase() === n.toLowerCase());
    if (existing) {
      // Typing the name of a hidden one brings it back instead of making a twin.
      if (existing.hidden) update((d) => updateActivity(d, existing.id, { hidden: false }));
      onPick(existing.id);
      return;
    }
    const id = uid();
    update((d) => addActivity(d, n, undefined, id));
    onPick(id);
  };
  return (
    <div className="activity-chips">
      {data.activities
        .filter((a) => !a.hidden || a.id === value)
        .map((a) => {
          const active = a.id === value;
          return (
            <button
              key={a.id}
              type="button"
              className={`activity-chip ${active ? 'active' : ''}`}
              style={{ '--chip': a.color } as React.CSSProperties}
              onClick={() => onPick(a.id)}
              onContextMenu={(e) => (e.preventDefault(), setMenu({ id: a.id, x: e.clientX, y: e.clientY }))}
              title={t('act.chipHint')}
            >
              {a.name}
            </button>
          );
        })}
      {adding ? (
        <input
          className="activity-new"
          autoFocus
          value={name}
          placeholder={t('act.newShort')}
          onChange={(e) => setName(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => (e.key === 'Enter' ? add() : e.key === 'Escape' && (setName(''), setAdding(false)))}
        />
      ) : (
        <button type="button" className="activity-add" title={t('act.addHere')} aria-label={t('act.addHere')} onClick={() => setAdding(true)}>
          <Icon name="add" size={16} />
        </button>
      )}
      {menu && (
        <div className="ctx-menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={() => (update((d) => updateActivity(d, menu.id, { hidden: true })), setMenu(null))}>
            <Icon name="visibility_off" size={16} /> {t('act.hideHere')}
          </button>
          {onEdit && (
            <button role="menuitem" onClick={() => (setMenu(null), onEdit())}>
              <Icon name="edit" size={16} /> {t('act.editAll')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** € switch; hidden unless billable tracking is turned on in Settings. */
export function BillableToggle({ value, onChange }: { value?: boolean; onChange: (v: boolean) => void }) {
  const { data } = useStore();
  if (!data.settings.billableEnabled) return null;
  return (
    <button type="button" className={`billable ${value ? 'on' : ''}`} title={t(value ? 'comp.billable' : 'comp.notBillable')} onClick={() => onChange(!value)}>
      €
    </button>
  );
}

/** Edits the time-of-day of an ISO timestamp, keeping its calendar day. */
export function TimeField({ value, onChange, day }: { value: string; onChange: (iso: string) => void; day?: string }) {
  return (
    <input
      className="time-field"
      type="time"
      value={toTimeInput(value)}
      onChange={(e) => e.target.value && onChange(atTime(day ?? dayKey(value), e.target.value))}
    />
  );
}

/** Float task for a project on a day; keeps showing a task that is no longer in the plan. */
export function TaskSelect({
  projectId,
  day,
  value,
  name,
  onChange,
}: {
  projectId?: string;
  day: string;
  value?: number;
  name?: string;
  onChange: (taskId?: number, taskName?: string) => void;
}) {
  const { data } = useStore();
  const items = projectId ? planItemsOn(data, projectId, day) : [];
  if (!items.length && !value) return null;
  return (
    <label className="task-select" title={t('floatTask')}>
      <select
        value={value ?? ''}
        onChange={(e) => {
          const item = items.find((i) => i.floatId === Number(e.target.value));
          onChange(item?.floatId, item?.name || undefined);
        }}
      >
        <option value="">{t('noTask')}</option>
        {value && !items.some((i) => i.floatId === value) && <option value={value}>{name ?? t('task')}</option>}
        {items.map((i) => (
          <option key={i.floatId} value={i.floatId}>
            {i.name || t('plannedWork')} · {i.hoursPerDay}h
          </option>
        ))}
      </select>
    </label>
  );
}


type TrailSpan = { app: string; start: string; end: string };
const spanMinutes = (s: TrailSpan) => {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return m(s.end) - m(s.start) + 1;
};

/** Which apps were in front on a day (opt-in activity trail), as a memory aid when reviewing. */
export function TrailSummary({ day, live, title }: { day: string; live?: boolean; title?: string }) {
  const { data } = useStore();
  const [spans, setSpans] = useState<TrailSpan[]>([]);
  const [open, setOpen] = useState(false);
  // On the Track page the trail refreshes every minute, as Gnomon records it.
  const tick = useNow(live ? 60_000 : 3_600_000);
  useEffect(() => {
    if (data.settings.activityTrail) window.api.trailGet(day).then(setSpans);
    else setSpans([]);
  }, [day, data.settings.activityTrail, tick]);
  if (!data.settings.activityTrail) return null;
  if (!spans.length) return live ? <p className="muted small trail-empty"><Icon name="apps" size={16} /> {t('trail.empty')}</p> : null;

  const totals = new Map<string, number>();
  for (const s of spans) totals.set(s.app, (totals.get(s.app) ?? 0) + spanMinutes(s));
  const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);

  return (
    <div className="trail">
      <div className="trail-head">
        <span className="muted small">{title ?? t('comp.appsUsed')}</span>
        {top.map(([app, m]) => (
          <span key={app} className="trail-chip">
            {app} <span className="muted">{fmt(m)}</span>
          </span>
        ))}
        <button className="link small" onClick={() => setOpen(!open)}>
          {t(open ? 'comp.hideTimeline' : 'comp.timeline')}
        </button>
      </div>
      {open && (
        <div className="trail-timeline">
          {spans
            .filter((s) => spanMinutes(s) >= 3)
            .map((s, i) => (
              <div key={i} className="trail-row">
                <span className="muted">
                  {s.start}–{s.end}
                </span>
                <span>{s.app}</span>
                <span className="muted small">{fmt(spanMinutes(s))}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
