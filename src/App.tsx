import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './store';
import { activitiesOn, addBreakBetween, breakBeforeRunning, closeOvernight, hasOvernight, isOnBreak, leave, resolveIdle, resumeLast, runningEntry, startDay, startTimer, stopTimer, switchActivity, todayWorkday, toggleBreak } from './actions';
import { planItemsOn } from './plan';
import { dayKey, entryMs, fmtClock, fmtDayLabel, fmtDuration, fmtHM, fmtTime, hoursToMs, useNow, workdayMs } from './time';
import { targetHoursOn } from './schedule';
import { Burst, daySummary, weekSummary } from './motion';
import { toAssign, weekReminderDue } from './reminders';
import { daylight } from './daylight';
import { DaylightRuler } from './daylight-ruler';
import type { Data, QuickStart, TrayAction, WorkStyle } from './types';
import Today from './views/Today';
import Timesheet from './views/Timesheet';
import { Icon, iconSvg, type IconName } from './icons';
import { handleApiRequest } from './api';
import { prettyAccel } from './shortcuts';
import Reports from './views/Reports';
import Projects from './views/Projects';
import Settings from './views/Settings';
import Onboarding from './views/Onboarding';
import Morning, { morningDue } from './views/Morning';
import Tour from './views/Tour';
import About from './views/About';
import { locale, t, trayStrings, type MsgKey } from './i18n';

const VIEWS = [
  { id: 'today', label: 'nav.today', icon: 'timer', bottom: false },
  { id: 'timesheet', label: 'nav.timesheet', icon: 'calendar_view_week', bottom: false },
  { id: 'reports', label: 'nav.reports', icon: 'bar_chart', bottom: false },
  { id: 'projects', label: 'nav.projects', icon: 'folder', bottom: true },
  { id: 'settings', label: 'nav.settings', icon: 'settings', bottom: true },
  { id: 'about', label: 'nav.about', icon: 'info', bottom: true },
] as const satisfies readonly { id: string; label: MsgKey; icon: IconName; bottom: boolean }[];
type View = (typeof VIEWS)[number]['id'];

// The hash is "view", "timesheet@YYYY-MM-DD" or "timesheet@YYYY-MM-DD@day" (day modal open), so a reload keeps your place.
const hashParts = () => window.location.hash.slice(1).split('@');
/** Where the app opens: the link in the address, else the page that fits how you work (Week when you clock in first). */
function initialView(style?: WorkStyle): View {
  const h = hashParts()[0];
  return VIEWS.some((v) => v.id === h) ? (h as View) : style === 'clock' ? 'timesheet' : 'today';
}
const topViews = (style?: WorkStyle) => {
  const top = VIEWS.filter((v) => !v.bottom);
  return style === 'clock' ? [...top.filter((v) => v.id === 'timesheet'), ...top.filter((v) => v.id !== 'timesheet')] : top;
};
function initialDay(): string {
  const d = hashParts()[1];
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : dayKey(new Date());
}

/** Last few distinct things you worked on, newest first, skipping what's running and what's in today's plan. */
function recentStarts(data: Data, limit = 3): (QuickStart & { label: string; color?: string })[] {
  const running = runningEntry(data);
  const today = dayKey(new Date());
  const planned = new Set(data.projects.flatMap((p) => planItemsOn(data, p.id, today).map((i) => `${p.id}|${i.floatId}`)));
  const same = (e: { description: string; projectId?: string; activityId?: string; taskId?: number }) => `${e.description}|${e.projectId ?? ''}|${e.activityId ?? ''}|${e.taskId ?? ''}`;
  const seen = new Set<string>(running ? [same(running)] : []);
  const out = [];
  for (const e of [...data.entries].sort((a, b) => b.start.localeCompare(a.start))) {
    if (!e.end || (!e.description && !e.taskName && !e.projectId) || seen.has(same(e))) continue;
    if (!e.description && e.taskId && planned.has(`${e.projectId}|${e.taskId}`)) continue;
    seen.add(same(e));
    const p = data.projects.find((x) => x.id === e.projectId);
    const a = data.activities.find((x) => x.id === e.activityId);
    const label = [e.description || e.taskName, p?.name, a?.name].filter(Boolean).join(' · ') || t('untitled');
    out.push({ description: e.description, projectId: e.projectId, activityId: e.activityId, billable: e.billable, taskId: e.taskId, taskName: e.taskName, label, color: p?.color });
    if (out.length === limit) break;
  }
  return out;
}

