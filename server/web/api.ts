// The server API, as the phone uses it. The device key lives in localStorage (same origin only; strict CSP).
export type Project = { id: string; name: string; color: string; dailyGoalHours: number | null };
export type Activity = { id: string; name: string; color: string };
export type Entry = {
  id: string;
  date: string;
  start: string;
  end: string | null;
  running: boolean;
  minutes: number;
  description: string;
  projectId: string | null;
  project: string | null;
  activityId: string | null;
  activity: string | null;
  billable: boolean;
};
export type Workday = { date: string; off: boolean; offReason: string | null; in: string | null; out: string | null; breakMinutes: number; workedMinutes: number };
export type State = {
  device: { id: string; name: string };
  serverTime: string;
  timer: Entry | null;
  workday: Workday | null;
  onBreak: boolean;
  /** Today's single breaks (ISO times). */
  breaks: { start: string; end: string | null }[];
  dailyTargetHours: number;
  projects: Project[];
  activities: Activity[];
};

const KEY = 'gnomon.deviceKey';

export const getKey = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export const setKey = (key: string | null) => {
  try {
    if (key) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the key lasts for this session only */
  }
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Called when the server rejects the key (revoked device), so the app can show the pairing screen. */
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

/** How a request reaches the server: fetch normally; the web demo answers in the browser instead (src/demo). */
export type Transport = (method: string, path: string, body: unknown, key: string | null) => Promise<{ status: number; json: { message?: string } & Record<string, unknown> }>;
const fetchTransport: Transport = async (method, path, body, key) => {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: { ...(key && { Authorization: `Bearer ${key}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
let transport = fetchTransport;
export const setTransport = (t: Transport) => (transport = t);

export async function call<T>(method: string, path: string, body?: unknown, key = getKey()): Promise<T> {
  let res: Awaited<ReturnType<Transport>>;
  try {
    res = await transport(method, path, body, key);
  } catch {
    throw new ApiError(0, 'offline');
  }
  if (res.status === 401 && path !== '/pair') onUnauthorized();
  if (res.status >= 400) throw new ApiError(res.status, res.json.message ?? String(res.status));
  return res.json as T;
}

export const api = {
  state: () => call<State>('GET', '/state'),
  pair: (code: string) => call<{ key: string; device: { name: string } }>('POST', '/pair', { code }, null),
  forgetDevice: () => call('DELETE', '/me'),
  me: (key: string) => call<{ name: string }>('GET', '/me', undefined, key),
  entries: (from: string, to = from) => call<Entry[]>('GET', `/entries?from=${from}&to=${to}`),
  workdays: (from: string, to = from) => call<Workday[]>('GET', `/workdays?from=${from}&to=${to}`),
  start: (b: { description: string; projectId?: string; activityId?: string; project?: string }) => call('POST', '/timer/start', b),
  stop: () => call('POST', '/timer/stop', {}),
  switchActivity: (activityId: string) => call('POST', '/timer/activity', { activityId }),
  startDay: () => call('POST', '/day/start', {}),
  leave: () => call('POST', '/day/leave', {}),
  toggleBreak: () => call('POST', '/day/break', {}),
  addEntry: (b: Record<string, unknown>) => call<Entry>('POST', '/entries', b),
  patchWorkday: (date: string, b: { in?: string; out?: string | null; breaks?: { start: string; end?: string | null }[] }) => call<State>('PATCH', `/workdays/${date}`, b),
  putWorkday: (date: string, b: Record<string, unknown>) => call<Workday>('PUT', `/workdays/${date}`, b),
  deleteWorkday: (date: string) => call('DELETE', `/workdays/${date}`),
  pairCode: (name: string, minutes = 10) => call<{ code: string; expiresAt: string }>('POST', '/pair-codes', { name, minutes }),
  patchEntry: (id: string, b: Record<string, unknown>) => call<Entry>('PATCH', `/entries/${encodeURIComponent(id)}`, b),
  deleteEntry: (id: string) => call('DELETE', `/entries/${encodeURIComponent(id)}`),
};
