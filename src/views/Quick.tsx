// The quick switcher: a small Spotlight-style window opened with the quick-start shortcut to start or switch what you're tracking.
// It reads a snapshot of the data and sends the chosen action to the main window, which owns the state.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Data, TrayAction } from '../types';
import { planItemsOn } from '../plan';
import { dayKey, entryMs, fmtClock } from '../time';
import { Icon, type IconName } from '../icons';
import { prettyAccel, projectAccel } from '../shortcuts';
import { setLanguage, t } from '../i18n';

type Item = { key: string; label: string; sub?: string; color?: string; icon?: IconName; hint?: string; action: TrayAction };

function buildItems(d: Data): Item[] {
  const today = dayKey(new Date());
  const running = d.entries.find((e) => !e.end);
  const wd = d.workdays.find((w) => w.date === today);
  const projectOf = (id?: string) => d.projects.find((p) => p.id === id);
  const items: Item[] = [];

  if (running) {
    const p = projectOf(running.projectId);
    items.push({ key: 'stop', icon: 'stop', label: t('quick.stopTimer'), sub: [running.description, p?.name].filter(Boolean).join(' · '), hint: prettyAccel(d.settings.shortcuts?.stopResume ?? '') || undefined, action: { type: 'stop-timer' } });
  }
  for (const p of d.projects) {
    for (const item of planItemsOn(d, p.id, today)) {
      items.push({
        key: `plan-${item.floatId}`,
        label: item.name || t('plannedWork'),
        sub: t('quick.plannedToday', { project: p.name, hours: item.hoursPerDay }),
        color: p.color,
        action: { type: 'start', description: '', projectId: p.id, taskId: item.floatId, taskName: item.name || undefined },
      });
    }
  }
  const seen = new Set<string>();
  for (const e of [...d.entries].filter((x) => x.end).sort((a, b) => b.start.localeCompare(a.start))) {
    const k = `${e.description}|${e.projectId}|${e.taskId}|${e.activityId}`;
    if (seen.has(k) || (!e.description && !e.taskName)) continue;
    seen.add(k);
    const p = projectOf(e.projectId);
    const a = d.activities.find((x) => x.id === e.activityId);
    items.push({
      key: `recent-${e.id}`,
      label: e.description || e.taskName || t('untitled'),
      sub: [t('quick.recent'), p?.name, e.description ? e.taskName : undefined, a?.name].filter(Boolean).join(' · '),
      color: p?.color,
      action: { type: 'start', description: e.description, projectId: e.projectId, activityId: e.activityId, billable: e.billable, taskId: e.taskId, taskName: e.taskName },
    });
    if (seen.size >= 8) break;
  }
  d.projects.forEach((p, i) =>
    items.push({ key: `project-${p.id}`, label: p.name, sub: t('project'), color: p.color, hint: prettyAccel(projectAccel(d.settings.shortcuts?.projects ?? '', i)) || undefined, action: { type: 'start', description: '', projectId: p.id } }),
  );
  if (!wd || wd.end) items.push({ key: 'day', icon: 'login', label: t(wd ? 'resumeDay' : 'startDay'), sub: t('quick.clockIn'), action: { type: 'start-day' } });
  else {
    items.push({ key: 'break', icon: 'coffee', label: t(wd.breaks.some((b) => !b.end) ? 'quick.endBreak' : 'quick.takeBreak'), hint: prettyAccel(d.settings.shortcuts?.breakToggle ?? '') || undefined, action: { type: 'toggle-break' } });
    items.push({ key: 'leave', icon: 'logout', label: t('leave'), sub: t('quick.leaveSub'), action: { type: 'leave' } });
  }
  return items;
}

function matches(item: Item, q: string): boolean {
  const hay = `${item.label} ${item.sub ?? ''}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

export default function Quick() {
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const refresh = () =>
    window.api.load().then((d) => {
      setLanguage((d as Data | null)?.settings?.language);
      setData(d as Data);
    });
  useEffect(() => {
    refresh();
    return window.api.onQuickShow(() => {
      setQ('');
      setSel(0);
      refresh();
      setTimeout(() => input.current?.focus(), 0);
    });
  }, []);

  const items = useMemo(() => (data ? buildItems(data).filter((i) => matches(i, q)) : []), [data, q]);
  const running = data?.entries.find((e) => !e.end);
  const runningProject = data?.projects.find((p) => p.id === running?.projectId);

  const pick = (item?: Item) => {
    if (item) return window.api.quickAction(item.action);
    // Nothing matched: start a timer with what was typed as the description.
    if (q.trim()) window.api.quickAction({ type: 'start', description: q.trim() });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return window.api.quickHide();
    if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(s + 1, items.length - 1)));
    if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
    if (e.key === 'Enter') pick(items[sel]);
  };

  return (
    <div className="quick">
      <div className="quick-head">
        {running && (
          <span className="quick-running">
            <span className="dot" style={{ background: runningProject?.color ?? '#B0BEC5' }} />
            {running.description || running.taskName || runningProject?.name || t('timer')} · {fmtClock(entryMs(running))}
          </span>
        )}
        <input
          ref={input}
          autoFocus
          className="quick-input"
          placeholder={t('quick.placeholder')}
          value={q}
          onChange={(e) => (setQ(e.target.value), setSel(0))}
          onKeyDown={onKey}
        />
      </div>
        <ul className="quick-list">
          {items.map((it, i) => (
            <li key={it.key} className={i === sel ? 'sel' : ''} onMouseEnter={() => setSel(i)} onMouseDown={() => pick(it)}>
              {it.icon ? <Icon name={it.icon} size={18} /> : <span className="dot" style={{ background: it.color ?? 'transparent' }} />}
              <span className="quick-label">
                {it.label}
                {it.sub && <span className="muted small"> {it.sub}</span>}
              </span>
              {it.hint && <kbd>{it.hint}</kbd>}
            </li>
          ))}
          {!items.length && q.trim() && (
            <li className="sel">
              <span className="dot" />
              <span className="quick-label">
                {t('quick.startTyped', { text: q.trim() })} <span className="muted small">{t('quick.startTypedSub')}</span>
              </span>
              <kbd>↵</kbd>
            </li>
          )}
        </ul>
      <div className="quick-foot muted small">
        <span>{t('quick.keys')}</span>
        <button className="link" onMouseDown={() => window.api.quickOpenMain()}>
          {t('quick.openGnomon')}
        </button>
      </div>
    </div>
  );
}