function dayStatus(data: Data, now: number): string {
  const wd = todayWorkday(data);
  if (!wd) return t('status.notClockedIn');
  if (wd.off) return t('dayOff');
  const duration = fmtDuration(workdayMs(wd, now));
  if (wd.end) return t('status.dayDoneDetail', { from: fmtTime(wd.start), to: fmtTime(wd.end), duration });
  return t(isOnBreak(wd) ? 'status.breakSince' : 'status.inSince', { time: fmtTime(wd.start), duration });
}

/** Mirrors the day and timer into the macOS menu bar and handles its menu actions. */
function useTrayBridge(onShowReview: () => void) {
  const showReviewRef = useRef(onShowReview);
  showReviewRef.current = onShowReview;
  const { data, update } = useStore();
  const now = useNow();
  const running = runningEntry(data);
  const wd = todayWorkday(data);
  const recent = useMemo(() => recentStarts(data), [data]);
  const todayPlan = useMemo(() => {
    const today = dayKey(new Date());
    return data.projects.flatMap((p) =>
      planItemsOn(data, p.id, today).map((i) => ({
        description: '',
        projectId: p.id,
        taskId: i.floatId,
        taskName: i.name || undefined,
        label: `${i.name || t('plannedWork')} · ${p.name} · ${i.hoursPerDay}h`,
        color: p.color,
      })),
    );
  }, [data]);

  const { menuBarLabel, menuBarColor } = data.settings;
  const runningProject = running && data.projects.find((x) => x.id === running.projectId);
  const runningActivity = running && data.activities.find((x) => x.id === running.activityId);
  const rawName = running ? running.taskName || running.description || runningProject?.name || t('timer') : '';
  const name = rawName.length > 24 ? `${rawName.slice(0, 23)}…` : rawName;
  let title = '';
  if (menuBarLabel === 'workday') {
    // Clocking in first: today's work time, whether a timer runs or not.
    if (wd && !wd.off && !wd.end) title = isOnBreak(wd) ? t('break') : fmtDuration(Math.max(0, workdayMs(wd, now)));
  } else if (menuBarLabel !== 'none') {
    if (running) {
      if (menuBarLabel === 'task') title = name;
      else if (menuBarLabel === 'task-time') title = `${name} · ${fmtHM(entryMs(running, now))}`;
      else title = fmtClock(entryMs(running, now));
    } else if (wd && !wd.end && isOnBreak(wd)) title = t('break');
    else if (wd && !wd.end && menuBarLabel === 'time') title = fmtDuration(workdayMs(wd, now));
  }
  const runningColor = !running || menuBarColor === 'mono' ? undefined : (menuBarColor === 'activity' && runningActivity?.color) || runningProject?.color || '#B0BEC5';

  useEffect(() => {
    const p = running && data.projects.find((x) => x.id === running.projectId);
    window.api.updateTray({
      title,
      tooltip: dayStatus(data, now),
      status: dayStatus(data, now),
      dayActive: Boolean(wd && !wd.end),
      dayEnded: Boolean(wd?.end),
      onBreak: isOnBreak(wd),
      running: running ? running.description || running.taskName || p?.name || t('timer') : undefined,
      runningLabel: running ? [running.description || running.taskName, p?.name].filter(Boolean).join(' · ') || t('timer') : undefined,
      runningDetail: running ? t('durationSince', { duration: fmtDuration(entryMs(running, now)), time: fmtTime(running.start) }) : undefined,
      runningProjectColor: running ? p?.color ?? '#B0BEC5' : undefined,
      projects: data.projects.map(({ id, name, color }) => ({ id, name, color })),
      activities: activitiesOn(data) ? data.activities.filter((a) => !a.hidden).map(({ id, name, color }) => ({ id, name, color })) : [],
      runningActivityId: running?.activityId,
      recent,
      todayPlan,
      runningSince: running?.start,
      runningColor,
      workStyle: data.settings.workStyle,
      reminders: data.settings.reminders !== false,
      shortcutsEnabled: data.settings.shortcutsEnabled,
      shortcuts: data.settings.shortcuts,
      idleMinutes: data.settings.idleMinutes,
      reviewOnLeave: data.settings.reviewOnLeave,
      trailEnabled: data.settings.activityTrail,
      apiEnabled: data.settings.apiEnabled,
      apiPort: data.settings.apiPort,
      apiLan: data.settings.apiLan,
      locale: locale(),
      strings: trayStrings(),
    });
    // `now` changes every second, which keeps the menu bar clock ticking.
  }, [title, data, wd, running, recent, todayPlan, now]);

  useEffect(
    () =>
      window.api.onTrayAction((action: TrayAction) => {
        if (action.type === 'start-day') update(startDay);
        if (action.type === 'leave') update(leave);
        if (action.type === 'toggle-break') update(toggleBreak);
        if (action.type === 'stop-timer') update(stopTimer);
        if (action.type === 'start') {
          const { description, projectId, activityId, billable, taskId, taskName } = action;
          update((d) => startTimer(d, { description, projectId, activityId, billable, taskId, taskName }));
        }
        if (action.type === 'resume') update(resumeLast);
        if (action.type === 'idle') update((d) => resolveIdle(d, action.since, action.choice));
        if (action.type === 'show-review') showReviewRef.current();
        if (action.type === 'switch-activity') update((d) => switchActivity(d, action.activityId));
      }),
    [update],
  );
}

