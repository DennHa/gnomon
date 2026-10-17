// Writes a made-up data.json for screenshots and demos: a few client projects, about ten weeks of workdays with
// entries, vacation and one overtime day off, a Float-style plan for the current week and a running timer.
// Usage: node scripts/demo-data.cjs <folder> <now as ISO, e.g. 2026-10-14T14:35:00> [en|de]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [dir, nowArg, language = 'en'] = process.argv.slice(2);
if (!dir || !nowArg) {
  console.error('Usage: node scripts/demo-data.cjs <folder> <now ISO> [en|de]');
  process.exit(1);
}
const now = new Date(nowArg);
const de = language === 'de';

// Deterministic randomness, so every run gives the same pictures.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const id = () => crypto.randomUUID();
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (d, h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString();
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));

const projects = [
  { id: id(), name: 'Website relaunch', clientName: 'Northwind', color: '#7C4DFF', floatId: 101, tasks: de ? ['Startseite', 'Komponenten-Bibliothek', 'Abstimmung mit Kunde'] : ['Homepage', 'Component library', 'Client check-in'] },
  { id: id(), name: 'Mobile app', clientName: 'Contoso', color: '#00BFA5', floatId: 102, tasks: de ? ['Checkout-Flow', 'Onboarding-Screens', 'Sprint-Planung'] : ['Checkout flow', 'Onboarding screens', 'Sprint planning'] },
  { id: id(), name: 'Brand refresh', clientName: 'Fjord Coffee', color: '#FF7043', floatId: 103, tasks: de ? ['Logo-Varianten', 'Moodboard', 'Präsentation'] : ['Logo variations', 'Moodboard', 'Presentation'] },
  { id: id(), name: de ? 'Intern' : 'Internal', color: '#90A4AE', tasks: de ? ['Team-Meeting', 'E-Mails', 'Weiterbildung'] : ['Team meeting', 'Email', 'Learning'] },
];
const activities = (de ? ['Design', 'Entwicklung', 'Call', 'Workshop', 'Admin'] : ['Design', 'Development', 'Call', 'Workshop', 'Admin'])
  .map((name, i) => ({ id: id(), name, color: ['#7C4DFF', '#26A69A', '#FFB300', '#EC407A', '#78909C'][i] }));
const [design, dev, call, workshop, admin] = activities;
const activityFor = (task) => (/meeting|check-in|Abstimmung|planning|Planung/i.test(task) ? call : /Moodboard|Präsentation|Presentation/i.test(task) ? workshop : /mail|Weiterbildung|Learning/i.test(task) ? admin : /flow|Onboarding|library|Bibliothek/i.test(task) ? dev : design);

const entries = [];
const workdays = [];
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const start = addDays(monday(today), -7 * 10);
const vacation = new Set([dayKey(addDays(monday(today), -7 * 4 + 1)), dayKey(addDays(monday(today), -7 * 4 + 2)), dayKey(addDays(monday(today), -7 * 4 + 3))]);
const overtimeOff = dayKey(addDays(monday(today), -7 * 2 + 4));

