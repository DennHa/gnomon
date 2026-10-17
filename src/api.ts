// The local REST API (documented in API.md). The main process does auth and HTTP; this router
// validates input and applies changes through the same actions the UI uses.
import { addProject, appendEntry, deleteEntry, leave, runningEntry, startDay, startTimer, stopTimer, updateEntry, updateProject } from './actions';
import type { Data, Entry, Project, Workday } from './types';
import { atTime, breakMs, dayKey, entryMs, uid, workdayMs } from './time';

export type ApiRequest = { method: string; path: string; query: Record<string, string>; body: unknown };
export type ApiResponse = { status: number; body: unknown };

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const bad = (message: string) => new ApiError(422, 'invalid', message);
const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`);

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date in YYYY-MM-DD (2026-13-01 or 2026-02-30 are rejected). */
const DATE = { test: (s: string) => DATE_FORMAT.test(s) && dayKey(new Date(`${s}T12:00`)) === s };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, field: string, max = 500): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || v.length > max) throw bad(`${field} must be a string (max ${max} characters)`);
  return v;
};
const iso = (v: unknown, field: string): string | undefined => {
  const s = str(v, field, 40);
  if (s === undefined) return undefined;
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw bad(`${field} must be an ISO 8601 date-time, e.g. 2026-10-16T09:30:00+02:00`);
  return new Date(t).toISOString();
};

function range(q: Record<string, string>): { from: string; to: string } {
  const today = dayKey(new Date());
  const from = q.from ?? today;
  const to = q.to ?? from;
  if (!DATE.test(from) || !DATE.test(to)) throw bad('from and to must be dates like 2026-10-16');
  if (to < from) throw bad('to must not be before from');
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 400) throw bad('The range can be at most 400 days');
  return { from, to };
}

// ---- Serialisation: stable, documented shapes (no internal flags) ------------------

const minutes = (ms: number) => Math.round(ms / 60_000);

function projectOut(p: Project) {
  return { id: p.id, name: p.name, color: p.color, dailyGoalHours: p.dailyGoalHours ?? null, client: p.clientName ?? null, externalId: p.externalId ?? null, floatId: p.floatId ?? null };
}

function entryOut(d: Data, e: Entry) {
  const p = d.projects.find((x) => x.id === e.projectId);
  const a = d.activities.find((x) => x.id === e.activityId);
  return {
    id: e.id,
    externalId: e.externalId ?? null,
    date: dayKey(e.start),
    start: e.start,
    end: e.end ?? null,
    running: !e.end,
    minutes: minutes(entryMs(e)),
    description: e.description,
    projectId: e.projectId ?? null,
    project: p?.name ?? null,
    activityId: e.activityId ?? null,
    activity: a?.name ?? null,
    task: e.taskName ?? null,
    billable: Boolean(e.billable),
  };
}

function workdayOut(w: Workday) {
  return {
    date: w.date,
    off: Boolean(w.off),
    offReason: w.offReason ?? null,
    offKind: w.offKind ?? null,
    in: w.off ? null : w.start,
    out: w.off ? null : w.end ?? null,
    breakMinutes: w.off ? 0 : minutes(breakMs(w)),
    workedMinutes: w.off ? 0 : minutes(workdayMs(w)),
  };
}

// ---- Lookups ------------------------------------------------------------------------

function findProject(d: Data, ref: string): Project | undefined {
  if (ref.startsWith('ext:')) return d.projects.find((p) => p.externalId === ref.slice(4));
  return d.projects.find((p) => p.id === ref);
}

function findEntry(d: Data, ref: string): Entry | undefined {
  if (ref.startsWith('ext:')) return d.entries.find((e) => e.externalId === ref.slice(4));
  return d.entries.find((e) => e.id === ref);
}

/** Resolve projectId / project (name) / projectExternalId; a new name creates the project. */
function resolveProject(d: Data, b: Record<string, unknown>): { data: Data; projectId?: string } {
  const id = str(b.projectId, 'projectId');
  if (id) {
    if (!d.projects.some((p) => p.id === id)) throw bad(`Unknown projectId ${id}`);
    return { data: d, projectId: id };
  }
  const ext = str(b.projectExternalId, 'projectExternalId');
  if (ext) {
    const p = d.projects.find((x) => x.externalId === ext);
    if (!p) throw bad(`No project with externalId ${ext}. Create it with POST /projects first.`);
    return { data: d, projectId: p.id };
  }
  const name = str(b.project, 'project', 120)?.trim();
  if (!name) return { data: d };
  const existing = d.projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) return { data: d, projectId: existing.id };
  const newId = uid();
  return { data: addProject(d, name, undefined, newId), projectId: newId };
}

function resolveActivity(d: Data, b: Record<string, unknown>): string | undefined {
  const id = str(b.activityId, 'activityId');
  if (id) {
    if (!d.activities.some((a) => a.id === id)) throw bad(`Unknown activityId ${id}`);
    return id;
  }
  const name = str(b.activity, 'activity', 120)?.trim().toLowerCase();
  if (!name) return undefined;
  const a = d.activities.find((x) => x.name.toLowerCase() === name);
  if (!a) throw bad(`Unknown activity "${b.activity}". Known: ${d.activities.map((x) => x.name).join(', ')}`);
  return a.id;
}

// ---- Handlers ---------------------------------------------------------------------------

type Ctx = { get: () => Data; commit: (d: Data) => void };

function createOrUpdateEntry(ctx: Ctx, raw: unknown): ApiResponse {
  if (!isObj(raw)) throw bad('Body must be a JSON object');
  let d = ctx.get();
  const externalId = str(raw.externalId, 'externalId', 200);
  const existing = externalId ? d.entries.find((e) => e.externalId === externalId) : undefined;

  const resolved = resolveProject(d, raw);
  d = resolved.data;
  const fields: Partial<Entry> = {
    description: str(raw.description, 'description', 2000)?.trim() ?? existing?.description ?? '',
    projectId: resolved.projectId ?? existing?.projectId,
    activityId: resolveActivity(d, raw) ?? existing?.activityId,
    billable: raw.billable === undefined ? existing?.billable : Boolean(raw.billable),
    externalId,
  };

  let start = iso(raw.start, 'start');
  let end = iso(raw.end, 'end');
  const date = str(raw.date, 'date', 10);
  const mins = raw.minutes;
  if (!start && date !== undefined) {
    if (!DATE.test(date)) throw bad('date must look like 2026-10-16');
    if (typeof mins !== 'number' || !(mins > 0) || mins > 24 * 60) throw bad('minutes must be a number between 1 and 1440 when you send date');
    if (existing) {
      start = existing.start;
      end = new Date(Date.parse(start) + mins * 60_000).toISOString();
    } else {
      const next = appendEntry(d, date, mins * 60_000, fields);
      ctx.commit(next);
      return { status: 201, body: entryOut(next, next.entries[next.entries.length - 1]) };
    }
  }
  if (!start && existing) (start = existing.start), (end = end ?? existing.end);
  if (!start || !end) throw bad('Send either start and end (ISO date-times) or date and minutes');
  if (end <= start) throw bad('end must be after start');
  if (Date.parse(end) - Date.parse(start) > 24 * 3_600_000) throw bad('An entry can be at most 24 hours long');

  if (existing) {
    const next = updateEntry(d, existing.id, { ...fields, start, end });
    ctx.commit(next);
    return { status: 200, body: entryOut(next, findEntry(next, existing.id)!) };
  }
  const entry: Entry = { id: uid(), description: '', ...fields, start, end };
  const next = { ...d, entries: [...d.entries, entry] };
  ctx.commit(next);
  return { status: 201, body: entryOut(next, entry) };
}

function route(ctx: Ctx, req: ApiRequest): ApiResponse {
  const { method, query } = req;
  const parts = req.path.split('/').filter(Boolean).map(decodeURIComponent);
  const [res, id, sub] = parts;
  const d = ctx.get();

  if (res === 'health' && method === 'GET') return { status: 200, body: { ok: true, app: 'Gnomon', apiVersion: 1 } };

  if (res === 'projects') {
    if (method === 'GET' && !id) return { status: 200, body: d.projects.map(projectOut) };
    if (method === 'GET' && id) {
      const p = findProject(d, id);
      if (!p) throw notFound('Project');
      return { status: 200, body: projectOut(p) };
    }
    if (method === 'POST' && !id) {
      const b = req.body;
      if (!isObj(b)) throw bad('Body must be a JSON object');
      const name = str(b.name, 'name', 120)?.trim();
      if (!name) throw bad('name is required');
      const color = str(b.color, 'color', 7);
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw bad('color must look like #03A9F4');
      const goal = b.dailyGoalHours;
      if (goal !== undefined && goal !== null && (typeof goal !== 'number' || goal < 0 || goal > 24)) throw bad('dailyGoalHours must be 0–24');
      const externalId = str(b.externalId, 'externalId', 200);
      const existing = (externalId && d.projects.find((p) => p.externalId === externalId)) || d.projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        const next = updateProject(d, existing.id, { name, ...(color && { color }), ...(goal !== undefined && { dailyGoalHours: (goal as number) || undefined }), ...(externalId && { externalId }) });
        ctx.commit(next);
        return { status: 200, body: projectOut(findProject(next, existing.id)!) };
      }
      const newId = uid();
      let next = addProject(d, name, color, newId);
      next = updateProject(next, newId, { externalId, dailyGoalHours: (goal as number) || undefined });
      ctx.commit(next);
      return { status: 201, body: projectOut(findProject(next, newId)!) };
    }
    if (method === 'PATCH' && id) {
      const p = findProject(d, id);
      if (!p) throw notFound('Project');
      const b = req.body;
      if (!isObj(b)) throw bad('Body must be a JSON object');
      const patch: Partial<Project> = {};
      if (b.name !== undefined) patch.name = str(b.name, 'name', 120)!.trim() || p.name;
      if (b.color !== undefined) {
        const c = str(b.color, 'color', 7)!;
        if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw bad('color must look like #03A9F4');
        patch.color = c;
      }
      if (b.dailyGoalHours !== undefined) patch.dailyGoalHours = typeof b.dailyGoalHours === 'number' && b.dailyGoalHours > 0 ? b.dailyGoalHours : undefined;
      if (b.externalId !== undefined) patch.externalId = str(b.externalId, 'externalId', 200);
      const next = updateProject(d, p.id, patch);
      ctx.commit(next);
      return { status: 200, body: projectOut(findProject(next, p.id)!) };
    }
  }

  if (res === 'activities' && method === 'GET' && !id) return { status: 200, body: d.activities.map((a) => ({ id: a.id, name: a.name, color: a.color })) };

  if (res === 'entries') {
    if (method === 'GET' && !id) {
      const { from, to } = range(query);
      const project = query.projectId ? findProject(d, query.projectId) : undefined;
      if (query.projectId && !project) throw notFound('Project');
      const list = d.entries
        .filter((e) => {
          const k = dayKey(e.start);
          return k >= from && k <= to && (!project || e.projectId === project.id);
        })
        .sort((a, b) => a.start.localeCompare(b.start));
      return { status: 200, body: list.map((e) => entryOut(d, e)) };
    }
    if (method === 'GET' && id) {
      const e = findEntry(d, id);
      if (!e) throw notFound('Entry');
      return { status: 200, body: entryOut(d, e) };
    }
    if (method === 'POST' && !id) return createOrUpdateEntry(ctx, req.body);
    if (method === 'PATCH' && id) {
      const e = findEntry(d, id);
      if (!e) throw notFound('Entry');
      if (!isObj(req.body)) throw bad('Body must be a JSON object');
      return patchEntry(ctx, e, req.body);
    }
    if (method === 'DELETE' && id) {
      const e = findEntry(d, id);
      if (!e) throw notFound('Entry');
      ctx.commit(deleteEntry(d, e.id));
      return { status: 200, body: { deleted: e.id } };
    }
  }

  if (res === 'workdays') {
    if (method === 'GET' && !id) {
      const { from, to } = range(query);
      return { status: 200, body: d.workdays.filter((w) => w.date >= from && w.date <= to).sort((a, b) => a.date.localeCompare(b.date)).map(workdayOut) };
    }
    if (method === 'PUT' && id) {
      if (!DATE.test(id)) throw bad('Use a date like /workdays/2026-10-16');
      const b = req.body;
      if (!isObj(b)) throw bad('Body must be a JSON object');
      let w: Workday;
      if (b.off) {
        const at = atTime(id, '00:00');
        if (b.kind !== undefined && b.kind !== 'overtime' && b.kind !== null) throw bad('kind must be "overtime" or left out');
        w = { date: id, start: at, end: at, breaks: [], off: true, offReason: str(b.reason, 'reason', 120), offKind: b.kind === 'overtime' ? 'overtime' : undefined };
      } else {
        const tin = str(b.in, 'in', 5), tout = str(b.out, 'out', 5);
        if (!tin || !TIME.test(tin)) throw bad('in must be a time like 08:30');
        if (tout !== undefined && !TIME.test(tout)) throw bad('out must be a time like 17:15');
        if (tout && tout <= tin) throw bad('out must be after in');
        const bm = b.breakMinutes ?? 0;
        if (typeof bm !== 'number' || bm < 0 || bm > 600) throw bad('breakMinutes must be 0–600');
        const bStart = atTime(id, '12:00');
        w = { date: id, start: atTime(id, tin), end: tout ? atTime(id, tout) : undefined, breaks: bm ? [{ start: bStart, end: new Date(Date.parse(bStart) + bm * 60_000).toISOString() }] : [] };
      }
      const next = { ...d, workdays: [...d.workdays.filter((x) => x.date !== id), w] };
      ctx.commit(next);
      return { status: 200, body: workdayOut(w) };
    }
    if (method === 'DELETE' && id) {
      if (!d.workdays.some((w) => w.date === id)) throw notFound('Workday');
      ctx.commit({ ...d, workdays: d.workdays.filter((w) => w.date !== id) });
      return { status: 200, body: { deleted: id } };
    }
  }

  if (res === 'timer') {
    if (method === 'GET' && !id) {
      const r = runningEntry(d);
      return { status: 200, body: { running: r ? entryOut(d, r) : null } };
    }
    if (method === 'POST' && id === 'start') {
      const b = isObj(req.body) ? req.body : {};
      const { data, projectId } = resolveProject(d, b);
      const next = startTimer(data, { description: str(b.description, 'description', 2000) ?? '', projectId, activityId: resolveActivity(data, b), billable: Boolean(b.billable) });
      ctx.commit(next);
      return { status: 201, body: { running: entryOut(next, runningEntry(next)!) } };
    }
    if (method === 'POST' && id === 'stop') {
      const r = runningEntry(d);
      if (!r) return { status: 200, body: { stopped: null } };
      const next = stopTimer(d);
      ctx.commit(next);
      return { status: 200, body: { stopped: entryOut(next, findEntry(next, r.id)!) } };
    }
  }

  if (res === 'day' && method === 'POST' && (id === 'start' || id === 'leave') && !sub) {
    const next = id === 'start' ? startDay(d) : leave(d);
    ctx.commit(next);
    const w = next.workdays.find((x) => x.date === dayKey(new Date()));
    return { status: 200, body: w ? workdayOut(w) : null };
  }

  if (res === 'summary' && method === 'GET') {
    const { from, to } = range(query);
    const entries = d.entries.filter((e) => {
      const k = dayKey(e.start);
      return k >= from && k <= to;
    });
    const byProject = new Map<string, number>();
    const byDay = new Map<string, { tracked: number; worked: number }>();
    for (const e of entries) {
      const k = e.projectId ?? '';
      byProject.set(k, (byProject.get(k) ?? 0) + entryMs(e));
      const day = byDay.get(dayKey(e.start)) ?? { tracked: 0, worked: 0 };
      day.tracked += entryMs(e);
      byDay.set(dayKey(e.start), day);
    }
    for (const w of d.workdays.filter((x) => x.date >= from && x.date <= to && !x.off)) {
      const day = byDay.get(w.date) ?? { tracked: 0, worked: 0 };
      day.worked = workdayMs(w);
      byDay.set(w.date, day);
    }
    const days = [...byDay].sort((a, b) => a[0].localeCompare(b[0]));
    return {
      status: 200,
      body: {
        from,
        to,
        trackedMinutes: minutes(days.reduce((s, [, v]) => s + v.tracked, 0)),
        workedMinutes: minutes(days.reduce((s, [, v]) => s + v.worked, 0)),
        byProject: [...byProject].map(([pid, ms]) => ({ projectId: pid || null, project: d.projects.find((p) => p.id === pid)?.name ?? null, minutes: minutes(ms) })),
        byDay: days.map(([date, v]) => ({ date, trackedMinutes: minutes(v.tracked), workedMinutes: minutes(v.worked) })),
      },
    };
  }

  throw new ApiError(404, 'not_found', `No route for ${method} ${req.path}`);
}

/** Change only the fields that are sent. */
function patchEntry(ctx: Ctx, e: Entry, b: Record<string, unknown>): ApiResponse {
  let d = ctx.get();
  const patch: Partial<Entry> = {};
  if (b.description !== undefined) patch.description = (str(b.description, 'description', 2000) ?? '').trim();
  if (b.projectId !== undefined || b.project !== undefined || b.projectExternalId !== undefined) {
    const r = resolveProject(d, b);
    d = r.data;
    patch.projectId = r.projectId;
    patch.taskId = undefined;
    patch.taskName = undefined;
  }
  if (b.activityId !== undefined || b.activity !== undefined) patch.activityId = resolveActivity(d, b);
  if (b.billable !== undefined) patch.billable = Boolean(b.billable);
  if (b.externalId !== undefined) patch.externalId = str(b.externalId, 'externalId', 200);
  const start = iso(b.start, 'start') ?? e.start;
  let end = iso(b.end, 'end') ?? e.end;
  if (b.minutes !== undefined) {
    if (typeof b.minutes !== 'number' || !(b.minutes > 0) || b.minutes > 24 * 60) throw bad('minutes must be 1–1440');
    end = new Date(Date.parse(start) + b.minutes * 60_000).toISOString();
  }
  if (end && end <= start) throw bad('end must be after start');
  if (b.start !== undefined) patch.start = start;
  if (end !== e.end) patch.end = end;
  const next = updateEntry(d, e.id, patch);
  ctx.commit(next);
  return { status: 200, body: entryOut(next, findEntry(next, e.id)!) };
}

export function handleApiRequest(ctx: Ctx, req: ApiRequest): ApiResponse {
  try {
    return route(ctx, req);
  } catch (err) {
    if (err instanceof ApiError) return { status: err.status, body: { error: err.code, message: err.message } };
    console.error(err);
    return { status: 500, body: { error: 'internal', message: 'Something went wrong in Gnomon' } };
  }
}
