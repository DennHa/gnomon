# Gnomon: findings & decisions

What we learned while building Gnomon, why it works the way it does, and what's still open.
Last updated 17 Oct 2026.

## 1. The core idea: two ways of tracking

Time gets recorded in two very different moments, and each needs its own tool:

| | **Live** (during the day) | **Afterwards** (evening or end of week) |
|---|---|---|
| Question | "What am I doing *now*?" | "What did I do, and is it complete?" |
| Where | Menu bar, global shortcuts, quick switcher, **Today** page | **Timesheet** (week grid, cell and day modals) |
| Unit | Exact start/stop times | Hours per project and day |
| Goal | Zero friction; never break your flow | Complete and correct with the least typing |

Attendance (clock in/out, breaks) is a third, separate concern: it lives in the sidebar and the menu bar and
answers "how long was I at work", not "on what".

## 2. Data model in one picture

- **Project:** *who/what* the work is for (Client XYZ). Optional daily goal; can come from Float.
- **Task:** a Float allocation on a project ("Landing page design, 4.5 h/day, Mon–Wed"). Optional per entry.
- **Activity:** *what kind* of work (Call, Design, Presentation). One per entry, same list for all projects.
- **Description:** optional free text; *what exactly*.
- **Entry:** one continuous stretch on one project + task + activity.
- **Workday:** in, out, breaks, or a day off.

**Rule of thumb:** start a new entry when the project, task or activity changes. Within the same task, don't
split; one entry with a good description is easier to read than many tiny ones.
(We tried bullet notes on entries and removed them again: they added a second place to type without
adding clarity.)

## 3. Psychology: how to make tracking easy enough that people actually do it

1. **The default should be right.** The task is picked automatically when a project has exactly one Float task
   today; a recent description brings its project and activity back; "Use plan" fills a cell with what was planned.
2. **Switching beats stopping.** People forget to stop timers but readily click what they do *next*. Activity
   chips, the quick switcher and the menu bar all start the next entry and close the previous one.
3. **Capture where you already are.** The menu bar shows the running task (not a ticking clock, which feels like
   surveillance), ⌃⌥Space works from any app, and ⌃⌥S / ⌃⌥B stop or pause without switching windows.
4. **No blocking popups.** Corrections are offered, never forced: the idle dialog appears only after you were
   really away, "Close the day" shows gaps but lets you leave, and nudges are quiet notifications.
5. **Recall aids for later.** The weakest part of after-the-fact tracking is memory. The Float plan shows what you
   *intended*; the opt-in activity trail shows which apps were in front ("Figma 9:05–11:40"). Together they turn
   "what did I do Tuesday?" into recognition instead of recollection. (A Teams/Outlook calendar would be the
   third, strongest cue; see section 8.)
6. **Make incompleteness visible, not punishing.** Red only means "below plan"; "days under 8h" is a list you
   can open, not a warning banner; "Mark week as done" gives a sense of closure.
7. **Forgetting to stop is normal; recover gracefully.** A workday or timer left open overnight is closed at 23:59
   (midnight auto-stop) and flagged until you enter the real leave time; the sidebar and a banner ask once. When you
   come back after being away, the dialog offers "Clock out at <time you left>", which is the default after 3+ hours.
8. **Plan vs. actual is motivating.** Showing planned hours as grey placeholders turns an empty cell into a
   small, concrete to-do.

## 4. Design decisions

- **Sidebar:** Today, Timesheet and Reports at the top; the attendance block; Projects & activities and Settings
  at the bottom (set up once, rarely visited).
- **Today:** the timer comes first, then "Planned today", today's entries with exact times, and "Close the day"
  after leaving.
- **Timesheet:** a week grid. A cell opens a list for that project and day (description … hours, then **+**);
  a day header opens the whole day (in/out, breaks, all entries, review).
- **Visual style:** Material Symbols (rounded) instead of emoji, no hairline borders (soft fills instead),
  dark mode follows macOS, and the menu-bar icon takes the project or activity colour while tracking.