for (let d = start; d <= today; d = addDays(d, 1)) {
  const key = dayKey(d);
  if (d.getDay() === 0 || d.getDay() === 6) continue;
  if (vacation.has(key)) {
    workdays.push({ date: key, start: at(d, 0, 0), end: at(d, 0, 0), breaks: [], off: true, offReason: de ? 'Urlaub' : 'Vacation', offSource: 'personio' });
    continue;
  }
  if (key === overtimeOff) {
    workdays.push({ date: key, start: at(d, 0, 0), end: at(d, 0, 0), breaks: [], off: true, offKind: 'overtime' });
    continue;
  }
  const isToday = key === dayKey(today);
  const inMin = 8 * 60 + 15 + Math.floor(rnd() * 45);
  // Most days run a little long; that's where the overtime comes from.
  const outMin = isToday ? now.getHours() * 60 + now.getMinutes() : inMin + 8 * 60 + 30 + Math.floor(rnd() * 70) - 15;
  if (isToday && outMin < inMin + 10) continue; // before you've arrived: the day isn't started yet
  const breakAt = 12 * 60 + 15 + Math.floor(rnd() * 30);
  const wd = { date: key, start: at(d, Math.floor(inMin / 60), inMin % 60), breaks: [{ start: at(d, Math.floor(breakAt / 60), breakAt % 60), end: at(d, Math.floor((breakAt + 30) / 60), (breakAt + 30) % 60) }] };
  if (!isToday) wd.end = at(d, Math.floor(outMin / 60), outMin % 60);
  workdays.push(wd);

  // Fill the day with blocks of 45–150 minutes, skipping the break.
  let t = inMin + 5;
  const main = projects[(Math.floor((d - start) / 864e5 / 7) + d.getDay()) % 3];
  // This week follows the plan below (mostly Mobile app and Website relaunch); earlier weeks rotate.
  const thisWeek = d >= monday(today);
  const choose = () => (thisWeek ? pick([projects[1], projects[1], projects[0], projects[0], projects[3]]) : rnd() < 0.62 ? main : pick(projects));
  while (t < outMin - 20) {
    if (t >= breakAt && t < breakAt + 30) t = breakAt + 30;
    const p = choose();
    const task = pick(p.tasks);
    let len = 60 + Math.floor(rnd() * 7) * 15;
    if (t < breakAt && t + len > breakAt) len = breakAt - t;
    const end = Math.min(t + len, outMin - 5);
    const last = isToday && end >= outMin - 30;
    if (end - t >= 15) {
      const e = { id: id(), description: task, projectId: p.id, activityId: activityFor(task).id, start: at(d, Math.floor(t / 60), t % 60) };
      // Only the planned task is linked to the Float allocation.
      if (p.floatId && task === p.tasks[p === projects[2] ? 2 : 0]) Object.assign(e, { taskId: p.floatId * 10, taskName: task });
      if (!last) e.end = at(d, Math.floor(end / 60), end % 60);
      entries.push(e);
      if (last) break;
    }
    t = end;
  }
}

// This week's Float plan: what you're booked on, per day.
const mon = monday(today);
const week = [0, 1, 2, 3, 4].map((i) => dayKey(addDays(mon, i)));
const plan = [
  { floatId: 1010, projectId: projects[0].id, name: projects[0].tasks[0], startDate: week[0], endDate: week[4], hoursPerDay: 3, days: week },
  { floatId: 1020, projectId: projects[1].id, name: projects[1].tasks[0], startDate: week[0], endDate: week[4], hoursPerDay: 4, days: week },
  { floatId: 1030, projectId: projects[2].id, name: projects[2].tasks[2], startDate: week[3], endDate: week[4], hoursPerDay: 1, days: week.slice(3) },
];

const lastMondays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => dayKey(addDays(mon, -7 * n)));
const data = {
  version: 1,
  projects: projects.map(({ tasks, ...p }) => p),
  activities,
  entries,
  workdays,
  plan,
  reviewedWeeks: lastMondays,
  settings: {
    language,
    dailyTargetHours: 8,
    autoStartDay: false,
    startDayWithTimer: true,
    shortcutsEnabled: true,
    idleMinutes: 10,
    reviewOnLeave: true,
    autoStopMidnight: true,
    billableEnabled: false,
    balanceStartHours: 6.5,
    balanceStartDate: dayKey(start),
    userName: 'Alex Miller',
    menuBarLabel: 'task-time',
    menuBarColor: 'project',
    activityTrail: false,
    apiEnabled: false,
    apiPort: 7799,
    apiLan: false,
    onboardingDone: true,
    tourDone: true,
    floatPersonId: 1,
    floatPersonName: 'Alex Miller',
    floatLastSync: at(today, 8, 2),
  },
};

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(data, null, 2));
console.log(`wrote ${path.join(dir, 'data.json')}: ${entries.length} entries, ${workdays.length} days`);
