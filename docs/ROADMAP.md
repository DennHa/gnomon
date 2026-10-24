# Roadmap

What's coming to Gnomon, and what it already does well. Updated 2026-10-24.

## Now

- **Bulk import of people.** CSV or pasted text for about 150 people at once.
- **Invitations by email.** SMTP (Gmail, Hetzner, any provider) or Microsoft 365 via an Entra app, since basic-auth
  SMTP is being retired. CSV of invitation links as a fallback. Admin sets how long an invitation is valid.
- **Password reset by email.** Needs the email sending from the invitations.

## Next

- **Web app with sign-in.** Colleagues without a Mac can use Gnomon in the browser. Also the answer for Windows, at
  least at first.
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

## Left out on purpose

- **Invoicing and billable rates.** Gnomon is for employees, not for billing clients.
- **Screenshots, GPS, activity scores.** Monitoring breaks trust. Leaving it out is a feature.
