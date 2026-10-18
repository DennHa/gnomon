// Entry rows shared by Today (exact times) and the Timesheet modals (hours).
import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { activitiesOn, appendEntry, deleteEntry, startTimer, updateEntry } from './actions';
import { BillableToggle, ProjectSelect, TimeField } from './components';
import { Icon } from './icons';
import { planItemsOn } from './plan';
import type { Entry } from './types';
import { dayKey, entryMs, fmtClock, fmtHM, parseDuration } from './time';
import { t } from './i18n';

/** Compact Float task picker: an icon and the task name, "—" when none. Hidden when the project has no tasks that day. */
export function TaskPicker({ projectId, day, value, name, onChange, keepSpace }: { projectId?: string; day: string; value?: number; name?: string; onChange: (id?: number, name?: string) => void; keepSpace?: boolean }) {
  const { data } = useStore();
  const items = projectId ? planItemsOn(data, projectId, day) : [];
  // In entry rows an empty slot keeps the columns after it lined up.
  if (!items.length && !value) return keepSpace ? <span className="picker-slot" /> : null;
  return (
    <label className={`picker ${value ? 'set' : ''}`} title={t('floatTask')}>
      <Icon name="task_alt" size={16} />
      <select
        value={value ?? ''}
        onChange={(e) => {
          const item = items.find((i) => i.floatId === Number(e.target.value));
          onChange(item?.floatId, item?.name || undefined);
        }}
      >
        <option value="">—</option>
        {value && !items.some((i) => i.floatId === value) && <option value={value}>{name ?? t('task')}</option>}
        {items.map((i) => (
          <option key={i.floatId} value={i.floatId}>
            {i.name || t('plannedWork')}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Compact activity picker in the activity's colour, "—" when none. */
export function ActivityPicker({ value, onChange }: { value?: string; onChange: (id?: string) => void }) {
  const { data } = useStore();
  const current = data.activities.find((a) => a.id === value);
  if (!activitiesOn(data)) return null;
  return (
    <label className={`picker ${current ? 'set' : ''}`} style={current ? { color: current.color } : undefined} title={t('activity')}>
      <Icon name="label" size={16} />
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">—</option>
        {data.activities
          .filter((a) => !a.hidden || a.id === value)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </select>
    </label>
  );
}

/** Hours as a small number field: type 2, 2,5 or 1:30; saved on Enter or when leaving the field. */
export function HoursInput({ ms, onCommit, disabled, autoFocus, inputRef }: { ms: number; onCommit: (ms: number) => void; disabled?: boolean; autoFocus?: boolean; inputRef?: React.Ref<HTMLInputElement> }) {
  const shown = ms ? fmtHM(ms) : '';
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    if (text === shown) return;
    const v = parseDuration(text);
    if (v === null) return setBad(true);
    setBad(false);
    onCommit(v);
  };
  return (
    <input
      ref={inputRef}
      className={`hours ${bad ? 'bad' : ''}`}
      value={text}
      placeholder="0:00"
      inputMode="decimal"
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={(e) => (setText(e.target.value), setBad(false))}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') (setText(shown), setBad(false));
      }}
    />
  );
}

function FeedRow({ entry, mode, showProject, readOnly }: { entry: Entry; mode: 'hours' | 'times'; showProject: boolean; readOnly?: boolean }) {
  const { update } = useStore();
  const now = Date.now();
  const day = dayKey(entry.start);
  const set = (p: Partial<Entry>) => update((d) => updateEntry(d, entry.id, p));
  const running = !entry.end;

  return (
    // Slides in when it was just started or stopped (not on every render of older rows).
    <div className={`feed-row ${running ? 'running' : ''} ${now - Date.parse(entry.end ?? entry.start) < 3000 ? 'fresh' : ''}`}>
      <input className="feed-desc" value={entry.description} placeholder={t('feed.whatDidYouDo')} disabled={readOnly} onChange={(e) => set({ description: e.target.value })} />
      <div className="feed-meta">
        {showProject && <ProjectSelect value={entry.projectId} onChange={(projectId) => set({ projectId, taskId: undefined, taskName: undefined })} />}
        <TaskPicker keepSpace={mode === 'times'} projectId={entry.projectId} day={day} value={entry.taskId} name={entry.taskName} onChange={(taskId, taskName) => set({ taskId, taskName })} />
        <ActivityPicker value={entry.activityId} onChange={(activityId) => set({ activityId })} />
        <BillableToggle value={entry.billable} onChange={(billable) => set({ billable })} />
      </div>
      {mode === 'times' ? (
        <span className="feed-times">
          <Icon name="schedule" size={16} className="feed-clock" />
          <TimeField value={entry.start} day={day} onChange={(start) => set({ start })} />
          <span className="muted">–</span>
          {entry.end ? <TimeField value={entry.end} day={day} onChange={(end) => set({ end })} /> : <span className="muted now">{t('now')}</span>}
          <strong className="feed-dur">{fmtClock(entryMs(entry, now))}</strong>
        </span>
      ) : (
        <HoursInput
          ms={entryMs(entry, now)}
          disabled={running || readOnly}
          onCommit={(ms) => ms > 0 && set({ end: new Date(Date.parse(entry.start) + ms).toISOString() })}
        />
      )}
      <span className="feed-actions">
        {mode === 'times' && (
          <button
            className="icon-btn"
            title={t('feed.continueNow')}
            onClick={() => update((d) => startTimer(d, { description: entry.description, projectId: entry.projectId, activityId: entry.activityId, billable: entry.billable, taskId: entry.taskId, taskName: entry.taskName }))}
          >
            <Icon name="play_arrow" size={18} />
          </button>
        )}
        {!readOnly && (
          <button className="icon-btn" title={t('delete')} onClick={() => update((d) => deleteEntry(d, entry.id))}>
            <Icon name="delete" size={18} />
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * The empty row at the end of a feed: description, Enter → hours, Enter or + → added, cursor back to the description.
 * Leaving the hours field never adds anything by itself.
 */
function NewRow({ day, projectId, showProject, prefill }: { day: string; projectId?: string; showProject: boolean; prefill?: { ms: number; taskId?: number; taskName?: string } | null }) {
  const { update } = useStore();
  const [description, setDescription] = useState('');
  const [project, setProject] = useState<string | undefined>(projectId);
  const [task, setTask] = useState<{ id?: number; name?: string }>({});
  const [activityId, setActivityId] = useState<string>();
  const [hours, setHours] = useState('');
  const descRef = useRef<HTMLInputElement>(null);
  const hoursRef = useRef<HTMLInputElement>(null);
  const parsed = parseDuration(hours);
  const valid = parsed !== null && parsed >= 60_000;

  useEffect(() => {
    if (!prefill) return;
    setHours(fmtHM(prefill.ms));
    setTask({ id: prefill.taskId, name: prefill.taskName });
    hoursRef.current?.focus();
  }, [prefill]);

  const add = () => {
    if (!valid) {
      hoursRef.current?.focus();
      return;
    }
    update((d) => appendEntry(d, day, parsed!, { projectId: project, description: description.trim(), taskId: task.id, taskName: task.name, activityId }));
    setDescription('');
    setHours('');
    setTask({});
    descRef.current?.focus();
  };

  return (
    <div className="feed-row new">
      <input
        ref={descRef}
        className="feed-desc"
        value={description}
        placeholder={t('feed.addPlaceholder')}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (valid ? add() : hoursRef.current?.focus())}
      />
      <div className="feed-meta">
        {showProject && <ProjectSelect value={project} onChange={(p) => (setProject(p), setTask({}))} />}
        <TaskPicker projectId={project} day={day} value={task.id} name={task.name} onChange={(id, name) => setTask({ id, name })} />
        <ActivityPicker value={activityId} onChange={setActivityId} />
      </div>
      <input
        ref={hoursRef}
        className={`hours ${hours && parsed === null ? 'bad' : ''}`}
        value={hours}
        placeholder="0:00"
        inputMode="decimal"
        onChange={(e) => setHours(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => e.key === 'Enter' && add()}
      />
      <span className="feed-actions">
        <button className="add-btn" title={t('feed.addHint')} disabled={!valid} onClick={add}>
          <Icon name="add" size={20} />
        </button>
      </span>
    </div>
  );
}

export function EntryFeed({
  day,
  entries,
  mode,
  projectId,
  readOnly,
  prefill,
}: {
  day: string;
  entries: Entry[];
  mode: 'hours' | 'times';
  /** Set when the feed belongs to one project (timesheet cell); otherwise each row picks its project. */
  projectId?: string | null;
  readOnly?: boolean;
  prefill?: { ms: number; taskId?: number; taskName?: string } | null;
}) {
  const showProject = projectId === undefined;
  return (
    <div className={`feed mode-${mode} ${showProject ? 'with-project' : ''}`}>
      {entries.map((e) => (
        <FeedRow key={e.id} entry={e} mode={mode} showProject={showProject} readOnly={readOnly} />
      ))}
      {!readOnly && mode === 'hours' && <NewRow day={day} projectId={projectId ?? undefined} showProject={showProject} prefill={prefill} />}
    </div>
  );
}
