import assert from 'node:assert/strict';
import * as A from '../src/actions';
import { parseDuration, dayKey, atTime } from '../src/time';
import { applyFloatImport, type FloatImport } from '../src/float';
import { applyPersonioImport, mapPersonioAbsences, periodDays, type PersonioPeriod } from '../src/personio';
import { goalFor } from '../src/plan';
import { balanceByMonth } from '../src/balance';
import { daySummary, weekSummary } from '../src/motion';
import { daylight, moonPhase, sunMoon } from '../src/daylight';
import { fitAll, fitWorkdays } from '../src/fit';
import { toAssign, weekReminderDue, weekToAssign } from '../src/reminders';
import { removeSchedule, setSchedule, targetHoursOn, weekTotal, schedulesOf } from '../src/schedule';
import { accelFromEvent, prettyAccel, projectAccel } from '../src/shortcuts';
import type { Data } from '../src/types';
import * as Sync from '../src/sync';
import { setLanguage, t, trayStrings } from '../src/i18n';

let passed = 0;
const test = (name: string, fn: () => void) => { try { fn(); passed++; console.log('✓', name); } catch (e) { console.log('✗', name, '\n  ', (e as Error).message); process.exitCode = 1; } };
const H = 3_600_000, M = 60_000;
const today = dayKey(new Date());
const base = (): Data => ({ version: 1, projects: [{ id: 'p1', name: 'XYZ', color: '#111111' }, { id: 'p2', name: 'Other', color: '#222222' }], activities: [{ id: 'a1', name: 'Call', color: '#333' }, { id: 'a2', name: 'Design', color: '#444' }], entries: [], workdays: [], plan: [], reviewedWeeks: [],
  settings: { dailyTargetHours: 8, autoStartDay: false, startDayWithTimer: false, shortcutsEnabled: true, idleMinutes: 10, reviewOnLeave: true, menuBarLabel: 'task', menuBarColor: 'project', activityTrail: false } });
const total = (d: Data, pid: string | undefined, day: string) => d.entries.filter((e) => e.end && e.projectId === pid && dayKey(e.start) === day).reduce((s, e) => s + Date.parse(e.end!) - Date.parse(e.start), 0);

