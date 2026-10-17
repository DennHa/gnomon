// Sync with a Gnomon server (server/README.md → "Sync"): pure functions; the store runs them and the main process
// does the HTTP calls (it holds the key).
//
// The Mac remembers the last state it agreed on with the server (`base`: the JSON of every synced record) and a
// cursor. A sync pulls the server's changes since the cursor, finds what changed on the Mac since `base`, merges
// both, pushes the Mac's changes, and then stores the new agreed state. When the same record changed on both sides
// between two syncs, the later edit wins: the store remembers when each record changed on the Mac (`changedAt`), the
// server stamps the phone's changes.
import type { Activity, Data, Entry, Project, Workday } from './types';

export const KINDS = ['projects', 'activities', 'entries', 'workdays'] as const;
export type Kind = (typeof KINDS)[number];
type AnyRecord = Project | Activity | Entry | Workday;

export type Change = { kind: Kind; id: string; updatedAt: string; deleted: boolean; data: AnyRecord | null };
/** `${kind}:${id}` → JSON of the record as last agreed with the server. */
export type Base = Record<string, string>;
export type SyncState = { cursor: number; base: Base; at?: string };

/** When a record (by key) last changed on the Mac; records it doesn't know count as changed `now`. */
export type ChangedAt = (key: string) => string | undefined;

export const keyOf = (kind: Kind, r: AnyRecord) => `${kind}:${kind === 'workdays' ? (r as Workday).date : (r as { id: string }).id}`;
const idOf = (key: string) => key.slice(key.indexOf(':') + 1);
const kindOf = (key: string) => key.slice(0, key.indexOf(':')) as Kind;

/** Every syncable record of a Data, by key. */
export function recordsOf(d: Data): Map<string, AnyRecord> {
  const m = new Map<string, AnyRecord>();
  for (const kind of KINDS) for (const r of d[kind] as AnyRecord[]) m.set(keyOf(kind, r), r);
  return m;
}

export function baseOf(d: Data): Base {
  const b: Base = {};
  for (const [k, r] of recordsOf(d)) b[k] = JSON.stringify(r);
  return b;
}

