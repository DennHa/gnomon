import type { ShortcutConfig } from './shortcuts';

/** Ready-made activity sets per role (names in i18n: preset.<id>). */
/** Settings pushed by the company's Mac management (Iru), read-only. See docs/company-setup.md. */
export type CompanyProfile = {
  serverUrl?: string;
  /** Hide what the company handles: the integrations guide, token fields and own-server pairing. */
  managed?: boolean;
  entraTenantId?: string;
  entraClientId?: string;
  allowLocalApi?: boolean;
  allowActivityTrail?: boolean;
  dailyTargetHours?: number;
  language?: 'system' | 'en' | 'de';
};

/** Hours per weekday (Mon–Sun) from a date on; see src/schedule.ts. */
export type WorkSchedule = { from: string; hours: number[]; source?: 'personio' };

export type ActivityPreset = 'designer' | 'pm' | 'director' | '3d' | 'ux' | 'ui';

export type Project = {
  id: string;
  name: string;
  color: string;
  /** Hours per workday you aim to spend on this project (optional; Float plans take precedence). */
  dailyGoalHours?: number;
  floatId?: number;
  clientName?: string;
  /** Id in an external system that manages this project through the API. */
  externalId?: string;
};

/** One Float allocation for you: a project task planned over a date range. */
export type PlanItem = {
  floatId: number;
  projectId: string;
  name: string;
  notes?: string;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
  /** "HH:MM" when the allocation has a start time in Float. */
  startTime?: string;
  /** The working days the allocation covers (Float excludes weekends, holidays and time off). */
  days: string[];
  tentative?: boolean;
};

/** The kind of work: call, design, presentation… The same list is used for every project. */
export type Activity = {
  id: string;
  name: string;
  color: string;
};

export type Entry = {
  id: string;
  description: string;
  projectId?: string;
  activityId?: string;
  billable?: boolean;
  /** The Float task (allocation) this time belongs to; the name is kept in case the plan changes. */
  taskId?: number;
  taskName?: string;
  /** Id in an external system that pushed this entry through the API (makes repeated pushes update, not duplicate). */
  externalId?: string;
  /** ISO timestamps; a missing end means the timer is running. */
  start: string;
  end?: string;
};

export type Break = { start: string; end?: string };

/** Attendance for one calendar day: when you arrived, left and paused. */
export type Workday = {
  date: string;
  start: string;
  end?: string;
  breaks: Break[];
  /** Vacation, sick day, holiday: counts as neither worked nor missing. */
  off?: boolean;
  offReason?: string;
  /** "overtime": time off in lieu. The daily target still counts, so it uses the overtime balance. */
  offKind?: 'overtime';
  /** Set when the day off was imported (Float or Personio), so a later sync of that source may update or remove it. */
  offSource?: 'float' | 'personio';
  /** Closed by the midnight auto-stop; Gnomon asks for the real leave time until you confirm it. */
  autoClosed?: boolean;
};

