# Gnomon in a company: plan

> **Status: partly built.** The Mac app reads the settings profile and has a managed mode, and the server has the
> setup wizard and Admin page (without company sign-in yet: people connect with invitation links). See "What's still
> to build" at the end. Today every person connects Float and Personio themselves, with tokens
> stored in their own Mac's keychain. This document describes how a company-wide setup would work and what's
> still to build. The concrete plan for people, accounts and sign-in is in [accounts-design.md](accounts-design.md).

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

Gnomon.app on the Mac (signed with an Apple Developer ID and notarized, see "Before you start")
  └─ "Sign in" with the company's existing login (Microsoft, Google, Okta, Keycloak… via OpenID Connect),
     or with an invitation from the admin when the company has no single sign-on
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

## What the admin does: the setup wizard

> **Built** (except the sign-in screen). The admin never edits config files by hand: after starting the server, a
> guided web page walks through everything once and produces the files to roll Gnomon out with Iru. Code:
> `server/src/company.ts` (settings, encryption, checks, profile), `server/web/admin.tsx` (the page).

### Getting to the wizard

1. **Start the server** on company infrastructure, reachable over HTTPS (Docker; see
   [server/README.md](../server/README.md)). The only things set outside the wizard are the data folder and an
   encryption key for secrets (`GNOMON_SECRET_KEY`, e.g. as a Docker secret).
2. On its first start, the server prints a **one-time setup link** (and a QR code) in its log, valid for 60 minutes,
   for example `https://gnomon.example.com/setup#code=ABCD-EFGH`. Without that code nobody can open the wizard, so a
   freshly started server can't be claimed by someone else on the network.
3. When the wizard is finished, the setup link stops working. Later changes go through the **Admin** page: until
   company sign-in exists, `gnomon-admin admin-link` (Docker: `docker exec gnomon gnomon-admin admin-link`) prints a
   one-time link to it, valid 60 minutes. A session lasts two hours after the last change and ends on restart.

### Before you start

The wizard's first screen is a checklist, so nothing surprises the admin halfway through. Each item says why it's needed
and what happens without it.

| Needed | Why | Without it |
|---|---|---|
| **An HTTPS address** for the server (e.g. `gnomon.example.com`) | Phones and Macs only talk to the server over HTTPS | The wizard stops here |
| **A signed and notarized Gnomon app** (Apple Developer ID) | macOS only runs apps from outside the App Store without questions when they're signed with an Apple Developer ID and notarized by Apple. Mac management tools such as Iru expect that too | Fine for a test with a few people (each allows the app once in System Settings); not for a rollout |
| **A company login** (optional) | So people sign in with the account they already have | People get personal invitation links from the admin instead |
| **Admin access to Float and Personio** (optional) | Only admins can create the API tokens | Plans and absences aren't imported; people enter days off by hand |
| **Mac management (Iru or similar)** (optional) | Installs the app and the settings on every Mac | People install the app themselves and connect it with a link |

About the **Apple Developer ID** (Apple Developer Program, 99 € a year, as a person or as a company):

- **Use the official Gnomon build** once it's signed and notarized by the Gnomon project. The roll-out screen offers it
  for download; nothing to do for the company.
- **Or sign it yourself** with the company's own Developer ID, for example to show the company as the publisher. The
  roll-out screen links to a short guide (sign, notarize, staple) and accepts the signed `.dmg` as an upload.
- A native **iPhone app** later (TestFlight, App Store or private company distribution through Apple Business Manager)
  needs a Developer account in any case.

The server runs on Linux and can't sign Mac apps itself; signing always happens on a Mac.

### The screens