/** The same checks the server makes; a record it would reject is not sent (it would fail the whole batch). */
export function validRecord(kind: Kind, id: string, data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const r = data as Record<string, unknown>;
  const iso = (v: unknown) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
  const s = (v: unknown, max = 2000) => typeof v === 'string' && v.length <= max;
  if (kind === 'workdays') return r.date === id && /^\d{4}-\d{2}-\d{2}$/.test(id) && iso(r.start) && (r.end === undefined || iso(r.end)) && Array.isArray(r.breaks);
  if (r.id !== id || id.length > 200) return false;
  if (kind === 'entries') return iso(r.start) && (r.end === undefined || iso(r.end)) && (r.description === undefined || s(r.description));
  return s(r.name, 200) && (r.color === undefined || (typeof r.color === 'string' && /^#([0-9a-fA-F]{3}){1,2}$/.test(r.color)));
}

/** What changed on the Mac since the last agreed state. */
export function localChanges(d: Data, base: Base, now: string, changedAt: ChangedAt = () => undefined): Change[] {
  const out: Change[] = [];
  const at = (k: string) => changedAt(k) ?? now;
  const recs = recordsOf(d);
  for (const [k, r] of recs) {
    const json = JSON.stringify(r);
    if (base[k] !== json) out.push({ kind: kindOf(k), id: idOf(k), updatedAt: at(k), deleted: false, data: r });
  }
  for (const k of Object.keys(base)) if (!recs.has(k)) out.push({ kind: kindOf(k), id: idOf(k), updatedAt: at(k), deleted: true, data: null });
  return out;
}

/**
 * Note when records changed on the Mac: compares two states by object identity (every action replaces only the
 * records it changes), so it's cheap enough to run on every change.
 */
export function markChanges(prev: Data, next: Data, changedAt: Map<string, string>, now: string) {
  for (const kind of KINDS) {
    if (prev[kind] === next[kind]) continue;
    const before = new Map((prev[kind] as AnyRecord[]).map((r) => [keyOf(kind, r), r]));
    for (const r of next[kind] as AnyRecord[]) {
      const k = keyOf(kind, r);
      if (before.get(k) !== r) changedAt.set(k, now);
      before.delete(k);
    }
    for (const k of before.keys()) changedAt.set(k, now); // deleted
  }
}

/** Put records into a Data (or remove them), keeping the order of the ones that stay. */
function applyRecords(d: Data, changes: Map<string, AnyRecord | null>): Data {
  if (!changes.size) return d;
  const next = { ...d };
  for (const kind of KINDS) {
    const mine = [...changes].filter(([k]) => kindOf(k) === kind);
    if (!mine.length) continue;
    const list = (d[kind] as AnyRecord[]).flatMap((r) => {
      const k = keyOf(kind, r);
      if (!changes.has(k)) return [r];
      const v = changes.get(k);
      return v ? [v] : [];
    });
    const present = new Set(list.map((r) => keyOf(kind, r)));
    for (const [k, v] of mine) if (v && !present.has(k)) list.push(v);
    (next as Record<Kind, AnyRecord[]>)[kind] = list;
  }
  return next;
}

/** Two devices may each have started a timer: keep the newest, end the others when it began. */
export function oneRunningTimer(d: Data, now: string): Data {
  const running = d.entries.filter((e) => !e.end).sort((a, b) => b.start.localeCompare(a.start));
  if (running.length < 2) return d;
  const keep = running[0];
  return { ...d, entries: d.entries.map((e) => (e.end || e.id === keep.id ? e : { ...e, end: keep.start > e.start ? keep.start : now })) };
}

/** A day stamped on both devices before their first sync: earliest arrival, latest leaving, all breaks. */
function mergeWorkdays(a: Workday, b: Workday): Workday {
  if (a.off || b.off) return a.off ? a : b;
  const start = a.start < b.start ? a.start : b.start;
  const end = !a.end || !b.end ? undefined : a.end > b.end ? a.end : b.end;
  const seen = new Set<string>();
  const breaks = [...a.breaks, ...b.breaks].filter((x) => !seen.has(x.start) && seen.add(x.start)).sort((x, y) => x.start.localeCompare(y.start));
  return { ...a, start, end, breaks };
}

export type SyncPlan = {
  /** The Mac's data with the server's changes merged in. */
  merged: Data;
  /** What to send to the server. */
  push: Change[];
  /** Records the server would reject; they stay on the Mac only. */
  invalid: string[];
  /** The server's version of each record it sent, in case the server keeps its own version after the push. */
  remote: Map<string, AnyRecord | null>;
};

/**
 * Merge the server's changes into the Mac's data and work out what to push. `first` is the very first sync with
 * this server: projects and activities with the same name are joined (the Mac's id stays), and the server's
 * unused starter activities are dropped, so nothing appears twice.
 */
export function planSync(local: Data, base: Base, incoming: Change[], opts: { first: boolean; now: string; changedAt?: ChangedAt }): SyncPlan {
  // Latest server version per record, and when the server got it.
  const remote = new Map<string, AnyRecord | null>();
  const remoteAt = new Map<string, string>();
  for (const c of incoming) {
    remote.set(`${c.kind}:${c.id}`, c.deleted ? null : c.data);
    remoteAt.set(`${c.kind}:${c.id}`, c.updatedAt);
  }
  // What the server holds after these changes (before any first-sync rewriting below).
  const serverView: Base = { ...base };
  for (const [k, r] of remote) {
    if (r) serverView[k] = JSON.stringify(r);
    else delete serverView[k];
  }
  const extraPush: Change[] = [];

  if (opts.first) {
    // Join projects/activities by name: rewrite the server's entries to the Mac's ids, delete the server's copies.
    const ids = new Map<string, string>();
    for (const kind of ['projects', 'activities'] as const) {
      const byName = new Map((local[kind] as (Project | Activity)[]).map((r) => [r.name.trim().toLowerCase(), r.id]));
      for (const [k, r] of remote) {
        if (kindOf(k) !== kind || !r) continue;
        const mine = byName.get((r as Project).name.trim().toLowerCase());
        if (mine && mine !== (r as Project).id) {
          ids.set(`${kind}:${(r as Project).id}`, mine);
          remote.delete(k);
          extraPush.push({ kind, id: idOf(k), updatedAt: opts.now, deleted: true, data: null });
        }
      }
    }
    const used = new Set<string>();
    for (const [k, r] of remote) {
      if (kindOf(k) !== 'entries' || !r) continue;
      const e = { ...(r as Entry) };
      if (e.projectId && ids.has(`projects:${e.projectId}`)) e.projectId = ids.get(`projects:${e.projectId}`);
      if (e.activityId && ids.has(`activities:${e.activityId}`)) e.activityId = ids.get(`activities:${e.activityId}`);
      if (e.activityId) used.add(e.activityId);
      remote.set(k, e);
    }
    // The server's starter activities nobody used on the phone: the Mac's own list replaces them.
    if (local.activities.length)
      for (const [k, r] of remote)
        if (kindOf(k) === 'activities' && r && !used.has((r as Activity).id) && !local.entries.some((e) => e.activityId === (r as Activity).id)) {
          remote.delete(k);
          extraPush.push({ kind: 'activities', id: idOf(k), updatedAt: opts.now, deleted: true, data: null });
        }
  }

  const changedAt = opts.changedAt ?? (() => undefined);
  const changedHere = new Map(localChanges(local, base, opts.now, changedAt).map((c) => [`${c.kind}:${c.id}`, c.updatedAt]));
  const take = new Map<string, AnyRecord | null>();
  const localRecs = recordsOf(local);
  for (const [k, r] of remote) {
    if (!changedHere.has(k)) take.set(k, r);
    else if (opts.first && kindOf(k) === 'workdays' && r && localRecs.has(k)) take.set(k, mergeWorkdays(localRecs.get(k) as Workday, r as Workday));
    // Changed on both sides: the later edit wins (on a tie, the Mac's).
    else if ((remoteAt.get(k) ?? '') > changedHere.get(k)!) take.set(k, r);
  }
  let merged = applyRecords(local, take);
  merged = oneRunningTimer(merged, opts.now);

  // Push everything that now differs from what the server has: the Mac's own changes, merged days, stopped timers.
  // (Records the first sync joined by name were deleted on the server already, via extraPush.)
  for (const c of extraPush) delete serverView[`${c.kind}:${c.id}`];
  const invalid: string[] = [];
  const push = [
    ...extraPush,
    ...localChanges(merged, serverView, opts.now, changedAt).filter((c) => {
      if (c.deleted || validRecord(c.kind, c.id, c.data)) return true;
      invalid.push(`${c.kind}:${c.id}`);
      return false;
    }),
  ];
  return { merged, push, invalid, remote };
}

/**
 * Bring the result of a sync into the live data. Records changed on the Mac while the sync was running keep the
 * Mac's version (they're pushed next time); everything else takes the synced version. Returns `live` unchanged
 * when nothing differs, so a sync doesn't cause another one.
 */
export function rebase(live: Data, before: Data, synced: Data): Data {
  const liveRecs = recordsOf(live);
  const beforeRecs = recordsOf(before);
  const syncedRecs = recordsOf(synced);
  const changes = new Map<string, AnyRecord | null>();
  const keys = new Set([...beforeRecs.keys(), ...syncedRecs.keys()]);
  for (const k of keys) {
    const touched = JSON.stringify(liveRecs.get(k)) !== JSON.stringify(beforeRecs.get(k));
    if (touched) continue;
    const s = syncedRecs.get(k) ?? null;
    if (JSON.stringify(liveRecs.get(k) ?? null) !== JSON.stringify(s)) changes.set(k, s);
  }
  return applyRecords(live, changes);
}

/** Apply a list of server changes on top of a Data (after the push: the server's final word, e.g. a stopped timer). */
export function applyChanges(d: Data, changes: Change[]): Data {
  const m = new Map<string, AnyRecord | null>();
  for (const c of changes) m.set(`${c.kind}:${c.id}`, c.deleted ? null : c.data);
  return applyRecords(d, m);
}
