# Gnomon server & mobile web app

Track time from your phone without publishing an app. The server keeps your Gnomon data in SQLite and serves a
small web app (PWA) that you add to your home screen. It speaks the same REST API as the Mac app ([API.md](../API.md)),
because it runs the Mac app's own API code (`../src/api.ts`, `actions.ts`), plus a few routes for the phone and for syncing.

**Self-hosted only.** There is no Gnomon cloud. You run the server on a machine you control (a Raspberry Pi, a home
server, a small VPS) and reach it over HTTPS.

```
 iPhone (PWA) ──HTTPS──▶ Cloudflare Tunnel ──▶ cloudflared ──proxy-net──▶ gnomon:8080 (Node + SQLite)
 Mac Gnomon   ──(later: sync, see below)──────────────────────────────────▶
```

What the phone can do:

- **Time clock (Stempeln, the first tab):** start day, break and leave with big buttons, today's worked time against the daily
  target, and **Correct today**: change when you came or left and edit, add or delete breaks (for a misclick).
- **Timer:** a big start/stop timer; project and activity chips (tapping an activity while the timer runs switches
  to it); "Continue" for recent work; today's entries, which you tap to edit or delete. A line at the top shows
  whether you're clocked in and opens the time clock.
- **Week:** hours per day as bars coloured by project, plus totals per project. ‹ › for earlier weeks. Tap a day to
  enter time after the fact (description, project, activity and a duration like `1:30`, `1,5` or `90m`), edit or
  delete its entries, and set its attendance (in, out, break).
- **Device:** which device this is, "Connect another device" (shows a QR code), and "Disconnect", which revokes its key.
- Follows the phone's language (English/German) and dark mode. The app shell works offline; tracking needs the server.

## Web app (`/app`)

**`/app`** is the Mac app's own interface (Track, Week, Reports, Projects, Settings) in a laptop browser, signed in
with the account's email and password, on that person's data on this server. Changes reach the Mac and the phone on
their next sync, and theirs show up here (every minute, or on reload). It's built with the server (`npm run build`
writes `dist/web/app/`), so nothing else needs setting up.

- **What's not there:** what needs the Mac: menu bar, global shortcuts and the quick switcher, idle detection, the
  activity trail, Float and Personio, the local API, pairing a phone, updates and feedback. Appearance follows the
  system. No offline mode: the page needs the server.
- **Sessions:** signing in makes a device of yours, listed on the account page as "Browser · Safari" (or Chrome,
  Firefox…), so removing it there or *Sign out everywhere* ends the session. Its key is only in a cookie,
  `__Host-gnomon_session`: HttpOnly (scripts can't read it), Secure (HTTPS only; browsers also allow it on
  `http://localhost`), SameSite=Strict, scoped to this host. It lasts 30 days and starts over each time the app
  opens, so it ends after 30 days unused. *Sign out* in Settings → Account revokes it.