test('parseDuration understands common inputs', () => {
  assert.equal(parseDuration('2'), 2 * H); assert.equal(parseDuration('2,5'), 2.5 * H); assert.equal(parseDuration('2.25'), 2.25 * H);
  assert.equal(parseDuration('2:30'), 2.5 * H); assert.equal(parseDuration('1h 30m'), 1.5 * H); assert.equal(parseDuration('90m'), 90 * M);
  assert.equal(parseDuration(''), 0); assert.equal(parseDuration('abc'), null); assert.equal(parseDuration('2:3x'), null);
});
test('appendEntry places time after the day\'s last entry', () => {
  let d = A.appendEntry(base(), '2026-10-12', 2 * H, { projectId: 'p1' });
  d = A.appendEntry(d, '2026-10-12', 30 * M, { projectId: 'p2' });
  assert.equal(d.entries[1].start, d.entries[0].end);
  assert.equal(d.entries[0].start, atTime('2026-10-12', '09:00'));
  assert.equal(A.appendEntry(d, '2026-10-12', 30_000, {}).entries.length, 2, 'under a minute is ignored');
});
test('setDayTotal grows and shrinks a project\'s day', () => {
  let d = A.appendEntry(base(), '2026-10-12', 1 * H, { projectId: 'p1' });
  d = A.appendEntry(d, '2026-10-12', 1 * H, { projectId: 'p1' });
  d = A.setDayTotal(d, 'p1', '2026-10-12', 3 * H); assert.equal(total(d, 'p1', '2026-10-12'), 3 * H);
  d = A.setDayTotal(d, 'p1', '2026-10-12', 90 * M); assert.equal(total(d, 'p1', '2026-10-12'), 90 * M);
  d = A.setDayTotal(d, 'p1', '2026-10-12', 0); assert.equal(total(d, 'p1', '2026-10-12'), 0);
});
const withPlan = (): Data => ({ ...base(), plan: [
  { floatId: 11, projectId: 'p1', name: 'Design', startDate: today, endDate: today, hoursPerDay: 3, days: [today] },
  { floatId: 12, projectId: 'p1', name: 'Deck', startDate: today, endDate: today, hoursPerDay: 1, days: [today] },
] });
test('startTimer picks the task when there is exactly one, not when there are two', () => {
  const one = { ...withPlan(), plan: withPlan().plan.slice(0, 1) };
  assert.equal(A.runningEntry(A.startTimer(one, { description: '', projectId: 'p1' }))?.taskId, 11);
  assert.equal(A.runningEntry(A.startTimer(withPlan(), { description: '', projectId: 'p1' }))?.taskId, undefined);
});
test('planGaps per task; untasked time counts toward the first task', () => {
  let d = A.appendEntry(withPlan(), today, 1 * H, { projectId: 'p1' });           // untasked 1h
  d = A.appendEntry(d, today, 30 * M, { projectId: 'p1', taskId: 12 });          // Deck 30m
  const g = A.planGaps(d, today);
  assert.deepEqual(g.map((x) => [x.taskId, x.ms / M]), [[11, 120], [12, 30]]);
  d = A.fillGaps(d, today, g);
  assert.equal(A.planGaps(d, today).length, 0);
});
test('goalFor: day off cancels plan; manual goal only on weekdays', () => {
  const d = withPlan();
  assert.equal(goalFor(d, 'p1', today), 4 * H);
  const off = { ...d, workdays: [{ date: today, start: atTime(today, '00:00'), end: atTime(today, '00:00'), breaks: [], off: true }] };
  assert.equal(goalFor(off, 'p1', today), 0);
  const manual = { ...base(), projects: [{ id: 'p1', name: 'X', color: '#1', dailyGoalHours: 2 }] };
  assert.equal(goalFor(manual, 'p1', '2026-10-17'), 0, 'Saturday');
  assert.equal(goalFor(manual, 'p1', '2026-10-16'), 2 * H, 'Friday');
});
test('switchActivity splits and keeps project + task; first pick on a fresh timer just assigns', () => {
  let d = A.startTimer(base(), { description: '', projectId: 'p1', taskId: 5, taskName: 'T' });
  d = A.switchActivity(d, 'a1');
  assert.equal(d.entries.length, 1, 'fresh timer gets the activity');
  d.entries[0].start = new Date(Date.now() - 10 * M).toISOString();
  d = A.switchActivity(d, 'a2');
  assert.equal(d.entries.length, 2);
  const r = A.runningEntry(d)!;
  assert.deepEqual([r.projectId, r.taskId, r.activityId], ['p1', 5, 'a2']);
});
test('resumeLast continues the last entry', () => {
  let d = A.startTimer(base(), { description: 'x', projectId: 'p2', taskId: 7, taskName: 'T' });
  d = A.resumeLast(A.stopTimer(d));
  assert.equal(d.entries.length, 2);
  assert.deepEqual([A.runningEntry(d)!.projectId, A.runningEntry(d)!.taskId], ['p2', 7]);
});
test('resolveIdle discard/break cut the idle time', () => {
  const d0 = A.startDay({ ...base(), workdays: [] });
  let d = A.startTimer(d0, { description: 'x', projectId: 'p1' });
  d.entries[0].start = new Date(Date.now() - 60 * M).toISOString();
  const since = new Date(Date.now() - 20 * M).toISOString();
  const disc = A.resolveIdle(d, since, 'discard');
  assert.equal(disc.entries[0].end, since); assert.ok(A.runningEntry(disc));
  const brk = A.resolveIdle(d, since, 'break');
  assert.equal(A.todayWorkday(brk)!.breaks.at(-1)!.start, since);
  assert.equal(A.resolveIdle(d, since, 'keep'), d);
});
test('Float import twice: no duplicate projects or days off, name-linking works', () => {
  const imp: FloatImport = { projects: [{ floatId: 900, name: 'xyz', color: '#8E44AD' }, { floatId: 901, name: 'New One', color: '#000000' }],
    plan: [{ floatId: 1, floatProjectId: 900, name: 'T', startDate: today, endDate: today, hoursPerDay: 2, days: [today] }],
    daysOff: [{ date: '2026-12-24', reason: 'Holiday' }], range: { from: '2026-09-01', to: '2027-01-31' } };
  let d = applyFloatImport(base(), imp); d = applyFloatImport(d, imp);
  assert.equal(d.projects.length, 3); assert.equal(d.projects[0].floatId, 900, 'linked by name');
  assert.equal(d.plan[0].projectId, 'p1');
  assert.equal(d.workdays.filter((w) => w.date === '2026-12-24').length, 1);
  d = applyFloatImport(d, { ...imp, daysOff: [] });
  assert.equal(d.workdays.length, 0, 'removed Float day off disappears');
});
const pp = (id: string, from: string, to: string | null, extra: Partial<PersonioPeriod> = {}): PersonioPeriod =>
  ({ id, person: { id: '7' }, starts_from: { date_time: `${from}T00:00:00`, type: null }, ends_at: to ? { date_time: `${to}T00:00:00`, type: null } : null, absence_type: { id: 'vac' }, approval: { status: 'APPROVED' }, ...extra });
