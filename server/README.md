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
| `GET /sync?since=<cursor>&limit=` | Changes since a cursor (see below). |
| `POST /sync` | Push changes from another copy of the data (see below). |
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
devices (earliest arrival, latest leaving). Float plans, settings and the activity trail stay on the Mac.
Status and "Sync now" are in the same Settings card.

## Layout

```
server/
  src/store.ts       SQLite: records (JSON + seq + updatedAt + tombstones), devices, pairing codes
  src/app.ts         HTTP: auth, body limits, server-only routes, sync, static files with CSP
  src/server.ts      entry point          src/admin.ts   gnomon-admin CLI
  roadmap/           the /roadmap page, rendered from docs/ROADMAP.md at build time
  web/               the PWA (React, bundled with esbuild; Material Symbols inlined)
  tests/             node:test end-to-end tests
  Dockerfile, docker-compose.yml, deploy/deploy-to-pi.sh
```

## Not done yet

- Offline tracking on the phone (taps while offline show an error; nothing is queued).
- Float plans and "Planned today" on the phone; projects and activities are managed on the Mac (the phone can create
  a project by name when starting a timer).
