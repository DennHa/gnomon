<p align="center"><img src="docs/icon.png" width="96" alt="Gnomon icon"></p>

<h1 align="center">Gnomon</h1>

<p align="center"><b>Work hours and project time for your Mac, without the busywork.</b><br>
Clock in and out, see where your time went, and always know your overtime balance.</p>

<p align="center"><img src="docs/hero/hero-timer.jpg" width="880" alt="Gnomon: a running timer, close up"></p>

<p align="center"><b><a href="https://github.com/DennHa/gnomon/releases/latest">⬇ Download for Mac</a></b> · <a href="CHANGELOG.md">What's new</a></p>

<p align="center"><sub>A gnomon is the pointer on a sundial: the oldest time-tracking tool there is.</sub></p>

## Why Gnomon

Most time trackers make you choose: an attendance clock for HR, or a project timer for invoices, and both expect you
to remember to press start. Gnomon does both in one place and fits the way you already work.

- **Works the way you do.** Some people clock in and sort out the details at the end of the day; others time every
  task live. Gnomon is good at both, and you can switch whenever you like.
- **Attendance and project time never disagree.** Time on projects always lies inside the hours you were at work.
  Add an entry outside your hours and your workday adjusts; a day with entries but no clock-in gets one from them.
- **Your overtime balance, always right.** A work schedule per weekday (part time, a free Friday, a change from
  July on), vacation and sick days, and time off in lieu all count correctly, month by month.
- **Out of the way.** It lives in the menu bar, works with keyboard shortcuts from any app, and only reminds you when
  something is actually missing.
- **Private by default.** Your data stays on your Mac. No account, no cloud, no analytics. A phone app is optional and
  runs on your own server.

## Two ways to work

Gnomon asks on the first start which one sounds like you, and opens on the page that fits. Both are always available.

**Clock in, fill in later.** You record when you arrive and leave, and assign the hours afterwards.
1. **Start day** in the morning, **Break** at lunch, **Leave** in the evening: from the sidebar, the menu bar, a
   shortcut, or your phone.
2. Later, with your calendar open, the **Week** view shows what's still unassigned for each day.
3. Type hours into the week, copy last week, or fill it from your project plan. Entries land inside the hours you
   were at work.

**Track live.** You time what you're doing as you do it.
1. Start a timer from the **Track** page or with ⌃⌥P from any app. The first timer of the day clocks you in.
2. Switch project or activity with a click; there's no stopping in between.
3. Paused between two timers? Gnomon asks whether that was a break. **Leave** stops the running timer.

## What you get

### Clock in and out in a click

Start, pause and end your day from the sidebar, the menu bar or a keyboard shortcut. Forgot to clock out? Gnomon
closes the day at midnight and suggests when you really left, based on your last timer.

<img src="docs/hero/hero-start-day.jpg" width="880" alt="Start day in the sidebar">

### Project time without friction

Start or switch a timer from any app: press ⌃⌥P and type a few letters. Activities (Design, Call, Workshop…) switch
without stopping the clock, and ready-made activity sets fit designers, project managers, directors, 3D, UX and UI.
With **Float** connected, your planned projects for the day are one click away, with progress against the plan.

<img src="docs/screenshots/quick-switcher.png" width="560" alt="Quick switcher: start or switch a timer from any app">

### A week you can fill in afterwards

The Week view is a timesheet: hours per project and day, what's still unassigned, and shortcuts to repeat yesterday,
copy last week, or turn your plan into entries. Mark a week as done when it's complete.

<img src="docs/hero/hero-week.jpg" width="880" alt="Week timesheet with copy last week and fill from plan">

### Your overtime balance

Every workday counts against your target from your own work schedule. Vacation and sick days (from **Personio**, or
marked by hand) don't count against you; days off in lieu use the balance. Start from the balance your company's system
shows, and Gnomon carries on from there.

<img src="docs/hero/hero-balance.jpg" width="880" alt="Overtime balance per month">

### On your phone, too

A small web app on your own server: clock in on the way to work, correct today's times, start a timer, and look at your
week. It syncs with the Mac. Pair a phone by scanning a QR code. See [server/README.md](server/README.md).

<img src="docs/hero/hero-phone.jpg" width="880" alt="The phone web app: time clock and week">

## Connects to

- **Float**: your planned projects and tasks per day, public holidays and time off. Read-only.
- **Personio**: approved vacation, sick days and other absences become days off. Read-only.
- **Your own systems**: a local REST API to read times and push entries, for example from a company tool. See
  [API.md](API.md).
- **CSV export** of any week or month, with your name on it.

