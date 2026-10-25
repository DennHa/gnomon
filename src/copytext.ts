// Copy day: a day's bookings as plain-text bullet points, for Weblog or a status message.
// Pure (no clipboard, no DOM), so the Mac app, the web app and the tests share it.
import type { Data } from './types';
import { breakMs, dayKey, entryMs, fmtDate, fmtHM } from './time';
import { t } from './i18n';

export type CopyOptions = { hours: boolean; now?: number };
/** The text, and how many bullet lines of work it has (0 = nothing to copy). */
export type CopyText = { text: string; lines: number };

/** Hours per line are on unless switched off. */
export const copyHoursOn = (data: Data) => data.settings.copyHours !== false;

/**
 * Friday, 24 Oct · 8:15 h
 *
 * - Client XYZ · Landing page: design review (1:30)
 * - Breaks: 0:30
 *
 * One line per project, task and description; the same three twice add up. Without a description the activity
 * (or the task) stands in. Breaks only when there were some.
 */
export function dayText(data: Data, day: string, { hours, now = Date.now() }: CopyOptions): CopyText {
  const entries = data.entries.filter((e) => dayKey(e.start) === day).sort((a, b) => a.start.localeCompare(b.start));
  if (!entries.length) return { text: '', lines: 0 };
  const lines = new Map<string, { label: string; ms: number }>();
  for (const e of entries) {
    const project = data.projects.find((p) => p.id === e.projectId)?.name;
    const activity = data.activities.find((a) => a.id === e.activityId)?.name;
    const what = e.description.trim() || activity || e.taskName || '';
    // The task joins the project, unless it already stands in for the description.
    const where = [project, e.taskName && e.taskName !== what ? e.taskName : undefined].filter(Boolean).join(' · ');
    const label = where && what ? `${where}: ${what}` : where || what || t('untitled');
    const key = `${e.projectId ?? ''}|${e.taskName ?? ''}|${what.toLowerCase()}`;
    const line = lines.get(key) ?? { label, ms: 0 };
    line.ms += entryMs(e, now);
    lines.set(key, line);
  }
  const booked = [...lines.values()].reduce((s, l) => s + l.ms, 0);
  const wd = data.workdays.find((w) => w.date === day && !w.off);
  const breaks = wd ? breakMs(wd, now) : 0;
  const header = `${fmtDate(day, { weekday: 'long' })}, ${fmtDate(day, { day: 'numeric', month: 'short' })} · ${fmtHM(booked)} h`;
  const bullets = [...lines.values()].map((l) => `- ${l.label}${hours ? ` (${fmtHM(l.ms)})` : ''}`);
  if (breaks >= 60_000) bullets.push(`- ${t('copy.breaks', { time: fmtHM(breaks) })}`);
  return { text: `${header}\n\n${bullets.join('\n')}\n`, lines: lines.size };
}

/** Several days (a week): one block per day with entries, in order. */
export function daysText(data: Data, days: string[], opts: CopyOptions): CopyText {
  const blocks = days.map((d) => dayText(data, d, opts)).filter((b) => b.lines);
  return { text: blocks.map((b) => b.text).join('\n'), lines: blocks.reduce((s, b) => s + b.lines, 0) };
}
