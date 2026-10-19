// The routes only the phone app uses, on top of the local API router (src/api.ts): everything the Today screen needs
// in one request, correcting a day's attendance, breaks, switching the activity and adding one. Shared by the Gnomon
// server (server/src/app.ts) and the web demo (src/demo/phone-api.ts), so both answer the phone exactly alike.
import { handleApiRequest, type ApiResponse } from './api';
import { isOnBreak, runningEntry, switchActivity, todayWorkday, toggleBreak, updateWorkday } from './actions';
import { atTime, dayKey } from './time';
import { targetHoursOn } from './schedule';
import type { Data, Workday } from './types';

export type PhoneCtx = { get: () => Data; commit: (d: Data) => void };
export type PhoneDevice = { id: string; name: string };

class PhoneError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const bad = (message: string) => new PhoneError(422, 'invalid', message);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function phoneApi(ctx: PhoneCtx, extra: () => Record<string, unknown> = () => ({})) {
  const api = (method: string, p: string, body?: unknown): ApiResponse => handleApiRequest(ctx, { method, path: p, query: {}, body });
  const ok = (r: ApiResponse) => {
    if (r.status >= 400) throw new PhoneError(r.status, (r.body as { error: string }).error, (r.body as { message: string }).message);
    return r.body;
  };

  /** Everything the phone's Today screen needs in one request. */
  function state(device: PhoneDevice) {
    const d = ctx.get();
    const today = ok(api('GET', '/workdays')) as unknown[];
    return {
      device: { id: device.id, name: device.name },
      serverTime: new Date().toISOString(),
      timer: (ok(api('GET', '/timer')) as { running: unknown }).running,
      workday: today[0] ?? null,
      onBreak: isOnBreak(todayWorkday(d)),
      // The single breaks of today, so the phone can correct them (the API.md workday only has breakMinutes).
      breaks: todayWorkday(d)?.breaks.map((b) => ({ start: b.start, end: b.end ?? null })) ?? [],
      // Today's target from the work schedule (the phone shows progress toward it).
      dailyTargetHours: targetHoursOn(d, dayKey(new Date())),
      projects: ok(api('GET', '/projects')),
      activities: ok(api('GET', '/activities')),
      ...extra(),
    };
  }

  function addActivity(body: unknown): ApiResponse {
    if (!isObj(body)) throw bad('Body must be a JSON object');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120) throw bad('name is required (max 120 characters)');
    const color = body.color;
    if (color !== undefined && (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color))) throw bad('color must look like #03A9F4');
    const d = ctx.get();
    const existing = d.activities.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (existing) return { status: 200, body: { id: existing.id, name: existing.name, color: existing.color } };
    const palette = ['#E91E63', '#9C27B0', '#009688', '#FF9800', '#3F51B5', '#795548', '#607D8B'];
    const a = { id: crypto.randomUUID(), name, color: (color as string | undefined) ?? palette[d.activities.length % palette.length] };
    ctx.commit({ ...d, activities: [...d.activities, a] });
    return { status: 201, body: a };
  }

  /**
   * Correct a day's attendance without replacing it: { in: "08:12", out: "17:05" | null, breaks: [{ start, end }] }.
   * Only the fields you send change; out: null means you're still at work. Times are HH:MM on that day.
   */
  function patchWorkday(date: string, body: unknown, device: PhoneDevice) {
    if (!isObj(body)) throw bad('Body must be a JSON object');
    const d = ctx.get();
    const w = d.workdays.find((x) => x.date === date);
    if (!w || w.off) throw new PhoneError(404, 'not_found', 'No attendance on this day. Start the day first, or use PUT /workdays/:date.');
    const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
    const time = (v: unknown, field: string) => {
      if (typeof v !== 'string' || !TIME.test(v)) throw bad(`${field} must be a time like 08:30`);
      return atTime(date, v);
    };
    const start = body.in !== undefined ? time(body.in, 'in') : w.start;
    const end = body.out === null ? undefined : body.out !== undefined ? time(body.out, 'out') : w.end;
    if (end && end <= start) throw bad('out must be after in');
    if (!end && date !== dayKey(new Date())) throw bad('Only today can stay open (out: null)');
    let breaks = w.breaks;
    if (body.breaks !== undefined) {
      if (!Array.isArray(body.breaks) || body.breaks.length > 20) throw bad('breaks must be a list (at most 20)');
      breaks = body.breaks.map((b: unknown, i: number) => {
        if (!isObj(b)) throw bad(`breaks[${i}] must be an object`);
        const bs = time(b.start, `breaks[${i}].start`);
        const be = b.end === null || b.end === undefined ? undefined : time(b.end, `breaks[${i}].end`);
        if (be && be <= bs) throw bad(`breaks[${i}]: end must be after start`);
        if (bs < start || (end && (be ?? bs) > end)) throw bad(`breaks[${i}] must be between in and out`);
        if (!be && end) throw bad(`breaks[${i}] needs an end once you've left`);
        return { start: bs, ...(be && { end: be }) };
      });
      if (breaks.filter((b) => !b.end).length > 1) throw bad('Only one break can be open');
    }
    ctx.commit(updateWorkday(d, date, { start, end, breaks }));
    return state(device);
  }

  /** The phone-only routes; undefined for anything else (then the shared router or the server answers). */
  function route(method: string, p: string, body: unknown, device: PhoneDevice): ApiResponse | undefined {
    try {
      if (method === 'GET' && p === '/state') return { status: 200, body: state(device) };
      if (method === 'POST' && p === '/activities') return addActivity(body);
      const wd = p.match(/^\/workdays\/(\d{4}-\d{2}-\d{2})$/);
      if (method === 'PATCH' && wd) return { status: 200, body: patchWorkday(wd[1], body, device) };
      if (method === 'POST' && p === '/day/break') {
        const d = ctx.get();
        const w: Workday | undefined = todayWorkday(d);
        if (!w || w.end) throw new PhoneError(409, 'not_at_work', 'Start the day before taking a break');
        ctx.commit(toggleBreak(d));
        return { status: 200, body: state(device) };
      }
      if (method === 'POST' && p === '/timer/activity') {
        if (!isObj(body) || typeof body.activityId !== 'string') throw bad('activityId is required');
        const d = ctx.get();
        if (!runningEntry(d)) throw new PhoneError(409, 'no_timer', 'No timer is running');
        if (!d.activities.some((a) => a.id === body.activityId)) throw bad(`Unknown activityId ${body.activityId}`);
        ctx.commit(switchActivity(d, body.activityId));
        return api('GET', '/timer');
      }
      return undefined;
    } catch (err) {
      if (err instanceof PhoneError) return { status: err.status, body: { error: err.code, message: err.message } };
      throw err;
    }
  }

  return { route, api };
}