const prange = { from: '2026-10-01', to: '2026-12-31' };
const ptypes = [{ id: 'vac', name: 'Vacation', unit: 'DAY' as const }, { id: 'doc', name: 'Doctor', unit: 'HOUR' as const }];
test('Personio: periods become weekday days off; 00:00 end on a later day is exclusive; pending ones are skipped', () => {
  // Fri 16 Oct – Tue 20 Oct: Personio ends it at Wed 21 Oct 00:00. The weekend is skipped.
  const imp = mapPersonioAbsences([pp('a', '2026-10-16', '2026-10-21'), pp('b', '2026-11-02', null, { approval: { status: 'PENDING' } })], ptypes, new Map(), prange, 8);
  assert.deepEqual(imp.daysOff.map((x) => x.date), ['2026-10-16', '2026-10-19', '2026-10-20']);
  assert.equal(imp.daysOff[0].reason, 'Vacation');
  const inclusive = { ...pp('i', '2026-10-16', null), ends_at: { date_time: '2026-10-20T23:59:59', type: null } };
  assert.equal(periodDays(inclusive, prange).at(-1)!.date, '2026-10-20', 'an end later in the day includes that day');
  assert.deepEqual(periodDays(pp('c', '2026-12-31', '2027-01-01'), { from: '2026-12-01', to: '2027-01-31' }).map((x) => x.date), ['2026-12-31'], 'next-day midnight end');
  assert.equal(periodDays(pp('d', '2026-12-28', null), prange).at(-1)!.date, '2026-12-31', 'ongoing runs to the end of the window');
});
test('Personio: half days and hourly absences are skipped (counted), whole days win; breakdowns take precedence', () => {
  const half = pp('h', '2026-10-21', '2026-10-21', { starts_from: { date_time: '2026-10-21T00:00:00', type: 'SECOND_HALF' } });
  const hourly = pp('x', '2026-10-22', '2026-10-22', { absence_type: { id: 'doc' } });
  const imp = mapPersonioAbsences([half, hourly], ptypes, new Map(), prange, 8);
  assert.equal(imp.daysOff.length, 0);
  assert.deepEqual(imp.partial.map((x) => x.date), ['2026-10-21', '2026-10-22']);
  // Breakdowns: a public holiday counts 0 (skipped), 0.5 is partial, 480 minutes with an 8 h target is a whole day.
  const bd = new Map([['a', [
    { date: '2026-10-26', effective_duration: { value: 1, unit: 'DAY' as const } },
    { date: '2026-10-27', effective_duration: { value: 0, unit: 'DAY' as const } },
    { date: '2026-10-28', effective_duration: { value: 0.5, unit: 'DAY' as const } },
    { date: '2026-10-29', effective_duration: { value: 480, unit: 'MINUTE' as const } },
  ]]]);
  const withBd = mapPersonioAbsences([pp('a', '2026-10-26', '2026-10-30'), pp('z', '2026-10-28', '2026-10-28')], [], bd, prange, 8);
  assert.deepEqual(withBd.daysOff.map((x) => x.date), ['2026-10-26', '2026-10-28', '2026-10-29'], 'a whole-day period on the same date wins over the half day');
  assert.equal(withBd.partial.length, 0);
  assert.equal(withBd.daysOff[0].reason, t('personio.absence'), 'unknown type gets a generic reason');
});
test('Personio import twice: no duplicates, own days removed when gone, manual days and other sources respected', () => {
  const manual = { date: '2026-10-19', start: atTime('2026-10-19', '09:00'), end: atTime('2026-10-19', '17:00'), breaks: [] };
  const floatOff = { date: '2026-10-20', start: atTime('2026-10-20', '00:00'), end: atTime('2026-10-20', '00:00'), breaks: [], off: true, offReason: 'Time off', offSource: 'float' as const };
  const start = { ...base(), workdays: [manual, floatOff] };
  const imp = mapPersonioAbsences([pp('a', '2026-10-16', '2026-10-21')], ptypes, new Map(), prange, 8);
  let d = applyPersonioImport(applyPersonioImport(start, imp), imp);
  assert.equal(d.workdays.length, 3);
  assert.equal(d.workdays.find((w) => w.date === '2026-10-19')!.off, undefined, 'a worked day is never overwritten');
  assert.equal(d.workdays.find((w) => w.date === '2026-10-20')!.offSource, 'personio', 'Personio takes over Float time off');
  assert.ok(d.settings.personioLastSync);
  d = applyPersonioImport(d, { ...imp, daysOff: [] });
  assert.deepEqual(d.workdays.map((w) => w.date), ['2026-10-19'], 'cancelled absences disappear');
  d = applyFloatImport({ ...d, workdays: [...d.workdays, { ...floatOff, offSource: 'personio' as const }] }, { projects: [], plan: [], daysOff: [], range: prange });
  assert.equal(d.workdays.length, 2, 'a Float sync leaves Personio days alone');
});
test('closeOvernight closes yesterday at 23:59 and flags it; today stays untouched', () => {
  const y = dayKey(new Date(Date.now() - 86_400_000));
  const d: Data = { ...base(),
    workdays: [{ date: y, start: atTime(y, '08:05'), breaks: [{ start: atTime(y, '12:00') }] }, { date: today, start: atTime(today, '00:10'), breaks: [] }],
    entries: [{ id: 'r', description: 'late', projectId: 'p1', start: atTime(y, '22:00') }] };
  assert.ok(A.hasOvernight(d));
  const n = A.closeOvernight(d);
  const yw = n.workdays.find((w) => w.date === y)!;
  assert.equal(yw.autoClosed, true);
  assert.equal(dayKey(yw.end!), y, 'closed on its own day');
  assert.ok(yw.breaks.every((b) => b.end), 'open break closed too');
  assert.equal(n.entries[0].end, yw.end, 'timer stopped at the same moment');
  assert.equal(n.workdays.find((w) => w.date === today)!.end, undefined, "today's open day is left alone");
  assert.equal(A.hasOvernight(n), false);
  const fixed = A.closeWorkday(n, y, atTime(y, '18:30'));
  assert.equal(fixed.workdays.find((w) => w.date === y)!.autoClosed, undefined, 'setting the real time confirms it');
});
test('resolveIdle "leave" clocks out at the moment you left (timer and workday)', () => {
  let d = A.startTimer(A.startDay(base()), { description: 'x', projectId: 'p1' });
  d.entries[0].start = new Date(Date.now() - 8 * H).toISOString();
  d.workdays[0].start = new Date(Date.now() - 9 * H).toISOString();
  const since = new Date(Date.now() - 7 * H).toISOString();
  const n = A.resolveIdle(d, since, 'leave');
  assert.equal(n.entries[0].end, since);
  assert.equal(n.workdays[0].end, since);
  assert.equal(A.runningEntry(n), undefined);
});