- **Name:** "Gnomon", the pointer of a sundial: the oldest time-tracking tool there is. (The first name, "Punch", sounded too much like hitting someone.)

## 5. Integrations

### Float (built, read-only)

- API v3 with one company-wide token (owner/admin only); Gnomon reads only *your* allocations.
- Allocations become per-day plans with task names and time windows; Float projects join the project list;
  time off and public holidays become days off.
- Syncs once a day in the morning or with "Sync now". `task_days` from Float already exclude weekends and holidays.
- Tested end to end against a mock of the documented API, **not yet against a real Float account**.
- Possible next step: push tracked time back into Float's **Logged Time**.

### Personio (built, read-only)

- API v2 (developer.personio.de, checked 17 Oct 2026): `POST /v2/auth/token` (OAuth client credentials, form-encoded,
  token valid 1 day, kept in memory in the main process), `GET /v2/persons?email=` to find you,
  `GET /v2/absence-periods?person.id=…&starts_from.date_time.lte=…&ends_at.date_time.gte=…` (cursor pagination via
  `_meta.links.next`, up to 100 per page), `GET /v2/absence-types` for names, and `GET /v2/absence-periods/{id}/breakdowns`
  for the per-day amounts. Scopes: `personio:persons:read`, `personio:absences:read`.
