# Changelog

What's new in each version of Gnomon. The app shows this under **Info & feedback**, and the download page on a
Gnomon server shows the newest entry.

## Unreleased

- **Copy day**: one click copies a day's entries as bullet points (with hours, or without) for Weblog or a status message, from the day view, the Week view (*Copy week*) and the menu bar (*Copy today as text*).

## 0.1.20 · 2026-10-25

- **The ready-made server image is published** with this release (`ghcr.io/dennha/gnomon-server`), so the one-command
  install and `gnomon-admin update` download it instead of building. Nothing changes in the Mac app or the server.

## 0.1.19 · 2026-10-25

- **Installing a Gnomon server is one command** on any Linux machine with Docker (`server/deploy/install.sh`). It
  asks how HTTPS is done (Caddy with an automatic or your own certificate, your own reverse proxy, a Cloudflare
  Tunnel, or a local test), generates the secret key, starts the server and prints the link to the setup page.
  Ready-made server images for x86-64 and arm64 come with every release (`ghcr.io/dennha/gnomon-server`, with an SBOM
  and a signed build attestation); building from the code stays possible with `--build`.
- **gnomon-admin on the server's machine:** `status`, `update` (backs up first), `backup`, `restore`, `logs`,
  `restart`, and the links to the setup and Admin pages.
- **Nightly encrypted backups, on by default:** the last 14 are kept on the server, encrypted with a backup password
  that's shown once at install and can be changed on the setup page. The server can make backups but not read them;
  without the password a backup can't be restored, so keep it in your password manager.
- **The setup page starts with your admin account** (name, email, password) and now also covers the server's address
  with an HTTPS check, who may register, where the Mac app comes from (the official release from GitHub, or your own
  upload), backups, and ends with inviting people.
- **The admin guide** ([docs/admin-guide.md](docs/admin-guide.md)) explains everything for IT: install, HTTPS, email
  with SMTP or Microsoft 365, inviting people, handing out the apps, backups and restore, updates, security and
  privacy, troubleshooting, and moving or removing a server.

## 0.1.18 · 2026-10-24

- **Gnomon in the browser:** on your Gnomon server, `/app` opens the Mac app's Track, Week, Reports and Projects in
  your browser. Sign in with your account's email and password; your changes show up on your Mac and phone at their
  next sync. Each browser is listed as a device on your account page, so *Sign out everywhere* ends it too.
- **Your settings follow your account:** daily target, work schedule, starting balance, language, your way of
  working and the weeks you marked done are kept with your account, so your Macs, phone and browser use the same.
  The first Mac to sync brings its settings along; a Mac that signs in later takes the account's. Menu bar, shortcuts
  and appearance stay per device.
- **One place to invite people** (Admin → People → *Invite people*): choose *One person* or *From a list*.

## 0.1.17 · 2026-10-24