test('lastDayEntries + copyEntriesTo repeat the last day of a project', () => {
  let d = A.appendEntry(base(), '2026-10-13', 1 * H, { projectId: 'p1', description: 'Old' });
  d = A.appendEntry(d, '2026-10-15', 45 * M, { projectId: 'p1', description: 'Sync', activityId: 'a1' });
  d = A.appendEntry(d, '2026-10-15', 30 * M, { projectId: 'p2', description: 'Other project' });
  const last = A.lastDayEntries(d, 'p1', '2026-10-16')!;
  assert.equal(last.day, '2026-10-15');
  assert.deepEqual(last.entries.map((e) => e.description), ['Sync']);
  d = A.copyEntriesTo(d, '2026-10-16', last.entries);
  const copy = d.entries.find((e) => dayKey(e.start) === '2026-10-16')!;
  assert.deepEqual([copy.description, copy.activityId, Date.parse(copy.end!) - Date.parse(copy.start)], ['Sync', 'a1', 45 * M]);
});
test('weekCopyPlan copies only into empty project-days, never onto days off or the future', () => {
  const from = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
  const to = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
  let d = A.appendEntry(base(), '2026-10-05', 2 * H, { projectId: 'p1' });
  d = A.appendEntry(d, '2026-10-06', 2 * H, { projectId: 'p1' });
  d = A.appendEntry(d, '2026-10-07', 1 * H, { projectId: 'p1' });
  d = A.appendEntry(d, '2026-10-13', 1 * H, { projectId: 'p1' }); // Tuesday already has p1 time
  d = A.markDayOff(d, '2026-10-14'); // Wednesday off
  const plan = A.weekCopyPlan(d, from, to);
  assert.deepEqual(plan.map((x) => x.day), ['2026-10-12']);
});
test('i18n: German plurals, variables and tray templates follow the language setting', () => {
  setLanguage('de');
  assert.equal(t('count.entries', { n: 1 }), '1 Eintrag');
  assert.equal(t('count.entries', { n: 2 }), '2 Einträge');
  assert.equal(t('day.daysUnder', { n: 3 }), '3 Tage unter Soll');
  assert.equal(trayStrings().idleLeave, 'Feierabend um {time}');
  setLanguage('en');
  assert.equal(t('count.entries', { n: 1 }), '1 entry');
  assert.equal(t('ts.weekNo', { n: 42 }), 'Week 42');
  assert.equal(trayStrings().clockOut, 'Clock out');
});

test('overtime balance: worked − target; vacation neutral, overtime-off uses it, open days wait', () => {
  const day = (date: string, from: string, to?: string) => ({ date, start: atTime(date, from), end: to ? atTime(date, to) : undefined, breaks: [] });
  let d: Data = { ...base(), workdays: [day('2026-09-29', '08:00', '17:00'), day('2026-10-01', '08:00', '18:00'), day('2026-10-02', '09:00', '15:00')] };
  d = A.markDayOff(d, '2026-10-05');              // vacation: neutral
  d = A.markDayOff(d, '2026-10-06', 'overtime');  // overtime off: −8h
  d = { ...d, workdays: [...d.workdays, day('2026-10-07', '08:00')] }; // still open: not counted
  const b = balanceByMonth(d);
  assert.deepEqual(b.months.map((m) => [m.month, m.diff / H]), [['2026-09', 1], ['2026-10', 2 - 2 - 8]]);
  assert.equal(b.total / H, -7);
  const withStart = balanceByMonth({ ...d, settings: { ...d.settings, balanceStartHours: 12.5, balanceStartDate: '2026-10-01' } });
  assert.equal(withStart.total / H, 12.5 - 8, 'starting balance replaces everything before its date');
});

test('shortcuts: key presses become accelerators, shown with Mac symbols', () => {
  const ev = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) =>
    ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as unknown as KeyboardEvent;
  assert.equal(accelFromEvent(ev('KeyP', { ctrlKey: true, altKey: true })), 'Control+Alt+P', '⌥ changes e.key, e.code is used');
  assert.equal(accelFromEvent(ev('Digit3', { metaKey: true, shiftKey: true })), 'Shift+Command+3');
  assert.equal(accelFromEvent(ev('KeyT')), 'needs-modifier');
  assert.equal(accelFromEvent(ev('ShiftLeft', { shiftKey: true })), null);
  assert.equal(accelFromEvent(ev('F5')), 'F5', 'function keys alone are fine');
  assert.equal(prettyAccel('Control+Alt+P'), '⌃⌥P');
  assert.equal(prettyAccel('Control+Alt+Space'), '⌃⌥ Space');
  assert.equal(projectAccel('Control+Alt', 0), 'Control+Alt+1');
  assert.equal(projectAccel('', 0), '');
  // German QWERTZ: the layout decides which letter a key is.
  const de = new Map([['KeyZ', 'y'], ['KeyY', 'z'], ['KeyP', 'p'], ['BracketRight', '+'], ['Semicolon', 'ö'], ['Minus', 'ß'], ['Digit1', '1']]);
  assert.equal(accelFromEvent(ev('KeyY', { ctrlKey: true, altKey: true }), de), 'Control+Alt+Z', 'the key labelled Z on QWERTZ');
  assert.equal(accelFromEvent(ev('KeyP', { ctrlKey: true, altKey: true }), de), 'Control+Alt+P');
  assert.equal(accelFromEvent(ev('BracketRight', { ctrlKey: true, altKey: true }), de), 'Control+Alt+Plus');
  assert.equal(accelFromEvent(ev('Semicolon', { ctrlKey: true, altKey: true }), de), 'unsupported', 'ö');
  assert.equal(accelFromEvent(ev('Digit1', { ctrlKey: true, altKey: true }), de), 'Control+Alt+1');
  assert.equal(prettyAccel('Control+Alt+Plus'), '⌃⌥+');
});

