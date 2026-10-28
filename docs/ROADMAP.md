<!--
Each "- **Title.** Text" bullet is an item people can vote on and comment in the app (Info & feedback → What's
coming). Its id is made from the title ("A drafted day." → a-drafted-day). Renaming an item? Keep its votes by
writing the old id right after the bullet's text as a one-line HTML comment: the opening <!--, then
"id: a-drafted-day", then the closing marker. Votes for an id that is gone show up in the admin's export, they
aren't lost.
-->
# Roadmap

What's coming to Gnomon, and what it already does well. Updated 2026-10-28 (0.1.24).

## Now

Nothing in progress right now; the next step is chosen from the list below.

## Next

- **Tidy up the day.** After Leave, round the day's bookings to 15 minutes (or 5 or 10) so they add up to the booked
  total, with a preview and Undo. Clocked work hours are never rounded.
- **A drafted day.** Suggest the day from the calendar plus the activity trail Gnomon already keeps, on the Mac only so
  it stays private.
- **Calendar as a memory aid.** Show meetings next to the day; one click turns one into an entry. macOS Calendar first
  (one permission), Microsoft Graph later.
- **German working-time hints.** Gentle notes for more than 10 hours a day, less than 11 hours of rest, or a missing
  30/45-minute break.
- **Half days and hourly absences.** Personio half days are skipped today. Needed for an honest balance.
- **Float and Personio per person on the server.** The server keeps the admin tokens and hands each person only their
  own plan and absences.

## Later

- **Company login (OIDC).** Microsoft, Google or Okta. Only invited people get in.
- **Close a month.** Submit or lock a month, plus an export the payroll or HR team can use.
- **Send booked hours back to Float.** Float's logged time fills itself, so plan versus actual works without double
  entry.
- **Team reports with consent.** Only as an opt-in, agreed with the works council. Admins still never see single
  entries by default.

## What Gnomon does today

- **Work hours and bookings kept apart.** Clock in/out and breaks are one layer, project bookings another. The
  difference is only a hint.
- **Overtime balance on your own schedule.** Part time, a free Friday, changes from a date, a starting balance from the
  company.
- **Float plan and Personio absences built in.** Fill the week from the plan in one click; vacation and sick days don't
  count against you.
- **Two ways of working.** Clock in and fill in later, or track live with timers. Asked on first start, switch any time.
- **Private by design.** Data on your Mac or your own server. Admins manage accounts but never see anyone's times.
- **Fast and native on the Mac.** Menu bar, ⌃⌥P quick switcher from any app, reminders only when something is missing.
- **Free, no tier changes.** No price hikes, no features moving to higher tiers.
- **Invitations by email.** Through any mail provider (SMTP) or Microsoft 365. The admin chooses how long an
  invitation is valid.
- **Bulk import of people.** Paste a list or upload a CSV, check the preview, invite everyone by email or as links.
- **Password reset by email.** A link that works once, for 30 minutes, from every sign-in page.
- **Web app with sign-in.** Track, Week, Reports and Projects in the browser at `/app`; your settings follow your
  account.
- **Easy install for admins.** One command on any Linux machine with Docker, with HTTPS your way, a setup page in
  the browser, nightly encrypted backups and an admin guide.
- **A clear admin page.** An overview of who's in, who's invited, what needs attention and the server's health.
- **Data encrypted at rest.** The server's database and backups are encrypted, with the key kept outside the data.
- **Copy the day as text.** One click turns a day or a week into bullet points for Weblog or a status message.
- **Target corridor instead of an overtime bank.** Optional: a rolling average of your hours against your target,
  with zones, as an alternative to the overtime balance. A company can switch it on for everyone.
- **Vote and suggest on the roadmap.** In the app under Info & feedback: vote, comment and suggest ideas, with an
  account on a Gnomon server.
- **Public roadmap.** This page, at `/roadmap` on your Gnomon server and linked from Info & feedback.

## Left out on purpose

- **Invoicing and billable rates.** Gnomon is for employees, not for billing clients.
- **Screenshots, GPS, activity scores.** Monitoring breaks trust. Leaving it out is a feature.