| # | Screen | What the admin enters | What Gnomon checks or shows |
|---|---|---|---|
| 0 | **Before you start** | Ticks the checklist above | Which optional parts will be skipped, and a link to come back later |
| 1 | **Welcome** | Company name, the server's public address (`https://gnomon.example.com`), time zone, default daily target (e.g. 8 h), default language | That the address is reachable over HTTPS and matches the browser's address; server version |
| 2 | **Sign-in** | First the kind of login (see "Sign-in options" below), then its details: for Microsoft the directory (tenant) ID; for Google the Workspace domain; for any other provider its issuer address. Always the client ID and client secret of an app registered there, and optionally the groups allowed to use Gnomon and to administer it. With *Invitations*, nothing | Step-by-step instructions for the chosen provider with copy buttons for the redirect addresses to register (one for the server, `gnomon://auth` for the Mac app). It reads the provider's discovery document to check the address. **Test sign-in**: the admin signs in and becomes the first Gnomon admin |
| 3 | **Float** (optional) | The Float API token (Account Settings → Integrations, owner/admin only) | **Test connection**: shows the Float account name and how many people it has. Explains that people are matched by work email and that Gnomon only reads |
| 4 | **Personio** (optional) | Client ID and secret of Personio API credentials with read access to absences and employees | **Test connection**: number of employees and absence types. The admin ticks which types become days off (vacation, sick, special leave…); half days stay manual |
| 5 | **Weblog** | Nothing yet | "Coming once Weblog has an API" |
| 6 | **Rules** | On/off switches: local API on Macs, activity trail, central storage of time entries, phone web app. Who may see team totals (default: nobody) | A short note per switch on what it means for privacy; a reminder about the works council |
| 7 | **Roll-out** | Nothing | **Download** the Iru settings profile (`Gnomon.mobileconfig`, filled in from screens 1, 2 and 6) and the latest `Gnomon.dmg`. A checklist for Iru: add the app as a Custom App, the profile as a Custom Profile, assign both to one test Mac first, then to everyone |
| 8 | **Done** | Nothing | Summary of what's set up, a link to the Admin page, and "the setup link no longer works" |

Every integration screen can be skipped and filled in later from the Admin page.

### Sign-in options

Gnomon doesn't care which company login is used, as long as it speaks **OpenID Connect**, the open standard that
nearly all of them support. The wizard offers:

| Option | For | What the admin needs |
|---|---|---|
| **Microsoft Entra ID** (Microsoft 365, Teams) | Most companies on Microsoft | An app registration in Entra; the wizard fills in the provider address from the tenant ID |
| **Google Workspace** | Companies on Google | An OAuth client in Google Cloud; sign-in limited to the company domain |
| **Other provider (OpenID Connect)** | Okta, Keycloak, Authentik, JumpCloud, Auth0, OneLogin, a company's own login server… | The provider's issuer address (the wizard reads `/.well-known/openid-configuration` from it), a client ID and secret |
| **Invitations** (no single sign-on) | Small teams, or companies whose login doesn't support OpenID Connect | Nothing: the admin creates a personal invitation link or QR code per person on the Admin page; each Mac and phone gets its own key, which the admin can revoke |

A login that only speaks the older **SAML** standard can be connected through a bridge that translates to OpenID
Connect (Keycloak and Authentik both do); until then, invitations work. Who counts as an admin is decided by a group
from the login (or, with invitations, by the admin who set up the server). Switching the sign-in later keeps
everyone's data: people are matched by their work email.

### Secrets

- Tokens and client secrets are typed into the wizard once, encrypted with `GNOMON_SECRET_KEY` and stored only on
  the server. Afterwards the Admin page shows "set ✓" with a **Replace** button, never the value itself.
- They're never sent to a Mac, a phone or the browser again, and never written into the Iru profile.
- The Admin page keeps a short log of who changed which setting and when (never the values).

## The Iru settings profile