test('activity presets: role set replaces the list, used activities stay, edits make it custom', () => {
  let d = base();
  d.entries.push({ id: 'e1', description: '', activityId: 'a1', start: atTime(today, '09:00'), end: atTime(today, '10:00') });
  d = A.applyActivityPreset(d, 'ux', ['Research', 'Design', 'Workshop']);
  assert.deepEqual(d.activities.map((a) => a.name), ['Research', 'Design', 'Workshop', 'Call'], 'Call is used, so it stays; Design is reused');
  assert.equal(d.activities.find((a) => a.name === 'Design')!.id, 'a2', 'same name keeps its id and colour');
  assert.equal(d.settings.activityPreset, 'ux');
  assert.equal(A.updateActivity(d, 'a2', { color: '#000' }).settings.activityPreset, 'ux', 'a colour change is not a list change');
  assert.equal(A.addActivity(d, 'Mood').settings.activityPreset, 'custom');
  assert.equal(A.removeActivity(d, 'a2').settings.activityPreset, 'custom');
  for (const lang of ['en', 'de'] as const) {
    setLanguage(lang);
    for (const p of A.ACTIVITY_PRESETS) assert.equal(t(`preset.${p}`).split('|').length, 6, `${lang} ${p}`);
  }
  setLanguage('en');
});

test('work schedule: hours per weekday, periods from a date, balance with and without every scheduled day', () => {
  let d = base();
  assert.equal(targetHoursOn(d, '2026-06-01'), 8, 'no schedule yet: Mon–Fri at the daily target');
  assert.equal(targetHoursOn(d, '2026-06-06'), 0, 'Saturday is free');
  d = setSchedule(d, '2026-07-01', [8, 8, 8, 8, 0, 0, 0]);
  assert.equal(targetHoursOn(d, '2026-06-26'), 8, 'a Friday before the change keeps 8 h');
  assert.equal(targetHoursOn(d, '2026-07-03'), 0, 'a Friday after it is free');
  assert.equal(weekTotal(schedulesOf(d)[1].hours), 32);
  assert.equal(schedulesOf(removeSchedule(d, '2026-07-01')).length, 1);
  assert.equal(schedulesOf(removeSchedule(removeSchedule(d, '2026-07-01'), schedulesOf(d)[0].from)).length, 1, 'the first period always stays');
  // Mon 6 Jul: 9 h worked; Tue 7 Jul: nothing recorded; Fri 10 Jul: 2 h on a free day.
  const day = (date: string, from: string, to: string) => ({ date, start: atTime(date, from), end: atTime(date, to), breaks: [] });
  d.workdays.push(day('2026-07-06', '08:00', '17:00'), day('2026-07-10', '10:00', '12:00'));
  const now = Date.parse('2026-07-11T12:00:00');
  assert.equal(balanceByMonth(d, now).total, 3 * H, 'recorded days only: +1 h on Monday, +2 h on the free Friday');
  d.settings.countAllScheduledDays = true;
  assert.equal(balanceByMonth(d, now).total, 3 * H - 3 * 8 * H, 'Tue, Wed, Thu without a record each miss 8 h');
});

test('moments: day and week summaries, and whether leaving starts the weekend', () => {
  const d = base();
  const day = (date: string, from: string, to: string) => ({ date, start: atTime(date, from), end: atTime(date, to), breaks: [] });
  d.workdays.push(day('2026-10-12', '08:00', '17:00'), day('2026-10-16', '08:00', '15:00'));
  const now = Date.parse('2026-10-16T18:00:00');
  assert.deepEqual(daySummary(d, '2026-10-16', now), { worked: 7 * H, target: 8 * H, diff: -1 * H });
  const week = weekSummary(d, '2026-10-16', now);
  assert.equal(week.worked, 16 * H);
  assert.equal(week.diff, 0, 'Mon +1 h, Fri −1 h');
  assert.equal(week.lastWorkday, true, 'Friday is the last scheduled workday');
  assert.equal(weekSummary(d, '2026-10-12', now).lastWorkday, false);
});