export type Settings = {
  /** UI language; 'system' follows macOS. */
  language: 'system' | 'en' | 'de';
  /** The single daily target from before work schedules; still the fallback when no schedule is set. */
  dailyTargetHours: number;
  /** Light or dark, or follow macOS (default). */
  appearance?: 'system' | 'light' | 'dark';
  /** Highlight colour (see ACCENTS in src/views/Settings.tsx and the [data-accent] rules in styles.css). */
  accent?: 'sun' | 'blue' | 'green' | 'purple' | 'coral';
  /** Work schedule periods (hours per weekday, each from a date on). */
  schedules?: WorkSchedule[];
  /** Overtime balance: false (default) counts only days you recorded; true counts every scheduled workday, so a day
   * without a record is missing time. Needs days off and holidays to be complete (Float, Personio). */
  countAllScheduledDays?: boolean;
  autoStartDay: boolean;
  startDayWithTimer: boolean;
  floatPersonId?: number;
  floatPersonName?: string;
  floatEmail?: string;
  floatRegionId?: number;
  floatLastSync?: string;
  /** Personio absence import: your work email there and the matching person. */
  personioEmail?: string;
  personioPersonId?: string;
  personioPersonName?: string;
  personioLastSync?: string;
  /** The first-launch setup guide (Float, Personio, Weblog) was finished or skipped. */
  onboardingDone?: boolean;
  /** The first-launch feature tour was finished or closed. */
  tourDone?: boolean;
  shortcutsEnabled: boolean;
  /** Global shortcuts as Electron accelerators (see src/shortcuts.ts). */
  shortcuts: ShortcutConfig;
  /** Minutes without keyboard/mouse input before Gnomon asks about a running timer (0 = off). */
  idleMinutes: number;
  reviewOnLeave: boolean;
  /** Opt-in: show a billable (€) switch on entries and billable totals in reports. */
  billableEnabled: boolean;
  /** Overtime balance carried over from elsewhere (e.g. the company system), valid at the start of balanceStartDate. */
  balanceStartHours: number;
  balanceStartDate?: string;
  /** Your name; added to CSV exports so they can be told apart (e.g. when collected by the company). */
  userName?: string;
  /** Close a workday and timer left running from an earlier day at 23:59. */
  autoStopMidnight: boolean;
  /** What the menu bar shows next to the icon. */
  menuBarLabel: 'task' | 'task-time' | 'time' | 'none';
  /** Colour of the menu bar dot while a timer runs. */
  menuBarColor: 'project' | 'activity' | 'mono';
  /** Opt-in: remember which app was in front, to help reviewing later. */
  activityTrail: boolean;
  /** Which role's activity set the list came from; any manual change makes it 'custom'. */
  activityPreset?: ActivityPreset | 'custom';
  /** Local REST API (see API.md). */
  apiEnabled: boolean;
  apiPort: number;
  /** Listen on all network interfaces instead of only this Mac. */
  apiLan: boolean;
};

export type Data = {
  version: 1;
  projects: Project[];
  activities: Activity[];
  entries: Entry[];
  workdays: Workday[];
  /** Your Float allocations, replaced on every sync. */
  plan: PlanItem[];
  /** Mondays (YYYY-MM-DD) of weeks you marked as done; their timesheet is read-only. */
  reviewedWeeks: string[];
  settings: Settings;
};

/** What the menu bar can start: a project, or a recent entry. */
export type QuickStart = { description: string; projectId?: string; activityId?: string; billable?: boolean; taskId?: number; taskName?: string };

export type TrayState = {
  title: string;
  tooltip: string;
  status: string;
  dayActive: boolean;
  dayEnded: boolean;
  onBreak: boolean;
  running?: string;
  /** "Task or description · Project" of the running entry, and "1h 12m · since 09:10". */
  runningLabel?: string;
  runningDetail?: string;
  runningProjectColor?: string;
  projects: { id: string; name: string; color: string }[];
  activities: { id: string; name: string; color: string }[];
  runningActivityId?: string;
  recent: (QuickStart & { label: string; color?: string })[];
  /** Today's Float plan, shown at the top of the menu. */
  todayPlan: (QuickStart & { label: string; color: string })[];
  runningColor?: string;
  runningSince?: string;
  shortcutsEnabled: boolean;
  shortcuts: ShortcutConfig;
  idleMinutes: number;
  reviewOnLeave: boolean;
  trailEnabled: boolean;
  apiEnabled: boolean;
  apiPort: number;
  apiLan: boolean;
  /** Locale for times in main (idle dialog) and the menu, dialog and notification texts in the UI language. */
  locale: string;
  strings: Record<string, string>;
};

export type TrayAction =
  | { type: 'start-day' | 'leave' | 'toggle-break' | 'stop-timer' }
  | ({ type: 'start' } & QuickStart)
  | { type: 'switch-activity'; activityId: string }
  | { type: 'resume' }
  | { type: 'idle'; since: string; choice: 'keep' | 'discard' | 'break' | 'leave' }
  | { type: 'show-review' };
