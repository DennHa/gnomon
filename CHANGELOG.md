# Changelog

What's new in each version of Gnomon. The app shows this under **Info & feedback**, and the download page on a
Gnomon server shows the newest entry.

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