test('daylight: sun height by time and season, moon phase, and a shade that never switches off', () => {
  // Tests run in the machine's time zone; these checks hold for any zone (solar noon ≈ 12:00 standard time).
  const noonJune = sunMoon(new Date(2026, 5, 21, 12 + (new Date(2026, 5, 21).getTimezoneOffset() < new Date(2026, 0, 1).getTimezoneOffset() ? 1 : 0), 0));
  assert.ok(noonJune.sun.elevation > 60 && noonJune.sun.elevation < 70, `midsummer noon ~65°, got ${noonJune.sun.elevation}`);
  assert.ok(sunMoon(new Date(2026, 11, 21, 0, 0)).sun.elevation < -40, 'midwinter midnight is deep night');
  assert.ok(Math.abs(moonPhase(new Date(Date.UTC(2026, 9, 26, 4))) - 0.5) < 0.03, 'full moon on 26 Oct 2026');
  for (const h of [0, 6, 7, 12, 17, 18, 23]) {
    const look = daylight(new Date(2026, 9, 26, h, 30), true);
    assert.ok(look.shadow.startsWith('0 '), `ambient shade at ${h}:30`);
  }
});

// ---- Sync with a Gnomon server --------------------------------------------------------------------------
const NOW = '2026-10-17T12:00:00.000Z';
const entry = (id: string, extra: Partial<Data['entries'][number]> = {}) => ({ id, description: id, start: '2026-10-16T07:00:00.000Z', end: '2026-10-16T08:00:00.000Z', ...extra });
const put = (kind: Sync.Kind, data: { id?: string; date?: string }, updatedAt = '2026-10-17T11:00:00.000Z'): Sync.Change => ({ kind, id: (kind === 'workdays' ? data.date : data.id)!, updatedAt, deleted: false, data: data as never });

test('sync: local changes are found against the agreed state, including deletions', () => {
  const d0 = { ...base(), entries: [entry('e1'), entry('e2')] };
  const agreed = Sync.baseOf(d0);
  const d1 = { ...d0, entries: [{ ...entry('e1'), description: 'changed' }, entry('e3')] };
  const ch = Sync.localChanges(d1, agreed, NOW).map((c) => `${c.kind}:${c.id}:${c.deleted ? 'del' : 'put'}`).sort();
  assert.deepEqual(ch, ['entries:e1:put', 'entries:e2:del', 'entries:e3:put']);
  assert.deepEqual(Sync.localChanges(d0, agreed, NOW), []);
});

test('sync: server changes merge in; a Mac edit without a known time counts as now', () => {
  const d0 = { ...base(), entries: [entry('e1'), entry('e2')] };
  const agreed = Sync.baseOf(d0);
  const local = { ...d0, entries: [{ ...entry('e1'), description: 'mac' }, entry('e2')] };
  const incoming = [put('entries', { ...entry('e1'), description: 'phone' }), put('entries', { ...entry('e2'), description: 'phone2' }), put('entries', entry('p1')), { kind: 'entries' as const, id: 'gone', updatedAt: NOW, deleted: true, data: null }];
  const plan = Sync.planSync(local, agreed, incoming, { first: false, now: NOW });
  const byId = new Map(plan.merged.entries.map((e) => [e.id, e.description]));
  assert.equal(byId.get('e1'), 'mac');
  assert.equal(byId.get('e2'), 'phone2');
  assert.equal(byId.get('p1'), 'p1');
  assert.deepEqual(plan.push.map((c) => c.id), ['e1'], 'only the Mac’s own change is pushed');
});

test('sync: when both sides changed the same record, the later edit wins', () => {
  const d0 = { ...base(), entries: [entry('e1'), entry('e2')] };
  const agreed = Sync.baseOf(d0);
  const local = { ...d0, entries: [{ ...entry('e1'), description: 'mac at 10:00' }, { ...entry('e2'), description: 'mac at 11:30' }] };
  const changedAt = (k: string) => ({ 'entries:e1': '2026-10-17T10:00:00.000Z', 'entries:e2': '2026-10-17T11:30:00.000Z' })[k];
  const incoming = [put('entries', { ...entry('e1'), description: 'phone at 11:00' }, '2026-10-17T11:00:00.000Z'), put('entries', { ...entry('e2'), description: 'phone at 11:00' }, '2026-10-17T11:00:00.000Z')];
  const plan = Sync.planSync(local, agreed, incoming, { first: false, now: NOW, changedAt });
  const byId = new Map(plan.merged.entries.map((e) => [e.id, e.description]));
  assert.equal(byId.get('e1'), 'phone at 11:00', 'the phone edited e1 later');
  assert.equal(byId.get('e2'), 'mac at 11:30', 'the Mac edited e2 later');
  assert.deepEqual(plan.push.map((c) => [c.id, c.updatedAt]), [['e2', '2026-10-17T11:30:00.000Z']], 'pushed with the time of the Mac edit');
});

test('sync: markChanges notes changed, added and deleted records only', () => {
  const d0 = { ...base(), entries: [entry('e1'), entry('e2')] };
  const d1 = A.updateEntry(A.deleteEntry(d0, 'e2'), 'e1', { description: 'x' });
  const d2 = { ...d1, entries: [...d1.entries, entry('e3')] };
  const m = new Map<string, string>();
  Sync.markChanges(d0, d2, m, NOW);
  assert.deepEqual([...m.keys()].sort(), ['entries:e1', 'entries:e2', 'entries:e3']);
  const m2 = new Map<string, string>();
  Sync.markChanges(d2, { ...d2, settings: { ...d2.settings, dailyTargetHours: 7 } }, m2, NOW);
  assert.equal(m2.size, 0, 'settings are not synced records');
});

