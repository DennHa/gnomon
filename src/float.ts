// Read-only import from Float (https://developer.float.com): your allocations become the
// daily plan per project, Float projects land in Gnomon's project list, and time off and
// public holidays become days off. Nothing is written back to Float.
import type { Data, PlanItem, Project, Workday } from './types';
import { addDays, atTime, dayKey, uid } from './time';
import { t } from './i18n';

/** Past days are kept so the plan for recent days stays visible; upcoming weeks show what's next. */
const PAST_DAYS = 31;
const FUTURE_DAYS = 90;
const PER_PAGE = 200;

export type FloatPerson = { people_id: number; name: string; email?: string | null; active?: number; region_id?: number | null };
type FloatProject = { project_id: number; name: string; color?: string; client_id?: number | null; active?: number };
type FloatClient = { client_id: number; name: string };
type FloatTask = {
  task_id: number;
  project_id: number;
  start_date: string;
  end_date: string;
  start_time?: string | null;
  hours: number;
  people_id?: number | null;
  people_ids?: number[] | null;
  status?: number;
  name?: string | null;
  notes?: string | null;
  task_days?: string[];
};
type FloatTimeoff = { timeoff_id: number; start_date: string; end_date: string; full_day?: number; people_ids?: number[]; timeoff_notes?: string | null };
type FloatHoliday = { id: number; name: string; dates: string[] };

async function getAll<T>(path: string, contact?: string): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    const r = await window.api.floatGet(`${path}${sep}page=${page}&per-page=${PER_PAGE}`, contact);
    if (!r.ok) throw new Error(r.status === 401 ? t('float.badToken') : `Float ${r.status}: ${r.error}`);
    out.push(...((r.data as T[]) ?? []));
    if (page >= r.pageCount) return out;
  }
}

export async function fetchPeople(): Promise<FloatPerson[]> {
  const people = await getAll<FloatPerson>('/people?active=1');
  return people.sort((a, b) => a.name.localeCompare(b.name));
}

/** Every weekday in [start, end], used when Float doesn't return task_days. */
function weekdaysBetween(start: string, end: string): string[] {
  const out = [];
  for (let d = new Date(`${start}T12:00`); dayKey(d) <= end; d = addDays(d, 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(dayKey(d));
  }
  return out;
}

export type FloatImport = {
  projects: { floatId: number; name: string; color: string; clientName?: string }[];
  plan: (Omit<PlanItem, 'projectId'> & { floatProjectId: number })[];
  daysOff: { date: string; reason: string }[];
  range: { from: string; to: string };
};

export async function fetchFloatPlan(personId: number, regionId: number | undefined, contact?: string): Promise<FloatImport> {
  const from = dayKey(addDays(new Date(), -PAST_DAYS));
  const to = dayKey(addDays(new Date(), FUTURE_DAYS));
  const range = `start_date=${from}&end_date=${to}`;

  const tasks = await getAll<FloatTask>(`/tasks?people_id=${personId}&${range}&expand=task_days`, contact);
  const mine = tasks.filter((t) => (t.people_id === personId || t.people_ids?.includes(personId)) && t.status !== 0 && t.status !== 4);

  const [projects, clients] = await Promise.all([getAll<FloatProject>('/projects', contact), getAll<FloatClient>('/clients', contact)]);
  const used = new Set(mine.map((t) => t.project_id));
  const clientName = new Map(clients.map((c) => [c.client_id, c.name]));

  const timeoffs = await getAll<FloatTimeoff>(`/timeoffs?${range}`, contact);
  const holidays = regionId ? await getAll<FloatHoliday>(`/public-holidays?${range}&region=${regionId}`, contact) : [];

  const daysOff = new Map<string, string>();
  for (const off of timeoffs) {
    if (!off.people_ids?.includes(personId) || off.full_day === 0) continue;
    for (const d of weekdaysBetween(off.start_date, off.end_date)) daysOff.set(d, off.timeoff_notes || t('float.timeOff'));
  }
  for (const h of holidays) for (const d of h.dates) if (d >= from && d <= to) daysOff.set(d, h.name);

  return {
    projects: projects
      .filter((p) => used.has(p.project_id))
      .map((p) => ({
        floatId: p.project_id,
        name: p.name,
        color: p.color ? `#${p.color.replace('#', '')}` : '#607D8B',
        clientName: p.client_id ? clientName.get(p.client_id) : undefined,
      })),
    plan: mine.map((t) => ({
      floatId: t.task_id,
      floatProjectId: t.project_id,
      name: t.name?.trim() || '',
      notes: t.notes?.trim() || undefined,
      startDate: t.start_date,
      endDate: t.end_date,
      hoursPerDay: t.hours,
      startTime: t.start_time || undefined,
      days: (t.task_days ?? weekdaysBetween(t.start_date, t.end_date)).filter((d) => !daysOff.has(d)),
      tentative: t.status === 1 || undefined,
    })),
    daysOff: [...daysOff].map(([date, reason]) => ({ date, reason })),
    range: { from, to },
  };
}

/** Merge an import into the latest local state. */
export function applyFloatImport(d: Data, imp: FloatImport): Data {
  // Projects: link by Float id, else by name; create the rest. Local goals and entries stay untouched.
  const projects: Project[] = [...d.projects];
  for (const fp of imp.projects) {
    const i = projects.findIndex((p) => p.floatId === fp.floatId);
    const j = i >= 0 ? i : projects.findIndex((p) => !p.floatId && p.name.trim().toLowerCase() === fp.name.trim().toLowerCase());
    if (j >= 0) projects[j] = { ...projects[j], floatId: fp.floatId, name: fp.name, color: fp.color, clientName: fp.clientName };
    else projects.push({ id: uid(), floatId: fp.floatId, name: fp.name, color: fp.color, clientName: fp.clientName });
  }
  const byFloat = new Map(projects.filter((p) => p.floatId).map((p) => [p.floatId!, p.id]));
  const plan: PlanItem[] = imp.plan.map(({ floatProjectId, ...item }) => ({ ...item, projectId: byFloat.get(floatProjectId) ?? '' }));

  // Days off: add Float ones where you haven't recorded anything; drop Float ones that disappeared.
  const off = new Map(imp.daysOff.map((x) => [x.date, x.reason]));
  const inRange = (date: string) => date >= imp.range.from && date <= imp.range.to;
  const workdays: Workday[] = d.workdays.filter((w) => !(w.offSource === 'float' && inRange(w.date) && !off.has(w.date)));
  for (const [date, reason] of off) {
    const i = workdays.findIndex((w) => w.date === date);
    if (i >= 0) {
      if (workdays[i].offSource === 'float') workdays[i] = { ...workdays[i], offReason: reason };
      continue;
    }
    const at = atTime(date, '00:00');
    workdays.push({ date, start: at, end: at, breaks: [], off: true, offReason: reason, offSource: 'float' });
  }

  return { ...d, projects, plan, workdays, settings: { ...d.settings, floatLastSync: new Date().toISOString() } };
}