- **CSRF:** requests with the cookie also need the token from `/web/login` or `/web/session` in an `X-Gnomon-CSRF`
  header (other sites can't read it), and when the browser sends `Origin` or `Sec-Fetch-Site`, they must say this
  server. Wrong passwords lock like everywhere else (5 tries, then 15 minutes).
- **Content-Security-Policy:** scripts, styles, images and requests only from this server; no inline scripts or
  styles, no framing.
- *Forgot your password?* opens `/account/forgot`, which sends a reset link by email.

| Method & path | What it does |
|---|---|
| `POST /web/login` | `{ email, password }` → `{ csrf, me, device }` and the session cookie. |
| `GET /web/session` | With the cookie: `{ csrf, me, device }` (renews the cookie), or 401. |
| `POST /web/logout` | Revokes the session's device and clears the cookie. |

With the cookie and the token, every other route under `/api/v1` works as for a device key.

## Run it locally

```bash
cd server
npm install
npm test                                        # 17 end-to-end tests against a temporary database
npm run dev                                     # http://localhost:8787, data in server/.data/
GNOMON_DATA_DIR=./.data npm run admin -- pair "Browser"   # pairing code to sign in
```

Open http://localhost:8787 and enter the code. Data and keys are in `server/.data/gnomon.db`.

## Devices and keys

Every device has its own key, so you can revoke one (a lost phone) without touching the others. Keys are stored as
SHA-256 hashes, so the database doesn't hold them in a usable form.

| Command (`gnomon-admin …` in Docker, `npm run admin -- …` locally) | |
|---|---|
| `pair "iPhone"` | One-time code (`ABCD-EFGH`), valid 10 minutes. Enter it in the web app; the phone gets its own key. |
| `add-key "Mac"` | Create a key directly (for the Mac app or scripts); shown once. |
| `devices` | List devices with last-seen time. |
| `revoke <id or name>` | Revoke a key immediately. |
| `backup /data/backup.db` | Consistent copy of the database while the server runs. |

**Pairing with a QR code instead of the server command:** once one device is connected, it can invite the next.
In the Mac app, Settings → **Phone (Gnomon server)**: enter the server address and a pairing code once
(`gnomon-admin pair "MacBook"`), then **Connect a phone** shows a QR code. Scanning it with the phone's camera opens
`https://gnomon.example.com/#pair=ABCD-EFGH`; the web app connects by itself and removes the code from the address bar.
The code is also shown as text, for typing it into the app instead. The phone's Device tab can do the same for a
third device. On iPhone, the home-screen app has its own storage, separate from Safari. So once Safari is connected, the page
prepares a fresh one-time code (valid 60 minutes) and puts it into the address the home-screen app opens first; the
app then connects by itself. If it still asks for a code, create a new one and type it in.

After 10 wrong pairing codes in a row, all open codes are dropped and pairing is locked for 15 minutes.

## Deploy on the Raspberry Pi (Cloudflare Tunnel)

This follows the Pi's existing pattern (see `00_PiSetup/PI_DOCKER_BASELINE.md`): the container joins the shared
`proxy-net` network, `cloudflared` forwards a public hostname to it, and **no host port is published**.

1. **Check the Pi first** (read-only):
   ```bash
   ssh user@your-pi 'docker network inspect proxy-net >/dev/null && echo ok; docker ps --format "{{.Names}}" | grep -x gnomon || echo "name free"'
   ```
2. **Deploy** from the Mac (copies only `src/` and `server/`, builds on the Pi, shows status, health and logs):
   ```bash
   server/deploy/deploy-to-pi.sh user@your-pi
   ```
   The first build on the Pi takes a few minutes. Redeploying keeps the data (Docker volume `gnomon_gnomon-data`).
3. **Add the public hostname in Cloudflare** (Zero Trust → Networks → Tunnels → your tunnel → Public Hostname):
   `gnomon.example.com` (or any name) → Service `HTTP` → `gnomon:8080`.
   Check it: `curl -s https://gnomon.example.com/healthz` → `{"ok":true}`.
4. **Pair the phone:**
   ```bash
   ssh user@your-pi docker exec gnomon gnomon-admin pair "iPhone"
   ```
   Open the hostname in Safari, enter the code, then Share → **Add to Home Screen**.
   Pair from inside the home-screen app if it asks again: on iOS, the home-screen app may keep its own storage.

Update later by running the deploy script again. Back up with:

```bash
ssh user@your-pi 'docker exec gnomon gnomon-admin backup /data/gnomon-backup.db && docker cp gnomon:/data/gnomon-backup.db ./gnomon-backup.db'
```

### Security notes for a public hostname

A Cloudflare Tunnel makes the app reachable **from the whole internet**. What protects your data:

- Every API call needs a device key (192 random bits); the only route without a key is pairing, which is rate-limited
  and accepts only short-lived, single-use codes that you create on the server.
- HTTPS ends at Cloudflare, then runs inside the tunnel. The container publishes no port and only joins `proxy-net`.
- The container runs as an unprivileged user with a read-only filesystem, all capabilities dropped and
  `no-new-privileges`; only the `/data` volume is writable. The database file is mode 0600.
- The web app has a strict Content Security Policy (only its own scripts, no inline code, no third parties), no CORS,
  no framing. The phone keeps its key in the app's local storage.
- Optional extra lock: put **Cloudflare Access** in front of the hostname (e.g. one-time PIN to your email). Then a key
  alone is not enough. Downsides: the home-screen app has to sign in to Access every now and then, and the Mac sync
  would need an Access service token.

## Hosting it yourself (other setups)

Anything that runs Docker on arm64 or x86-64 works. The web app needs **HTTPS** for the home-screen install and
offline shell (plain `http://localhost` is fine for testing).

- **Without Cloudflare:** remove the `networks:` sections from `docker-compose.yml` and add
  `ports: ["127.0.0.1:8080:8080"]`, then put your reverse proxy (Caddy, nginx, Traefik) in front with HTTPS.
  For LAN-only use, `tailscale serve` or a Tailscale sidecar (like the timeKeep project) gives HTTPS without opening
  ports.
- **Time zone:** set `GNOMON_TZ` (default `Europe/Berlin`). It decides which day an entry or workday belongs to.
- **Without Docker:** Node 20+, `npm ci && npm run build && GNOMON_DATA_DIR=/var/lib/gnomon node dist/server.mjs`.

| Environment variable | Default | |
|---|---|---|
| `PORT` | `8080` | |
| `HOST` | `0.0.0.0` | |
| `GNOMON_DATA_DIR` | `./data` (`/data` in Docker) | Where `gnomon.db` lives |
| `TZ` | system | Set by `GNOMON_TZ` in compose |

## Company setup (optional)

For a team, the server has a setup wizard: on the first start the log shows a one-time link (`/setup#code=…`, valid 60
minutes; a restart makes a new one). It walks through the company details, Float and Personio (tokens are checked,
then stored encrypted), the rules for Macs, and the roll-out: a settings profile for Iru and invitation links for
people. Afterwards `gnomon-admin admin-link` opens the Admin page for changes. Set `GNOMON_SECRET_KEY` (for example as a
Docker secret) to keep the encryption key out of the data folder; without it, a key file `secret.key` is created there.
Personal use can ignore all of this. Details: [docs/company-setup.md](../docs/company-setup.md).

## Email: invitations and password resets (optional)

With email set up (Admin → Settings → Email), inviting someone emails them their link, people can reset a forgotten
password themselves (*Forgot your password?* on the sign-in pages: a link that works once, for 30 minutes), and an
admin can send someone a reset link from the People page. The link always goes to the person's own email; admins never
see it. Without email, invitations are links you pass on by hand, as before. Invitations are valid for 14 days by
default (People → *Invitations are valid for*); expired ones show as expired and can be sent again.

**Inviting many people at once:** People → *Invite from a list*. Upload a CSV file or paste a list, one person per
line with name and email, separated by comma, semicolon or tab, for example `Jane Doe; jane.doe@example.com`. A header
line is optional; with one, columns such as *Name*, *First name* / *Last name* (*Vorname* / *Nachname*) and *Email*
are recognised, in any order. Excel's CSV works (quotes, a byte order mark, and Windows' older encoding); an `.xlsx`
file has to be saved as *CSV UTF-8* first. Up to 1000 lines per list.