test('sync: first sync joins projects and activities by name and drops unused starter activities', () => {
  const local = { ...base(), entries: [entry('m1', { projectId: 'p1', activityId: 'a1' })] };
  const incoming = [
    put('activities', { id: 'srv-call', name: 'call', color: '#E91E63' } as never),
    put('activities', { id: 'srv-admin', name: 'Admin', color: '#607D8B' } as never),
    put('projects', { id: 'srv-xyz', name: 'XYZ', color: '#8E44AD' } as never),
    put('entries', entry('ph1', { projectId: 'srv-xyz', activityId: 'srv-call' })),
  ];
  const plan = Sync.planSync(local, {}, incoming, { first: true, now: NOW });
  const ph1 = plan.merged.entries.find((e) => e.id === 'ph1')!;
  assert.equal(ph1.projectId, 'p1', 'the phone entry now points to the Mac project');
  assert.equal(ph1.activityId, 'a1');
  assert.equal(plan.merged.projects.length, 2);
  assert.deepEqual(plan.merged.activities.map((a) => a.id), ['a1', 'a2'], 'no duplicates, Admin dropped');
  const pushed = new Set(plan.push.map((c) => `${c.kind}:${c.id}:${c.deleted ? 'del' : 'put'}`));
  for (const k of ['activities:srv-call:del', 'activities:srv-admin:del', 'projects:srv-xyz:del', 'entries:ph1:put', 'entries:m1:put', 'projects:p1:put', 'activities:a1:put']) assert.ok(pushed.has(k), k);
});

test('sync: a day stamped on both devices before the first sync is combined', () => {
  const day = '2026-10-16';
  const local = { ...base(), workdays: [{ date: day, start: `${day}T07:30:00.000Z`, end: `${day}T17:00:00.000Z`, breaks: [] }] };
  const phone = { date: day, start: `${day}T07:00:00.000Z`, end: `${day}T16:00:00.000Z`, breaks: [{ start: `${day}T10:00:00.000Z`, end: `${day}T10:30:00.000Z` }] };
  const plan = Sync.planSync(local, {}, [put('workdays', phone)], { first: true, now: NOW });
  const w = plan.merged.workdays[0];
  assert.equal(w.start, phone.start);
  assert.equal(w.end, `${day}T17:00:00.000Z`, 'latest leaving');
  assert.equal(w.breaks.length, 1);
  assert.ok(plan.push.some((c) => c.kind === 'workdays' && c.id === day));
});

test('sync: two running timers become one, invalid records are not pushed', () => {
  const local = { ...base(), entries: [entry('mac', { start: '2026-10-17T08:00:00.000Z', end: undefined }), entry('bad', { start: 'not a date' })] };
  const phone = entry('phone', { start: '2026-10-17T09:00:00.000Z', end: undefined });
  const plan = Sync.planSync(local, {}, [put('entries', phone)], { first: false, now: NOW });
  assert.equal(plan.merged.entries.filter((e) => !e.end).length, 1);
  assert.equal(plan.merged.entries.find((e) => e.id === 'mac')!.end, phone.start, 'the older timer ends when the newer began');
  assert.deepEqual(plan.invalid, ['entries:bad'], JSON.stringify(plan.invalid));
  assert.ok(!plan.push.some((c) => c.id === 'bad'));
});

test('sync: rebase keeps edits made during the sync and is a no-op when nothing changed', () => {
  const before = { ...base(), entries: [entry('e1'), entry('e2')] };
  const synced = { ...before, entries: [{ ...entry('e1'), description: 'server' }, { ...entry('e2'), description: 'server' }, entry('n1')] };
  const live = { ...before, entries: [entry('e1'), { ...entry('e2'), description: 'typed meanwhile' }, entry('x1')] };
  const r = Sync.rebase(live, before, synced);
  const byId = new Map(r.entries.map((e) => [e.id, e.description]));
  assert.equal(byId.get('e1'), 'server');
  assert.equal(byId.get('e2'), 'typed meanwhile');
  assert.equal(byId.get('n1'), 'n1');
  assert.equal(byId.get('x1'), 'x1');
  assert.equal(Sync.rebase(synced, synced, synced), synced);
});