/** Clock in / break / leave, always visible in the sidebar. Click the status to open today in the timesheet. */
/** Puts the Daylight look into CSS variables on <html> (see .daylight rules in styles.css). */
function useDaylight(on: boolean, previewAt: number | null) {
  const now = useNow(60_000);
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('daylight', on);
    if (!on) return;
    const look = daylight(new Date(previewAt ?? now), dark);
    root.style.setProperty('--daylight-sky', look.sky);
    root.style.setProperty('--daylight-shadow', look.shadow);
    root.style.setProperty('--daylight-text-shadow', look.textShadow);
  }, [on, now, dark, previewAt]);
}

/** Says when Gnomon moved or created a workday to fit the entries (src/fit.ts). */
function FitToast() {
  const { fitNotices, dismissFitNotices } = useStore();
  useEffect(() => {
    if (!fitNotices.length) return;
    const t = setTimeout(dismissFitNotices, 6000);
    return () => clearTimeout(t);
  }, [fitNotices]);
  if (!fitNotices.length) return null;
  return (
    <div className="fit-toast" role="status" onClick={dismissFitNotices}>
      {fitNotices.slice(0, 3).map((n) => (
        <span key={`${n.kind}${n.date}${n.at}`}>{t(`fit.${n.kind}`, { day: fmtDayLabel(n.date), time: fmtTime(n.at) })}</span>
      ))}
    </div>
  );
}