Before anything happens, a preview shows each line as *new*, *has an account*, *already invited*, *twice in the list*
or *not an email*, with a count of each. Only the new people are invited, as members, with the validity set under
*Invitations are valid for*. With email set up you choose: send the invitations by email (10 at a time, with
progress; keep the page open) or only create links. Emails that didn't go out are listed with the reason and can be
tried again. *Download links (CSV)* saves name, email, link and valid until for every invitation that wasn't emailed,
to hand out yourself or send through your own mail. The links are shown only then, so keep the file safe and delete it
once they're handed out. For scripts: `POST /api/v1/admin/people/import/preview {text}` and
`POST /api/v1/admin/people/import {people: [{name, email}], by: "email" | "link", again?}` (up to 50 people per call),
both for admins only.

The server's address (Settings → Company, or `GNOMON_PUBLIC_URL`) must be set: the links in emails point to it. Emails
come from the sender address you enter, with the server's name (Settings → Company) as the sender name. The password
or client secret is stored encrypted like the Float and Personio tokens and is never shown again. *Send a test email*
checks everything and says what went wrong.

**SMTP** works with any provider:

| Provider | Host | Port and security | User and password |
|---|---|---|---|
| Gmail / Google Workspace | `smtp.gmail.com` | 465 TLS or 587 STARTTLS | your address and an [app password](https://myaccount.google.com/apppasswords) (needs 2-step verification) |
| Hetzner | `mail.your-server.de` | 587 STARTTLS | the mailbox address and its password |
| others | from your provider | 465 TLS or 587 STARTTLS | usually the mailbox address |

The sender address usually has to be that mailbox or one of its aliases. A password is never sent unencrypted: “None”
is only for a mail relay on the same machine.

**Microsoft 365** sends through Microsoft Graph with an app registration, because Microsoft is retiring SMTP sign-in with
a password. Once, as a Microsoft 365 admin:

1. Create a mailbox to send from, for example a shared mailbox `gnomon@example.com` (shared mailboxes need no licence).
2. [Entra admin center](https://entra.microsoft.com) → Applications → **App registrations** → **New registration**: a
   name like *Gnomon mail*, "Accounts in this organizational directory only", no redirect URI.
3. On its **Overview**, copy the **Directory (tenant) ID** and the **Application (client) ID**.
4. **Certificates & secrets** → **New client secret**: copy its **Value** (not the Secret ID). Note when it expires and
   enter a new one in Gnomon before then.
5. Let the app send **only as that mailbox**, with RBAC for Applications in Exchange Online (PowerShell,
   `Connect-ExchangeOnline`). The Object ID is the one under Entra → **Enterprise applications** → *Gnomon mail*:

   ```powershell
   New-ServicePrincipal -AppId <client-id> -ObjectId <enterprise-app-object-id> -DisplayName "Gnomon mail"
   New-ManagementScope -Name "Gnomon sender" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'gnomon@example.com'"
   New-ManagementRoleAssignment -App <client-id> -Role "Application Mail.Send" -CustomResourceScope "Gnomon sender"
   Test-ServicePrincipalAuthorization -Identity <client-id> -Resource gnomon@example.com
   ```

   Don't also grant *Mail.Send* under the app's **API permissions** in Entra: that permission covers every mailbox
   and would undo the restriction. (Older setups grant Mail.Send in Entra with admin consent and restrict it with
   `New-ApplicationAccessPolicy -AppId <client-id> -PolicyScopeGroupId gnomon@example.com -AccessRight RestrictAccess`;
   that works too, but Microsoft is replacing it with the above.)
6. In Gnomon: Admin → Settings → Email → **Microsoft 365**: tenant ID, client ID, client secret and
   `gnomon@example.com` as the sender. Save, then *Send a test email* (changes in Exchange can take a little while).

## Download page for the Mac app (optional)

The server can also hand out the Mac app: **`/latest`** is a short page with the version, what's new, a download
button and install steps (English or German, following the browser); **`/latest/version.json`** is what the app's
update check under *Info & feedback* reads; **`/latest/download`** is the `.dmg`.

1. Build the app and its manifest (in the repo root): `npm run dist && npm run release:manifest`. This writes
   `release/version.json` (version, date, the notes from that version's section in `CHANGELOG.md`, the file name).
2. Put `release/version.json` and `release/Gnomon-<version>-arm64.dmg` into a folder on the server and point
   `GNOMON_RELEASES_DIR` at it (in Docker: mount it read-only, see the commented lines in `docker-compose.yml`).
3. Replacing the two files publishes a new version; no restart needed.

Without `GNOMON_RELEASES_DIR`, `/latest` just says that nothing has been published. **The page and download are
public**: anyone who can reach the server can download the app (it contains no data or secrets). If that's not
wanted, keep the folder empty and share the app another way (e.g. a private GitHub Release).

The Mac app looks for updates at `<server>/latest/version.json` of the server it's paired with, or at the `updateUrl`
or `serverUrl` of a company profile (see `docs/company-setup.md`), so the download can live on any host.

## One-page site and web demo (optional)

**`/about`** serves the one-page site from `site/` in the repo: put that folder on the server and point `GNOMON_SITE_DIR`
at it (in Docker: mount it read-only). Public, static, nothing from other servers.

### Roadmap

**`/roadmap`** shows `docs/ROADMAP.md`, read-only: `npm run build` turns it into a static page (`dist/roadmap/`, see
`roadmap/render.mjs`), in the same look as `/about`, with the same strict CSP (no scripts, nothing from elsewhere). It's
always on and public; the Docker image and `deploy/deploy-to-pi.sh` take the file along, so a redeploy publishes the
current roadmap. Without the file at build time, `/roadmap` isn't served.

### Web demo

Show Gnomon to people before they download it: **`/example`** is the Mac app's own interface in the browser, and
**`/example/phone`** the phone app (in a phone-shaped frame on a computer), both on made-up data. The demo never talks to
the server: each visitor's changes stay in their own browser, and *Reset* starts over. It always plays on Wednesday
of the current week at 14:35, so there's a full week to look at.

1. Build it in the repo root: `npm run build:demo` (writes `dist-demo/`).
2. Put the contents of `dist-demo/` into a folder on the server and point `GNOMON_DEMO_DIR` at it (in Docker: mount it
   read-only, like the releases folder).

Without `GNOMON_DEMO_DIR`, `/example` isn't served. Like `/latest`, it's public.

## API

Everything in [API.md](../API.md) works under `/api/v1` with `Authorization: Bearer <device key>`, same errors and
limits. In addition, the server has:

| Method & path | What it does |
|---|---|
| `POST /pair` | `{ "code": "ABCD-EFGH" }` → `{ key, device }`. No key needed. |
| `POST /pair-codes` | `{ name, minutes? }` → `{ code, name, expiresAt }`: a signed-in device invites another one (QR code); `minutes` 1–60, default 10. |
| `PATCH /workdays/:date` | `{ in?: "08:15", out?: "17:05" \| null, breaks?: [{ start, end }] }`: correct a day without replacing it. Returns the same as `GET /state`. |
| `GET /me`, `DELETE /me` | This device; `DELETE` revokes its own key. |
| `GET /state` | Everything the Today screen needs: running timer, today's workday, `onBreak`, projects, activities, daily target, server time. |
| `POST /activities` | `{ name, color? }`, creates an activity or returns the one with that name. |
| `POST /day/break` | Start or end a break (stops the timer, like the Mac app). |
| `POST /timer/activity` | `{ activityId }`, switches the running timer to another activity. |
| `GET /sync?since=<cursor>&limit=` | Changes since a cursor, and the account settings (see below). |
| `POST /sync` | Push changes from another copy of the data, and changed account settings (see below). |
| `GET /healthz` | Liveness, no key (used by Docker). |

### Sync (used by the Mac app)

The server is the source of truth. Every write gets a sequence number; a client remembers the last `cursor` it saw.

**Pull:** `GET /sync?since=0` returns up to 5000 changes, oldest first:

```json
{ "cursor": 42, "more": false, "changes": [
  { "kind": "entries", "id": "0db8…", "updatedAt": "2026-10-17T07:19:42.313Z", "deleted": false,
    "data": { "id": "0db8…", "description": "Landing page", "projectId": "…", "start": "…", "end": "…" } },
  { "kind": "entries", "id": "77aa…", "updatedAt": "…", "deleted": true, "data": null } ] }
```

`kind` is `projects`, `activities`, `entries` or `workdays` (keyed by date). `data` is the record exactly as in the
Mac app's `data.json` (`src/types.ts`). Repeat with `since=<cursor>` while `more` is true.

**Push:** `POST /sync` with `{ "changes": [ { kind, id, updatedAt, deleted, data } ] }` (up to 20 MB / 20 000 changes).

- Records use the client's own UUIDs, so no id mapping is needed; workdays are keyed by date.
- **Last writer wins per record:** a change is applied only if its `updatedAt` is not older than the server's copy;
  otherwise it comes back in `skipped` with `server_newer`. Pushing the same batch twice is harmless.
- `updatedAt` more than 5 minutes in the future is rejected (wrong device clock).
- If a push leaves two running timers (the phone and the Mac each started one), the newest keeps running and the
  other ends when it started.

**How the Mac uses it** (`src/sync.ts`, run by the store; the main process does the HTTP calls with the key):
once connected under Settings → Connections, the Mac syncs on start, every minute and a few seconds after each change.
It remembers the cursor and the last agreed version of every record (`server-sync.json` next to `data.json`, mode
0600), pulls, merges, pushes its own changes, and pulls again for the server's final word. If the same record changed
on both sides between two syncs, the later edit wins: the Mac notes when each record changed there, the server stamps
the phone's changes (a Mac edit made before a restart counts as made at the next sync). The very first sync joins projects and activities with the
same name (the Mac's ids stay), drops the server's unused starter activities, and combines a day stamped on both
devices (earliest arrival, latest leaving). Float plans, the device's own settings and the activity trail stay on the
Mac. Status and "Sync now" are in the same Settings card.

**Account settings:** with an account, the server is where the settings that belong to the person live, so every
Mac, the phone and the web app use the same ones: language, daily target and work schedule, starting balance, your
name, the way of working, reminders and the morning welcome, activities and billable on or off, clocking in and
reviewing on leave, stopping at midnight, and the weeks marked done (`ACCOUNT_SETTINGS` in `src/sync.ts`). Menu bar,
shortcuts, idle detection, appearance and the Float/Personio connections stay per device.

- Every pull has `"account": { "values": { … }, "updatedAt": "…" }`, or `null` while no device has sent any.
- A push may carry `"account": { values, updatedAt }`; it's taken if it's newer than the server's (unknown keys are
  dropped), also into the person's settings for the phone and the API. The answer has the server's current `account`.
- The first Mac to sync gives the account its settings. A Mac that signs in later, or a second Mac, takes the
  account's instead of overwriting them. After that, when both sides changed them between two syncs, the later change
  wins, as for records.

## Layout

```
server/
  src/store.ts       SQLite: records (JSON + seq + updatedAt + tombstones), devices, pairing codes
  src/app.ts         HTTP: auth, body limits, server-only routes, sync, static files with CSP
  src/web.ts         the web app's session cookie and CSRF checks (/app; the app itself is ../src/web)
  src/mail.ts        sending email: SMTP (own small client) and Microsoft Graph
  src/emails.ts      the emails' texts (English, German)   src/invites.ts  inviting a list of people
  src/server.ts      entry point          src/admin.ts   gnomon-admin CLI
  roadmap/           the /roadmap page, rendered from docs/ROADMAP.md at build time
  web/               the PWA (React, bundled with esbuild; Material Symbols inlined), the account and Admin pages
  tests/             node:test end-to-end tests
  Dockerfile, docker-compose.yml, deploy/deploy-to-pi.sh
```

## Not done yet

- Offline tracking on the phone (taps while offline show an error; nothing is queued).
- Float plans and "Planned today" on the phone; projects and activities are managed on the Mac (the phone can create
  a project by name when starting a timer).