test('workday follows entries: created from entries, widened to cover them, hand edits win', () => {
  const e = (id: string, date: string, from: string, to?: string) => ({ id, description: '', start: atTime(date, from), ...(to && { end: atTime(date, to) }) });
  const now = Date.parse('2026-10-20T12:00:00');
  // A past day with only entries gets a workday from 09:00 to 17:00 with the 12:00–13:00 gap as a break.
  let d = base();
  const prev = d;
  d = { ...d, entries: [e('a', '2026-10-15', '09:00', '12:00'), e('b', '2026-10-15', '13:00', '17:00')] };
  let r = fitWorkdays(prev, d, now);
  const w = r.data.workdays[0];
  assert.equal(w.start, atTime('2026-10-15', '09:00'));
  assert.equal(w.end, atTime('2026-10-15', '17:00'));
  assert.equal(w.breaks.length, 1);
  assert.equal(w.fromEntries, true);
  assert.equal(r.notices[0].kind, 'created');
  // A day clocked in by hand 10:00–16:00 widens to the entries, and says so.
  d = { ...base(), workdays: [{ date: '2026-10-16', start: atTime('2026-10-16', '10:00'), end: atTime('2026-10-16', '16:00'), breaks: [] }] };
  const before = d;
  d = { ...d, entries: [e('c', '2026-10-16', '08:30', '11:00'), e('d', '2026-10-16', '15:00', '18:15')] };
  r = fitWorkdays(before, d, now);
  assert.equal(r.data.workdays[0].start, atTime('2026-10-16', '08:30'));
  assert.equal(r.data.workdays[0].end, atTime('2026-10-16', '18:15'));
  assert.deepEqual(r.notices.map((n) => n.kind), ['start', 'end']);
  // Editing a derived day by hand stops it from following the entries.
  const edited = A.updateWorkday(fitAll({ ...base(), entries: [e('f', '2026-10-15', '09:00', '17:00')] }, now), '2026-10-15', { end: atTime('2026-10-15', '18:00') });
  assert.equal(edited.workdays[0].fromEntries, undefined);
  // Days off are left alone.
  const off = { ...base(), workdays: [{ date: '2026-10-14', start: atTime('2026-10-14', '00:00'), end: atTime('2026-10-14', '00:00'), breaks: [], off: true }] };
  assert.equal(fitAll({ ...off, entries: [e('g', '2026-10-14', '09:00', '10:00')] }, now).workdays.length, 1);
});

test('flows: typed hours go inside clocked-in time, a pause before the next timer is offered as a break', () => {
  // Clocked in 10:00–18:00 with a 12:00–12:30 break and an entry 10:00–12:00: 2 h typed later start at 12:30.
  let d = { ...base(), workdays: [{ date: '2026-10-16', start: atTime('2026-10-16', '10:00'), end: atTime('2026-10-16', '18:00'), breaks: [{ start: atTime('2026-10-16', '12:00'), end: atTime('2026-10-16', '12:30') }] }] };
  d = { ...d, entries: [{ id: 'x', description: '', start: atTime('2026-10-16', '10:00'), end: atTime('2026-10-16', '12:00') }] };
  assert.equal(A.freeStart(d, '2026-10-16', 2 * H), atTime('2026-10-16', '12:30'));
  assert.equal(A.freeStart({ ...d, entries: [] }, '2026-10-16', H), atTime('2026-10-16', '10:00'), 'empty day: from arrival, not 09:00');
  assert.equal(A.freeStart(base(), '2026-10-16', H), atTime('2026-10-16', '09:00'), 'no clock-in: 09:00 as before');
  // Live tracking: timer 09:00–12:05, next one started 12:50 → offer 12:05–12:50 as a break; once added, not again.
  const today = dayKey(new Date());
  let live = { ...base(), workdays: [{ date: today, start: atTime(today, '09:00'), breaks: [] }] };
  live = { ...live, entries: [{ id: 'a', description: '', start: atTime(today, '09:00'), end: atTime(today, '12:05') }, { id: 'b', description: '', start: atTime(today, '12:50') }] };
  const gap = A.breakBeforeRunning(live)!;
  assert.deepEqual([gap.start, gap.end], [atTime(today, '12:05'), atTime(today, '12:50')]);
  assert.equal(A.breakBeforeRunning(A.addBreakBetween(live, today, gap.start, gap.end)), null);
  assert.equal(A.workStyleDefaults('live').reviewOnLeave, false);
});

test('reminders: time to assign, and the week reminder only for clocking in, on the last workday afternoon, once', () => {
  const day = (date: string, from: string, to: string) => ({ date, start: atTime(date, from), end: atTime(date, to), breaks: [] });
  let d = base();
  d.workdays.push(day('2026-10-12', '08:00', '17:00'), day('2026-10-16', '08:00', '15:00'));
  d.entries.push({ id: 'e', description: '', start: atTime('2026-10-12', '08:00'), end: atTime('2026-10-12', '15:00') });
  const fri = Date.parse('2026-10-16T16:00:00');
  assert.equal(toAssign(d, '2026-10-12', fri), 2 * H);
  assert.equal(weekToAssign(d, '2026-10-16', fri), 9 * H, 'Mon 2 h + Fri 7 h');
  assert.equal(weekReminderDue(d, fri), null, 'no style chosen: no reminder');
  d = { ...d, settings: { ...d.settings, workStyle: 'clock' } };
  assert.equal(weekReminderDue(d, fri)?.ms, 9 * H);
  assert.equal(weekReminderDue(d, Date.parse('2026-10-16T11:00:00')), null, 'not before 15:00');
  assert.equal(weekReminderDue(d, Date.parse('2026-10-15T16:00:00')), null, 'Thursday is not the last workday');
  assert.equal(weekReminderDue({ ...d, settings: { ...d.settings, weekReminded: '2026-10-12' } }, fri), null, 'once a week');
  assert.equal(weekReminderDue({ ...d, settings: { ...d.settings, reminders: false } }, fri), null);
  assert.equal(A.workStyleDefaults('clock').menuBarLabel, 'workday');
});

console.log(`\n${passed} passed`);