## Privacy

Everything lives on your Mac in `~/Library/Application Support/Gnomon/`, readable only by your user. Tokens and keys are
encrypted with the macOS keychain. Gnomon only talks to services you connect yourself (Float, Personio, your own Gnomon
server), and only checks for updates on your own server. There's no account, no analytics and no tracking.

## Get started

1. Download the latest **Gnomon-…-arm64.dmg** from [Releases](https://github.com/DennHa/gnomon/releases/latest)
   (Apple silicon Macs).
2. Open it and drag **Gnomon** into **Applications**.
3. First start: **right-click Gnomon → Open**, then confirm. The app isn't signed with an Apple Developer ID yet, so
   macOS asks once.
4. A short tour shows the basics; connect Float or Personio afterwards under Settings → Connections if you use them.

To have it ready every morning, add Gnomon under System Settings → General → Login Items. Updating: drag the new
version over the old one; your data stays where it is.

## For teams (planned)

Float and Personio hand out company-wide admin tokens, which don't belong on every Mac. For teams, a company-run Gnomon
server holds those tokens and gives each person only their own plan and absences; people sign in with the company login they
already have (Microsoft, Google, Okta and others, or by invitation), and IT deploys Gnomon preconfigured with Iru or another Mac management tool. The Mac app already
supports managed settings; the rest is planned. See [docs/company-setup.md](docs/company-setup.md).

## Screenshots

| | |
|---|---|
| <img src="docs/screenshots/track.png" alt="Track: running timer, today's plan and entries"> | <img src="docs/screenshots/morning.png" alt="Morning: not clocked in yet"> |
| <img src="docs/screenshots/week.png" alt="Week timesheet"> | <img src="docs/screenshots/week-day.png" alt="A day in detail"> |
| <img src="docs/screenshots/reports.png" alt="Reports with the overtime balance"> | <img src="docs/screenshots/quick-switcher.png" alt="Quick switcher (⌃⌥P from any app)"> |

<p>
<img src="docs/screenshots/phone-clock.png" width="260" alt="Phone: the time clock with Correct today">
&nbsp;
<img src="docs/screenshots/phone-today.png" width="260" alt="Phone: today with a running timer">
&nbsp;
<img src="docs/screenshots/phone-week.png" width="260" alt="Phone: this week">
</p>

<sub>All pictures use made-up demo data.</sub>

---

## For developers

A macOS app built with Electron, React and TypeScript; the optional server is Node with SQLite.

```bash
npm install
npm run dev     # Vite + Electron with hot reload
npm start       # production build, then launch
npm test        # logic tests
npm run dist    # Gnomon.app and a .dmg in release/
```

Keep the project outside synced folders such as Nextcloud, which strip the execute permission from files in
`node_modules` and break the build.

**Releases.** Bump `version` in `package.json` and add a section to `CHANGELOG.md`, then
`npm run dist && npm run release:manifest` and upload the `.dmg`. A Gnomon server can host the download and the
`version.json` the app's update check reads (see
[server/README.md](server/README.md#download-page-for-the-mac-app-optional)).

**Pictures.** `sh scripts/screenshots.sh` and `node node_modules/electron/cli.js scripts/phone-screenshots.cjs` retake
the screenshots with demo data (`scripts/demo-data.cjs`); `scripts/hero-shots.cjs` renders the close-ups; `npm run icon`
renders the icons from `build/*.svg`.

**Data files** in `~/Library/Application Support/Gnomon/`:

| File | What |
|---|---|
| `data.json` | Entries, workdays, projects, activities, settings, imported plan. Plain JSON, written atomically. |
| `float-token.json`, `personio-credentials.json`, `api-key.json`, `server.json` | Secrets, encrypted with a key in the macOS keychain (Electron `safeStorage`); never sent to the window. |
| `server-sync.json` | Sync state with your Gnomon server. |
| `trail.json` | Activity trail, only if switched on: app names and times, never window titles. |

**Security.** Windows are sandboxed with context isolation and no Node.js access; the page reaches the system only
through a small preload API. The build has a strict Content-Security-Policy, and windows can't navigate away. Float and
Personio calls go through the main process with fixed base URLs and read-only endpoints. To test against mocks, set
`FLOAT_API_BASE` or `PERSONIO_API_BASE` (`node tests/personio-mock.cjs`).

More: [API.md](API.md) (local REST API), [server/README.md](server/README.md) (server and phone app),
[docs/company-setup.md](docs/company-setup.md) (company setup), [FINDINGS.md](FINDINGS.md) (decisions and notes).