- Window: about the last month and the next 3 months, like Float. Approved absences (and ones waiting for deletion) count; pending ones don't.
- Days come from the **breakdowns** (Personio's own per-day amounts, which skip weekends and public holidays). Ongoing
  absences (no end yet) and periods whose breakdowns can't be read fall back to start/end dates, weekdays only; an end at
  00:00 on a later day is treated as exclusive (Personio's example "31 Dec 00:00 → 1 Jan 00:00" is one day).
- **Half days and hourly absences are skipped**, not imported: Gnomon has no half day off, and a full day off would hide
  the half you worked. The sync message says how many were skipped so you can enter them yourself.
- Personio days off use `offSource: 'personio'`; a later sync updates or removes only those. Personio takes over a day
  Float marked as time off (Personio is the system of record for absences); days you recorded yourself are never touched.
- Rate limits: v2 doesn't document them for these endpoints. Gnomon sends requests one at a time and backs off on 429
  (Retry-After, else 1 s / 2 s / 4 s). Auth is limited to 150 token requests per minute, which caching avoids.
- Wrong credentials are dropped again right away, so the fields reappear.
- Tested against `tests/personio-mock.cjs` (documented shapes, pagination, a forced 429, wrong credentials), **not yet against a real Personio account**.
  Things to confirm there: the exact end-time format of full-day periods, and whether `ends_at.date_time.gte` also matches ongoing absences.

### Weblog (not built)

The company's own booking tool. Its API isn't known yet, so the first-launch guide shows an honest "coming soon: ask
your Weblog admin for API access" step with a feedback link. Next step once docs exist: push finished days.

### First-launch guide

Desktop only (never in the phone web app). Shown while `settings.onboardingDone` is unset; three skippable steps
(Float, Personio, Weblog) with progress dots. Settings → *Set up integrations* clears the flag to reopen it. The Float and
Personio connect flows are shared with Settings (`src/views/integrations.tsx`). Screenshots: `START_VIEW=onboarding@2`
opens step 2.

### Gnomon API (built)

A local REST API for your company's system: see [API.md](API.md). It's off by default, needs a key, listens
on localhost unless network access is allowed, and supports idempotent upserts via `externalId`.

### Clockify (removed)

The first version synced with Clockify; dropped because Gnomon became the system itself.

## 6. Security review

| Area | Status |
|---|---|
| Electron | Upgraded **33 → 44.8** (33 no longer got Chromium security fixes). Keep updating. |
| Renderer isolation | `contextIsolation`, `sandbox`, no Node in pages, small preload API only. |
| Content Security Policy | Production build allows only local scripts and styles; no remote code. |
| Navigation | Windows can't navigate away or open new windows. |
| Secrets | The Float token, the Personio credentials and the API key are encrypted with a key held in the macOS keychain (`safeStorage`) and never returned to the page. |
| Files | Folder and files readable only by your user (0600); written atomically. |
| Network | Only Float and Personio (read-only, fixed base URLs) and the optional local API. No analytics, tracking or auto-update. |
| Local API | Bearer key with constant-time comparison; 127.0.0.1 by default; 1 MB body limit; strict validation (dates, lengths, colours, ranges). No CORS, so web pages can't use it. |
| Activity trail | Opt-in; app names only (never window titles); local; about two months kept; deletable. Uses `lsappinfo` with fixed arguments and no shell. |
| Dependencies | `npm audit`: 8 moderate findings, all in build or dev tools (electron-builder's download helper, the esbuild/vite dev server); none ship in the app. |
| Code signing | Ad-hoc signed (fine on your own Mac). Distributing to others needs an Apple Developer ID and notarisation. |

**Residual risks:**
- `data.json` is plain JSON, so anyone with access to your user account can read it. FileVault covers the disk.
- With network access on, the API key is the only protection, and traffic is plain HTTP.

## 7. Where data lives

`~/Library/Application Support/Gnomon/`:

| File | Contents |
|---|---|
| `data.json` | Everything (entries, workdays, projects, activities, settings, Float plan) |
| `float-token.json`, `personio-credentials.json`, `api-key.json` | Encrypted secrets |
| `trail.json` | Activity trail (only if enabled) |

## 8. Ideas not built yet

- **Teams / Outlook calendar** as a recall aid and a live prompt ("Weekly sync started; track it as Call?").
  The options, simplest first:
  - a published ICS link (no sign-in, but often disabled by IT)
  - the macOS Calendar app (EventKit, one permission prompt)
  - Microsoft Graph (needs an app registration and often IT approval)
- **Push to Float Logged Time**, so plan vs. actual in Float fills itself.
- **Mobile web app** on the Raspberry Pi (next step, see below).
- Rules that learn ("meetings with @xyz.com → Client XYZ · Call").

## 9. Next step: mobile web app on the Raspberry Pi

Goal: track from the phone without publishing an app, as a web app (PWA) hosted on the Pi.

**Main architectural question.** Today the data lives in the Mac app. For a phone, the **Pi becomes the source
of truth** (a small server with a database, SQLite for instance), and the Mac app syncs with it. Alternatively, the
phone talks to the Mac's API over the network, but that only works while the Mac is on, which defeats the purpose.

**Sketch:**
1. A Node service on the Pi with the same REST shape as [API.md](API.md), with SQLite and per-device keys.
2. A mobile-first PWA served from the Pi: timer, today, quick week view, add to home screen.
3. Mac Gnomon gets "sync with server": push changes and pull new ones, with `externalId`-style conflict handling.
4. Access over Tailscale (no open ports, HTTPS via MagicDNS), same pattern as the existing timeKeep project.

## 10. How it was tested

- 20 unit tests (`npm test`):
  - duration parsing and timesheet maths
  - plan gaps and automatic task picking
  - activity switching and resuming
  - idle handling
  - Float import running twice
  - Personio absence mapping (half days, exclusive ends, breakdowns, pending) and import running twice
  - day-off rules
- End to end in the real Electron app with scripted input and screenshots:
  - Today and Timesheet
  - the cell and day modals
  - the quick switcher window
  - Settings
  - the Float connect flow against a mock API (pagination and auth included)
  - the first-launch guide (all three steps) and the Personio connect + sync flow against `tests/personio-mock.cjs` (pagination, a 429, wrong credentials)
  - menu bar contents and all 13 global shortcuts registered
  - migration of old data (tags → activities)
- API: 22 `curl` checks covering auth, upserts, PATCH and DELETE, workdays, timer, summary, the error cases and
  binding to localhost only.
- Packaged `.dmg`: signature verified; the packaged app launches.

**Not verified automatically:**
- the idle dialog after real inactivity
- macOS notifications
- clicking through the native menu-bar menu
- a real Float account
- a real Personio account
