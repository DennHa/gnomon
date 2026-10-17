# Gnomon in a company: plan

> **Status: planned, not built yet.** Today every person connects Float and Personio themselves, with tokens
> stored in their own Mac's keychain. This document describes how a company-wide setup would work and what's
> still to build.

## Why the server has to do it

Float and Personio don't give employees personal API tokens:

- **Float:** one API token for the whole account, only visible to account owners and admins.
- **Personio:** API credentials (client ID + secret) are created by a Personio admin, for the whole company.

These tokens can read *everyone's* schedules and absences. They must never be copied onto employee Macs: anyone
with the app could extract them. So in a company, the tokens live on a server run by the company, and each
person only ever receives *their own* data.

## How it fits together

```
Iru (Mac management, formerly Kandji)
  └─ installs Gnomon.app on every Mac
  └─ pushes a settings profile: server address, sign-in settings, "managed" switch (no secrets)

Gnomon.app on the Mac
  └─ "Sign in with Microsoft" (Microsoft Entra ID, the existing company account)
  └─ talks only to the company's Gnomon server

Gnomon server (company)
  └─ holds the Float token and Personio credentials (entered once by an admin)
  └─ checks who is signed in, finds the person in Float and Personio by work email
  └─ returns only that person's plan, projects and absences
  └─ optionally stores time entries centrally (backup, phone app, later team reports)

Float API · Personio API (read-only)
```

Without a company server nothing changes: Gnomon keeps working on its own, and one person can still connect
Float and Personio with their own tokens, as today.

## What the admin does (once)

1. **Run the Gnomon server** on company infrastructure with HTTPS (Docker; see [server/README.md](../server/README.md)).
2. **Register an app in Microsoft Entra ID** (App registrations): sign-in with OpenID Connect, a redirect back to
   Gnomon, and optionally a group that's allowed to use it.
3. **Enter the integration credentials on the server**: the Float API token and the Personio client ID + secret.
   They're stored on the server only, encrypted, and never sent to a Mac or phone.
4. **Deploy with Iru**: add Gnomon.app as a custom app, and a settings profile for the app's domain
   `app.gnomon.timetracker`, for example:

   ```xml
   <key>serverUrl</key>        <string>https://gnomon.example.com</string>
   <key>entraTenantId</key>    <string>00000000-0000-0000-0000-000000000000</string>
   <key>entraClientId</key>    <string>00000000-0000-0000-0000-000000000000</string>
   <key>managed</key>          <true/>
   ```

   Profiles are readable by the user, so they contain addresses and IDs only, never tokens or passwords.

## What the employee sees

1. Gnomon appears in Applications (installed by Iru).
2. First start: **Sign in with Microsoft**, then the short tour of the key features.
3. Their Float plan and Personio absences are already there; nothing to configure.

## Managed mode: what's hidden

When the profile says `managed`, the Mac app hides what the person can't or shouldn't change:

- the **integrations setup guide** (Float, Personio, Weblog),
- the **Float token** and **Personio credentials** fields,
- the **phone pairing with your own server** (the company server is used instead),
- optionally the **local API key** settings (a company policy decides whether the local API is allowed).

Settings → Connections then shows "Managed by your company" with the server address and who is signed in.

## Privacy and rules

- Each person sees only their own data. Whether team leads see anything (e.g. totals per project) is a separate,
  explicit decision, not a default.
- The server keeps only what Gnomon needs: the person's plan, absences and, if central storage is on, their time
  entries. The activity trail never leaves the Mac.
- In Germany, introducing a time-tracking tool usually involves the works council (Betriebsrat) and data
  protection. Plan for that before rolling out.

## What's still to build

| Step | What | Size |
|---|---|---|
| 1 | Mac app reads the settings profile (`serverUrl`, `managed`, …) | small |
| 2 | Managed mode hides the integration guide, token fields and pairing | small |
| 3 | Sign in with Microsoft Entra (app + server), replacing pairing codes for company use | medium |
| 4 | Server becomes multi-user; Float and Personio sync on the server per person | large |
| 5 | Optional: central storage of time entries, sync Mac ↔ server | large |
| 6 | Iru deployment notes tested with a real profile | small |