function Attendance({ onOpenDay }: { onOpenDay: (day: string) => void }) {
  const { data, update } = useStore();
  const now = useNow();
  const wd = todayWorkday(data);
  const today = dayKey(now);
  // A workday from an earlier day that's still open or was closed automatically at midnight.
  const needsFix = data.workdays
    .filter((w) => w.date < today && (!w.end || w.autoClosed))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const onBreak = isOnBreak(wd);
  const state = !wd ? 'off' : wd.off ? 'dayoff' : wd.end ? 'done' : onBreak ? 'break' : 'on';
  const label = t(({ off: 'status.notClockedIn', dayoff: 'dayOff', done: 'status.dayDone', break: 'status.onBreak', on: 'status.atWork' } as const)[state]);
  const target = hoursToMs(targetHoursOn(data, today));
  // Never below zero: right after clocking in, `now` can lag the start time by a fraction of a second.
  const worked = wd && !wd.off ? Math.max(0, workdayMs(wd, now)) : 0;
  const progress = target > 0 ? Math.min(1, worked / target) : 0;

  // Moments: starting the day, leaving (a summary; the weekend on the last workday), reaching the daily target.
  const prev = useRef(state);
  const [starting, setStarting] = useState(false);
  const [reached, setReached] = useState(false);
  const [burst, setBurst] = useState(0);
  const [summary, setSummary] = useState<{ weekend: boolean; worked: number; diff: number; open: number } | null>(null);
  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    if ((was === 'off' || was === 'done') && state === 'on') {
      setSummary(null);
      setStarting(true);
      const t = setTimeout(() => setStarting(false), 900);
      return () => clearTimeout(t);
    }
    if ((was === 'on' || was === 'break') && state === 'done') {
      const week = weekSummary(data, today);
      const day = daySummary(data, today);
      const open = toAssign(data, today);
      setSummary(week.lastWorkday ? { weekend: true, worked: week.worked, diff: week.diff, open } : { weekend: false, worked: day.worked, diff: day.diff, open });
      // Clocking in first: leaving is the moment to say what's still to fill in.
      if (data.settings.workStyle === 'clock' && data.settings.reminders !== false && open >= 15 * 60_000)
        window.api.notify(t('rem.leaveTitle', { duration: fmtDuration(open) }), t('rem.leaveBody'));
      if (week.lastWorkday) setBurst(Date.now());
    }
  }, [state]);
  useEffect(() => {
    if (!summary) return;
    const t = setTimeout(() => setSummary(null), 6500);
    return () => clearTimeout(t);
  }, [summary]);
  const targetReached = state === 'on' && target > 0 && worked >= target;
  useEffect(() => {
    if (!targetReached || data.settings.celebratedDay === today) return;
    update((d) => ({ ...d, settings: { ...d.settings, celebratedDay: today } }));
    setReached(true);
    setBurst(Date.now());
    const t = setTimeout(() => setReached(false), 6000);
    return () => clearTimeout(t);
  }, [targetReached, today]);
  const signed = (ms: number) => `${ms < 0 ? '−' : '+'}${fmtDuration(Math.abs(ms))}`;
  // Live trackers who stop the timer for lunch: offer the pause as a break when the next timer starts.
  const gap = data.settings.workStyle === 'clock' ? null : breakBeforeRunning(data);
  const [askedGap, setAskedGap] = useState<string | null>(null);
  const gapKey = gap ? `${gap.start}|${gap.end}` : null;
  const showGap = gap && gapKey !== askedGap && Date.now() - Date.parse(gap.end) < 30 * 60_000;

  return (
    <div className={`attendance ${state}`}>
      {needsFix && (
        <button className="att-fix" onClick={() => onOpenDay(needsFix.date)} title={t('att.fixHint')}>
          <Icon name="warning" size={16} />
          <span>
            {fmtDayLabel(needsFix.date)}: {t(needsFix.end ? 'att.closedAtMidnight' : 'att.stillClockedIn')}
          </span>
          <strong>{t(needsFix.end ? 'att.fix' : 'leave')}</strong>
        </button>
      )}
      <button className="att-status" onClick={() => onOpenDay(today)} title={t('att.openToday')}>
        <span className={`att-dot ${starting ? 'pop' : ''}`} />
        <span className="att-text">
          <strong>{label}</strong>
          {reached ? (
            <span className="small att-reached">{t('moment.target')}</span>
          ) : (
            wd &&
            !wd.off && (
              <span className="muted small">
                {t('durationSince', { duration: fmtDuration(worked), time: fmtTime(wd.start) })}
              </span>
            )
          )}
        </span>
      </button>
      {wd && !wd.off && target > 0 && (
        <div className="att-bar">
          <span className={`att-fill ${starting ? 'grow' : ''} ${reached ? 'shine' : ''}`} style={{ width: `${progress * 100}%` }} />
          <Burst trigger={burst} style={{ left: `${progress * 100}%`, top: '50%' }} />
        </div>
      )}
      {summary && (
        <div className="att-toast" role="status">
          {summary.weekend ? (
            <>
              <strong className="att-reached">{t('moment.weekend')}</strong>
              <span className="muted">
                {t('moment.week', { duration: fmtDuration(summary.worked) })} · <span className={summary.diff >= 0 ? 'pos' : 'neg'}>{signed(summary.diff)}</span>
              </span>
            </>
          ) : (
            <span>
              <strong>{t('moment.today', { duration: fmtDuration(summary.worked) })}</strong> <span className={summary.diff >= 0 ? 'pos' : 'neg'}>{signed(summary.diff)}</span>
            </span>
          )}
          {summary.open >= 15 * 60_000 && (
            <button className="link small" onClick={() => onOpenDay(today)}>
              {t('ts.toAssign', { duration: fmtHM(summary.open) })}
            </button>
          )}
        </div>
      )}
      {showGap && (
        <div className="att-toast att-ask" role="status">
          <span>{t('gap.ask', { from: fmtTime(gap.start), to: fmtTime(gap.end) })}</span>
          <span className="att-ask-btns">
            <button className="btn small primary" onClick={() => (update((d) => addBreakBetween(d, gap.date, gap.start, gap.end)), setAskedGap(gapKey))}>
              {t('gap.yes')}
            </button>
            <button className="btn small" onClick={() => setAskedGap(gapKey)}>
              {t('gap.no')}
            </button>
          </span>
        </div>
      )}
      <div className="att-actions">
        {state === 'on' || state === 'break' ? (
          <>
            <button className="btn small" onClick={() => update(toggleBreak)} title={prettyAccel(data.settings.shortcuts.breakToggle)}>
              <Icon name={onBreak ? 'play_arrow' : 'coffee'} size={18} /> {t(onBreak ? 'resume' : 'break')}
            </button>
            <button className="btn small danger-soft" onClick={() => update(leave)}>
              <Icon name="logout" size={18} /> {t('leave')}
            </button>
          </>
        ) : (
          <button className="btn small primary block" onClick={() => update(startDay)}>
            <Icon name="login" size={18} /> {t(state === 'done' ? 'resumeDay' : 'startDay')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Rasterise a few Material Symbols to PNG for the native menu bar menu (Electron menus can't draw SVG). */
const MENU_ICONS: IconName[] = ['play_arrow', 'pause', 'stop', 'login', 'logout', 'coffee', 'search', 'open_in_full', 'today'];
function useMenuIcons() {
  useEffect(() => {
    const size = 32; // 16pt @2x
    Promise.all(
      MENU_ICONS.map(
        (name) =>
          new Promise<[string, string]>((resolve) => {
            const svg = iconSvg(name).replace('fill="currentColor"', 'fill="#000"').replace('<svg ', `<svg width="${size}" height="${size}" `);
            const img = new Image();
            img.onload = () => {
              const c = document.createElement('canvas');
              c.width = c.height = size;
              c.getContext('2d')!.drawImage(img, 2, 2, size - 4, size - 4);
              resolve([name, c.toDataURL('image/png')]);
            };
            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
          }),
      ),
    ).then((pairs) => window.api.setMenuIcons(Object.fromEntries(pairs)));
  }, []);
}

/** Answers local REST API requests (see API.md) with the same state the window shows. */
function useApiBridge() {
  const { getData, commit } = useStore();
  useEffect(
    () =>
      window.api.onApiRequest((req) => {
        const { status, body } = handleApiRequest({ get: getData, commit }, req);
        window.api.apiRespond(req.id, status, body);
      }),
    [getData, commit],
  );
}

export default function App() {
  const { data, update, runFloatSync, runPersonioSync, profile } = useStore();
  const [view, setView] = useState<View>(() => initialView(data.settings.workStyle));
  const [day, setDay] = useState(initialDay);
  const [dayModal, setDayModal] = useState<string | null>(() => (hashParts()[2] === 'day' ? initialDay() : null));
  const started = useRef(false);
  const now = useNow(60_000);
  const lastToday = useRef(dayKey(now));
  useTrayBridge(() => {
    setView('today');
    setTimeout(() => document.getElementById('day-review')?.scrollIntoView({ behavior: 'smooth' }), 200);
  });
  useMenuIcons();
  useApiBridge();

  // Midnight auto-stop: close a workday/timer left open on an earlier day (checked every minute and at launch).
  // Daylight (Easter egg): sky tint and shadows from the real sun and moon, once a minute.
  const daylightOn = Boolean(data.settings.daylight && data.settings.daylightUnlocked);
  // A time picked on the Daylight ruler, while scrubbing; null = now.
  const [daylightAt, setDaylightAt] = useState<number | null>(null);
  useDaylight(daylightOn, daylightOn ? daylightAt : null);

  // Clocking in first: on the week's last workday afternoon, a reminder to fill in the week (once a week).
  const minute = useNow(60_000);
  useEffect(() => {
    const due = weekReminderDue(data, minute);
    if (!due) return;
    update((d) => ({ ...d, settings: { ...d.settings, weekReminded: due.monday } }));
    window.api.notify(t('rem.weekTitle'), t('rem.weekBody', { duration: fmtDuration(due.ms) }));
  }, [minute]);

  // Appearance and highlight colour from Settings.
  useEffect(() => window.api.setTheme(data.settings.appearance ?? 'system'), [data.settings.appearance]);
  useEffect(() => {
    document.documentElement.dataset.accent = data.settings.accent ?? 'sun';
  }, [data.settings.accent]);

  useEffect(() => {
    if (data.settings.autoStopMidnight && hasOvernight(data)) update(closeOvernight);
  }, [now, data, update]);

  // When the app stays open past midnight, follow along if you were looking at the current week.
  useEffect(() => {
    const today = dayKey(now);
    if (today !== lastToday.current) {
      setDay((d) => (d === lastToday.current ? today : d));
      lastToday.current = today;
    }
  }, [now]);

  const openDay = (d: string) => {
    setDay(d);
    setDayModal(d);
    setView('timesheet');
  };

  useEffect(() => {
    window.location.hash = view === 'timesheet' && day !== dayKey(new Date()) ? `${view}@${day}` : view;
  }, [view, day]);

  // Float: sync once per day, the first time Gnomon runs in the morning (checked every 15 minutes).
  useEffect(() => {
    const check = () => {
      const s = data.settings;
      if (!s.floatPersonId) return;
      const last = s.floatLastSync ? dayKey(s.floatLastSync) : '';
      if (last !== dayKey(new Date()) && new Date().getHours() >= 5) runFloatSync();
    };
    check();
    const t = setInterval(check, 15 * 60_000);
    return () => clearInterval(t);
  }, [data.settings, runFloatSync]);

  // Personio: the same once-a-morning sync for absences.
  useEffect(() => {
    const check = () => {
      const s = data.settings;
      if (!s.personioPersonId) return;
      const last = s.personioLastSync ? dayKey(s.personioLastSync) : '';
      if (last !== dayKey(new Date()) && new Date().getHours() >= 5) runPersonioSync();
    };
    check();
    const t = setInterval(check, 15 * 60_000);
    return () => clearInterval(t);
  }, [data.settings, runPersonioSync]);

  // Optional: clock in automatically the first time the app opens each day.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (data.settings.autoStartDay && !todayWorkday(data)) update(startDay);
  }, [data, update]);

  const navButton = (v: (typeof VIEWS)[number]) => (
    <button key={v.id} className={`nav-item ${view === v.id ? 'active' : ''}`} onClick={() => setView(v.id)}>
      <Icon name={v.icon} size={20} />
      {t(v.label)}
    </button>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="titlebar-space" />
        {/* Clocking in first: Week, where you fill in your hours, comes first; live tracking: Track first. */}
        <nav>{topViews(data.settings.workStyle).map(navButton)}</nav>
        <span className="spacer" />
        <Attendance onOpenDay={openDay} />
        <nav className="nav-bottom">
          {VIEWS.filter((v) => v.bottom).map(navButton)}
        </nav>
      </aside>
      <main className="content">
        {daylightOn && <DaylightRuler preview={daylightAt} onPreview={setDaylightAt} />}
        {view === 'today' && <Today onOpenDay={openDay} onOpenProjects={() => setView('projects')} />}
        {view === 'timesheet' && <Timesheet day={day} setDay={setDay} dayModal={dayModal} setDayModal={setDayModal} />}
        {view === 'reports' && (
          <Reports
            onOpenDay={openDay}
            onOpenSettings={() => {
              // The starting balance lives on the General tab.
              try {
                localStorage.setItem('gnomon.settingsTab', 'general');
              } catch {
                /* storage unavailable: Settings opens on General anyway */
              }
              setView('settings');
            }}
          />
        )}
        {view === 'projects' && <Projects />}
        {view === 'settings' && <Settings />}
        {view === 'about' && <About />}
      </main>
      <FitToast />
      {/* First launch: the feature tour. The integrations guide opens only on request (tour's last step or Settings). */}
      {!data.settings.tourDone ? <Tour /> : data.settings.onboardingDone === false && !profile?.managed ? <Onboarding /> : morningDue(data) && <Morning />}
    </div>
  );
}