- **Invite from a list** (Admin → People): upload a CSV file or paste a list, one person per line with name and email
  (comma, semicolon or tab; a header line and Excel's CSV are fine). A preview shows who is new, who already has an
  account or an invitation, who is in the list twice and which emails are wrong. Only the new people are invited, by
  email in small batches with progress, or as links. Emails that didn't go out are listed and can be tried again, and
  the links download as a CSV file (name, email, link, valid until) to hand out yourself.
- Updating a Gnomon server with the deploy script backs up its data first and leaves the server's own settings alone.

## 0.1.16 · 2026-10-24

- **Email from your Gnomon server** (Admin → Settings → Email): through any mail provider (SMTP, for example Gmail
  with an app password or Hetzner) or Microsoft 365 (an app registration, see the server guide). The password or
  secret is stored encrypted, and *Send a test email* says plainly what went wrong.
- **Invitations by email:** inviting someone sends them their link. Without email it's a link to pass on, as before.
  You choose how long invitations are valid (14 days by default); expired ones show as expired and can be sent again.
- **Forgot your password?** on the sign-in pages (account page, phone, Admin page and the Mac app) sends a link that
  works once, for 30 minutes. Choosing a new password signs out your other devices only if you tick that box. Admins
  can send someone a reset link from the People page.
- **What's coming:** Info & feedback links to the roadmap, which your Gnomon server now shows at `/roadmap`.

## 0.1.15 · 2026-10-24

- **See the entry you just added:** after Enter or +, the new entry lights up where it landed in the day and scrolls
  into view. Typed-in time goes into the first free stretch of your work hours, so it can land in the middle of the
  list.

## 0.1.14 · 2026-10-24

- **Work hours and bookings are kept apart:** your entries no longer move the times you clocked in or out. A day you
  didn't clock in follows your entries exactly and says "From your bookings". The day view shows clocked in, booked
  and the difference between them as a plain hint.
- **Typing a time no longer jumps your day:** time fields save when you press Enter or leave the field, not on every
  keystroke (typing 09:30 used to pass through 00:30 and move your arrival to midnight).
- **Breaks that overlap count once**, and only the part between arriving and leaving counts.
- **Month report:** the numbers above the bars no longer run into each other.
- Building Gnomon from a fresh copy of the code works again.

## 0.1.13 · 2026-10-23

- **Start your way:** the first screen asks whether you use Gnomon on this Mac only, or with an account on a Gnomon
  server, so your Mac, phone and browser stay in step.
- **Sign in with email and password** on the Mac (Settings → Connections → Account) and on your phone. A code from
  the Mac still works too.
- **Your account page** on the server: change your name, email and password, see your devices, and sign out
  everywhere at once.
- **Invite people:** the server's admin has a People page. Invite someone with a link, approve new accounts, make
  someone an admin, or disable an account. Each server decides who may register: invited only, with approval, or
  anyone. Admins never see anyone else's times.

## 0.1.12 · 2026-10-23

- **Connect your phone** from the sidebar: while your Mac is connected to a Gnomon server and no phone is yet, a small
  tile offers it. Click it, scan the QR code, and Gnomon tells you when your phone is in. The × hides it for good.
- **Your own account on the server:** a Gnomon server now keeps each person's times and devices apart. Everything
  that was on your server is now your account; the admin page asks once for your email.

## 0.1.11 · 2026-10-23

- **Feedback right in the app:** under Info & feedback, write your idea or bug and press Send. It goes straight to the
  people who make Gnomon, and the answer shows up right below, with a notification when it arrives.
- **Devices name themselves** on your Gnomon server ("Alex's MacBook Pro", "iPhone · Safari"), and the server's
  admin page has its own sign-in with a password.

## 0.1.10 · 2026-10-22

- **Open your server's admin from the Mac:** Settings → Connections → *Open server admin* signs you in in the browser,
  no terminal needed. There you see every connected device (Mac, phone, browser) with when it was last active, rename
  or disconnect it, and add a phone by scanning a QR code.

## 0.1.9 · 2026-10-22

- **Your arrival stays where it is.** Gnomon only moves it earlier on its own, to cover an entry that starts before
  it, and never later. Each time, a note says from when to when, with **Undo**.
- **Start day makes the day yours:** if Gnomon had made today's workday from your entries, pressing Start day stops it
  from following them.
- A break can no longer end before it starts.

## 0.1.8 · 2026-10-18

- **Labs**: five quick clicks on the icon under Info & feedback open a hidden Settings tab. Play the morning welcome
  whenever you like (as a preview, nothing is clocked in), switch Daylight, or show the tour again. Hide it any time;
  the same five clicks bring it back.
- The name field in the intro keeps what you type and no longer cuts off its focus ring.

## 0.1.7 · 2026-10-18

A friendlier start to the day, and a calmer Track page.

- **Good morning**: the first time you open Gnomon on a workday, a short sunrise greets you by name with a line from a
  Greek philosopher. Clocking in first, one click starts the day; tracking live, the tracker is right there, ready with
  today's first planned task. Switch it off under Settings → Tracking.
- **The intro** asks for your first name (skip it if you like), tells each step the way you chose to work, and keeps
  the same size on every page.
- **Track**: description, project and task sit in one field; entries run oldest first with **+ Add entry** below;
  times and durations are quieter; delete and continue only show on hover.
- **Activities are optional** (off on new installs). Add one right at the chips with **+**, or right-click a chip to
  hide it there; your reports keep its history.
- **Week**: cells look like fields you can click into, the Tracked row is calmer, and "days under target" is a small
  badge with a list.
- **Reports**: one card for where the time went, the overtime explanation behind an ⓘ, and the starting balance links
  to Settings. The month chart labels no longer run into the bars.

## 0.1.6 · 2026-10-18

- **Your way of working decides where Gnomon opens**: clocking in first, the **Week** comes first in the sidebar and
  opens on start; tracking live, **Track** does. Pages and names stay the same for everyone.
- The Track page looks the same for both ways of working again.
- A clearer README for people choosing a time tracker.

## 0.1.5 · 2026-10-17

The two ways of working now really differ.

- **Clock in, fill in later**: the menu bar shows today's work time. After *Leave*, a
  reminder says what's still to assign, and on the week's last workday afternoon, "Fill in your week".
- **Track live**: the timer leads as before; the menu bar shows the running task. You're reminded when you're clocked
  in but no timer has run for 20 minutes, and asked about pauses between timers.
- Reminders can be switched off under Settings → Tracking.

## 0.1.4 · 2026-10-17

Two ways to work, and clocked-in time that always fits what you tracked.

- **How do you like to work?** The first-start tour asks: *clock in and fill in later*, or *track live with timers*.
  The answer sets a few defaults and the order of the tour; switch any time under Settings → Tracking.
- **The workday follows your entries**: a day with entries but no clock-in gets its workday from them, and entries
  outside your hours move arrival or leaving to cover them. A short note says what moved; changes by hand win.
- **Week view**: one *Tracked* row, with *"1:30 to assign"* on days where you were clocked in longer than you've
  filled in. Hours typed into the week go inside your clocked-in time instead of starting at 09:00.
- **Live tracking**: after a pause between two timers, Gnomon asks *"Were you on a break from 12:05 to 12:50?"*;
  a forgotten *Leave* is suggested from the end of your last timer.
- **Phone**: pair by scanning the QR code with the app's own camera scanner.

## 0.1.3 · 2026-10-17

- **Sync with your phone**: when this Mac is connected to a Gnomon server (Settings → Connections), your times,
  workdays, projects and activities sync automatically, about once a minute and right after changes, so the phone
  and the Mac show the same. If the same thing changed on both, the later edit wins. Float plans, settings and the
  activity trail stay on the Mac. Status and "Sync now" are in the same card.

## 0.1.2 · 2026-10-17

- **Daylight ruler**: with Daylight on, hour marks appear along the top. Drag along them, swipe sideways on the
  trackpad or use the arrow keys to move the light through the day; it glides back to now when you let go.

## 0.1.1 · 2026-10-17

Small moments and a few things you asked for.

- **Work schedule**: hours per weekday (full time, 4-day week, part time or your own), with changes from a date, so
  earlier months keep counting the old way; optionally count every scheduled workday in the overtime balance.
- **Look**: light, dark or like macOS, and five highlight colours, under Settings → General.
- **Moments**: starting the day, a break, leaving and the week's end get small, quiet animations; reaching your daily
  target and finishing the week are celebrated once. Switched off when macOS reduces motion.
- **Info & feedback**: version, update check, what's new and the open-source projects Gnomon uses.
- **Easter egg**: there's something hidden under Info & feedback. Try clicking things.
- **Shortcuts** work with German keyboards (QWERTZ) and stay visible in Settings when switched off.

## 0.1.0 · 2026-10-17

The first version for colleagues.

- **Clock in, clock out**: start your day, take breaks and leave from the sidebar, the menu bar or a shortcut;
  forgotten days are closed at midnight and Gnomon asks when you really left.
- **Track projects**: timers with projects, tasks and activities; the quick switcher (⌃⌥P) works from any app;
  activity sets for designers, project managers, directors, 3D, UX and UI.
- **Catch up later**: a weekly timesheet with copy last week, repeat a day and fill from your Float plan.
- **Overtime balance**: month by month, with a work schedule per weekday that can change from a date.
- **Float and Personio**: your plan and your absences come in automatically (read-only).
- **Phone**: a small web app on your own server, paired by QR code, with a time clock to correct today.
- **Company setup**: Gnomon reads a settings profile from Iru and hides what the company manages.
- **Look**: light, dark or like macOS, five highlight colours, English and German, a short tour on first start.
