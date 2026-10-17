// Planned hours per project and day: Float allocations when there are any, otherwise the
// project's manual daily goal on regular workdays.
import type { Data, PlanItem } from './types';
import { hoursToMs } from './time';

export const planItemsOn = (data: Data, projectId: string, day: string): PlanItem[] =>
  data.workdays.find((w) => w.date === day)?.off ? [] : data.plan.filter((p) => p.projectId === projectId && p.days.includes(day));

function isRegularWorkday(data: Data, day: string): boolean {
  const wd = new Date(`${day}T12:00`).getDay();
  return wd !== 0 && wd !== 6 && !data.workdays.find((w) => w.date === day)?.off;
}

/** Planned milliseconds for a project on a day (0 when nothing is planned). */
export function goalFor(data: Data, projectId: string, day: string): number {
  // A day off (yours or from Float) cancels whatever was planned for it.
  if (data.workdays.find((w) => w.date === day)?.off) return 0;
  const items = planItemsOn(data, projectId, day);
  if (items.length) return hoursToMs(items.reduce((s, p) => s + p.hoursPerDay, 0));
  const manual = data.projects.find((p) => p.id === projectId)?.dailyGoalHours;
  return manual && isRegularWorkday(data, day) ? hoursToMs(manual) : 0;
}

/** "14:00–18:00" when the allocation has a start time in Float. */
export function timeWindow(item: PlanItem): string | undefined {
  if (!item.startTime) return undefined;
  const [h, m] = item.startTime.split(':').map(Number);
  const endMin = h * 60 + m + Math.round(item.hoursPerDay * 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${item.startTime}–${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`;
}