The wizard's download is a standard macOS configuration profile with one "custom settings" payload for Gnomon's
preference domain `app.gnomon.timetracker`. The app reads it on start (managed preferences), so a Mac that has it is
preconfigured. Profiles are readable by the person using the Mac, so the profile holds **addresses, IDs and switches
only**, never tokens or passwords. A client ID is public by design; the Mac signs in with PKCE and needs no secret.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadDisplayName</key>  <string>Gnomon</string>
  <key>PayloadIdentifier</key>   <string>com.example.gnomon</string>
  <key>PayloadType</key>         <string>Configuration</string>
  <key>PayloadUUID</key>         <string>00000000-0000-0000-0000-000000000001</string>
  <key>PayloadVersion</key>      <integer>1</integer>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key>       <string>app.gnomon.timetracker</string>
      <key>PayloadIdentifier</key> <string>com.example.gnomon.settings</string>
      <key>PayloadUUID</key>       <string>00000000-0000-0000-0000-000000000002</string>
      <key>PayloadVersion</key>    <integer>1</integer>

      <!-- Where the company server is, and that this Mac is managed -->
      <key>serverUrl</key>         <string>https://gnomon.example.com</string>
      <key>managed</key>           <true/>

      <!-- Sign-in: the company login via OpenID Connect (public values, no secret) -->
      <key>signIn</key>            <string>oidc</string>
      <key>signInIssuer</key>      <string>https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0</string>
      <key>signInClientId</key>    <string>00000000-0000-0000-0000-000000000000</string>

      <!-- Rules from wizard screen 6 -->
      <key>allowLocalApi</key>     <false/>
      <key>allowActivityTrail</key><true/>

      <!-- Defaults the person can still change -->
      <key>dailyTargetHours</key>  <real>8</real>
      <key>language</key>          <string>system</string>
    </dict>
  </array>
</dict>
</plist>
```

| Key | Type | Meaning |
|---|---|---|
| `serverUrl` | string | The company server; the app talks only to this one |
| `managed` | bool | Hides the integrations guide, token fields and own-server pairing (see below) |
| `signIn` | string | `oidc` (company login) or `invite` (invitation links from the admin) |
| `signInIssuer`, `signInClientId` | string | The login provider's issuer address and the app's client ID (public). For Microsoft, `entraTenantId` and `entraClientId` work as a shorthand |
| `updateUrl` | string | Where new versions are announced (a `version.json`); defaults to `<serverUrl>/latest/version.json` |
| `allowLocalApi` | bool | Whether the local REST API (API.md) may be switched on |
| `allowActivityTrail` | bool | Whether the opt-in activity trail is offered |
| `dailyTargetHours`, `language` | number, string | Starting values on a fresh install; the person can change them |

The app reads `/Library/Managed Preferences/<user>/app.gnomon.timetracker.plist`, then
`/Library/Managed Preferences/app.gnomon.timetracker.plist`. Unknown or badly typed keys are ignored. To try a profile
without Iru, start the app with `PROFILE_FILE=/path/to/profile.plist` (or a `.json` with the same keys).

## What the employee sees

1. Gnomon appears in Applications (installed by Iru).
2. First start: **Sign in** with their company account (or open the invitation link they got), then the short tour.
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
| 1 | ✅ Mac app reads the settings profile (`serverUrl`, `managed`, rules, defaults) | done |
| 2 | ✅ Managed mode hides the integration guide, token fields and pairing; the profile's rules switch off the local API and the activity trail | done |
| 3 | ✅ Server: first-start setup link, the wizard (screens 0, 1, 3–8), the Admin page via `gnomon-admin admin-link`, secrets encrypted at rest, invitation links | done |
| 4 | Sign-in with any OpenID Connect provider (presets for Microsoft and Google) and invitations, on the server and in the Mac app | medium |
| 5 | Server becomes multi-user; Float and Personio sync on the server per person | large |
| 6 | ✅ Profile and .dmg downloads from the wizard · Iru roll-out tested with a real Mac | partly done |
| 7 | A signed and notarized official build (Apple Developer ID), and the guide for companies signing their own | small, once the ID exists |
| 8 | ✅ Sync of time entries Mac ↔ server (one person); for companies it needs step 5 | partly done |
