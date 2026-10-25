# Running a Gnomon server: the admin guide

This guide is for the person who installs and looks after a company's Gnomon server. It covers the install, HTTPS,
the setup page, email, inviting people, handing out the apps, backups, updates and security. It needs no programming:
copying a few commands into a terminal is enough. Developers will find the internals in
[server/README.md](../server/README.md).

**What the server does:** it keeps everyone's times, gives each person a sign-in (email and password) for the Mac app,
the phone app and the web app, sends invitations and password resets by email, hands out the Mac app, and (optionally)
holds the Float and Personio tokens so people get their own plans and absences. **There's no Gnomon cloud:** the
server runs on your machine and the data stays there.

Contents: [What you need](#what-you-need) · [Install](#install) · [HTTPS](#https-the-four-ways) ·
[The setup page](#the-setup-page) · [The Admin page](#the-admin-page) · [Email](#email) · [Inviting people](#inviting-people) ·
[The Mac app](#handing-out-the-mac-app) · [Phone and web](#phone-and-web-app) · [Backups](#backups-and-restore) ·
[Encryption at rest](#encryption-at-rest) · [Updates](#updates) · [Security and privacy](#security-and-privacy) · [Troubleshooting](#troubleshooting) ·
[Moving or removing](#moving-or-removing-a-server) · [Example: a Raspberry Pi](#example-a-raspberry-pi-with-a-cloudflare-tunnel)

## What you need

| | |
|---|---|
| **A Linux machine** | Any distribution with **Docker Engine and the Docker Compose plugin** (`docker compose`), on x86-64 or arm64 (a VM, a small cloud server, a Raspberry Pi 4/5). 1 CPU, 1 GB of RAM and a few GB of disk are plenty for 150 people. |
| **A host name** | For example `gnomon.example.com`, pointing at the machine (or at your proxy, or a Cloudflare Tunnel). Phones and Macs only talk to the server over HTTPS. |
| **An email account to send from** (recommended) | SMTP (any provider) or Microsoft 365. Without it, invitations are links you pass on yourself, and nobody can reset a forgotten password themselves. |
| **A password manager** | For the data key and the backup password (both shown once at install) and your admin password. |
| Optional | Admin access to Float and Personio (for plans and absences), and a Mac management tool such as Iru (to roll out the app). |

Install Docker from [docs.docker.com/engine/install](https://docs.docker.com/engine/install/) if it isn't there.

## Install

On the machine, as root (or a user in the `docker` group):

```bash
curl -fsSL https://raw.githubusercontent.com/DennHa/gnomon/main/server/deploy/install.sh -o install.sh
less install.sh        # read it first: it's a plain shell script
sudo sh install.sh
```

It checks Docker, asks a few questions (install folder, [how HTTPS is done](#https-the-four-ways), the host name, the
time zone), and then:

1. writes the folder (default `/opt/gnomon`): `compose.yml`, `.env` with a **newly generated secret key and data
   key**, and a `Caddyfile` if Caddy does HTTPS,
2. puts the `gnomon-admin` command on the machine (`/usr/local/bin/gnomon-admin`),
3. downloads the published server image (`ghcr.io/dennha/gnomon-server`), starts it, and checks HTTPS,
4. shows the **data key**, which encrypts all data on disk, and sets a **backup password**, showing it once: put both
   in your password manager now ([data key](#encryption-at-rest), [backup password](#backups-and-restore)),
5. prints the **one-time link to the setup page** (and a QR code), valid for 60 minutes.

Open the link and follow the [setup page](#the-setup-page). If the link expired: `gnomon-admin setup-link`.

**Scripted installs** take everything as options, for example:

```bash
sudo sh install.sh --yes --https caddy --domain gnomon.example.com --tz Europe/Berlin
```

| Option | |
|---|---|
| `--dir DIR` | Install folder (default `/opt/gnomon`) |
| `--https MODE` | `caddy`, `caddy-own`, `proxy`, `tunnel` or `local` (see below) |
| `--domain NAME` | The host name |
| `--cert FILE --key FILE` | Your own certificate and key, PEM (`caddy-own`) |
| `--bind ADDR --port N` | Where Gnomon listens on the machine (`proxy`, `local`) |
| `--tunnel-token TOKEN` | The Cloudflare Tunnel's token (`tunnel`) |
| `--tz ZONE` | Time zone that decides which day an entry belongs to |
| `--version V` | A specific version instead of the newest |
| `--build` | Build the image from the source code on the machine instead of downloading it (for policies that require it; needs `git`, takes a few minutes) |
| `--image NAME` | Use an image from your own registry, e.g. after mirroring and scanning it (`registry.example.com/gnomon-server:1.2.3`) |
| `--no-start` | Only write and check the folder; start later with `docker compose up -d` there |

**Checking the image:** every published image has an SBOM and a signed build attestation. With the GitHub CLI:
`gh attestation verify oci://ghcr.io/dennha/gnomon-server:<version> --owner DennHa`.

## HTTPS: the four ways

Companies do HTTPS differently, so the install asks:

**1. Caddy with an automatic certificate** (`--https caddy`). The simplest when the machine is reachable from the
internet: a [Caddy](https://caddyserver.com) container in front of Gnomon gets a free certificate from Let's Encrypt
and renews it by itself. Needs: the host name's DNS record pointing at this machine, and ports **80 and 443** open to
the internet (Let's Encrypt checks port 80). Nothing else to do.

**2. Caddy with your own certificate** (`--https caddy-own --cert cert.pem --key key.pem`). For a certificate from
your company's certificate authority, or a wildcard certificate. The files are copied to `certs/` in the install
folder. Before the certificate expires, replace `certs/cert.pem` and `certs/key.pem` and run `gnomon-admin restart`.
Needs port 443 open to wherever people are.

**3. Your own reverse proxy** (`--https proxy`). Gnomon only listens on a port (default `127.0.0.1:8080`); your nginx,
Traefik, HAProxy, F5 or cloud load balancer does HTTPS with your certificate and forwards to it. Use `--bind 0.0.0.0`
(or the machine's address) if the proxy runs elsewhere, and limit who can reach the port with your firewall. The proxy
should:

- forward `Host` and add the client to `X-Forwarded-For` (Gnomon uses the last entry for its rate limits),
- allow request bodies up to 1 GB on `/api/v1/admin/mac-app` (only if you upload the Mac app; 20 MB elsewhere),
- allow at least 60 seconds for requests.

For nginx, for example:

```nginx
server {
  listen 443 ssl;
  server_name gnomon.example.com;
  ssl_certificate     /etc/ssl/gnomon.example.com.pem;
  ssl_certificate_key /etc/ssl/gnomon.example.com.key;
  client_max_body_size 1g;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 60s;
  }
}
```

If the certificate comes from your company's own certificate authority, the setup page's HTTPS check won't trust it
by default. Put the CA certificate next to the compose file, mount it and point `NODE_EXTRA_CA_CERTS` at it (both are
prepared as comments in `compose.yml`), then `gnomon-admin restart`.

**4. Cloudflare Tunnel** (`--https tunnel`). No open ports at all: a `cloudflared` container keeps a connection to
Cloudflare, which does HTTPS. In Cloudflare: Zero Trust → Networks → **Tunnels** → *Create a tunnel* (Cloudflared),
copy its **token** (the long string in the install command it shows), and add a **public hostname**:
`gnomon.example.com` → Service **HTTP** → `gnomon:8080`. Give the token to the install. Note that Cloudflare sees the
traffic in clear text while passing it on, like any proxy that does HTTPS for you.

**5. Local test** (`--https local`): no HTTPS, port 8080 open on the machine. Only for trying things out: phones can't
install the app without HTTPS, and passwords would travel unencrypted.

To switch later, the simplest is a [move](#moving-or-removing-a-server) to a fresh install folder with the other way.

## The setup page

The link from the install opens the setup page. Each step can be skipped and changed later on the [Admin page](#the-admin-page),
except the first one.

| Step | What you do |
|---|---|
| **Welcome** | Shows what the install did: version, HTTPS, where the secret key is kept, backups. And a checklist of what's needed for a roll-out. |
| **Your admin account** | Your name, work email and a password (at least 10 characters). That's how you sign in at `https://gnomon.example.com/admin` from now on, and it's your own Gnomon account for tracking. More admins: invite them later and make them admin under Admin → People. |
| **Your company** | The company name, the **server's address** with an **HTTPS check** (the server opens its own address and must find itself there with a valid certificate), the time zone, the default daily target and language. |
| **Email** | SMTP or Microsoft 365, then *Send a test email*. See [Email](#email). |
| **Who may register** | *Invited only* (right for a company), *With approval*, or *Anyone*; and how long invitations are valid (default 14 days). |
| **The Mac app** | Where people download it: the official GitHub release, or your own upload. See [the Mac app](#handing-out-the-mac-app). |
| **Backups** | Nightly backups (on), at what hour, how many to keep, the backup password. See [Backups](#backups-and-restore). |
| **Float, Personio** (optional) | API tokens, checked and stored encrypted. People are matched by work email. |
| **Rules** (optional) | What the Mac app may do: local API, activity trail, the phone app, hiding personal setup. |
| **Roll-out with Iru** (optional) | The settings profile (`Gnomon.mobileconfig`) for your Mac management, and a checklist. |
| **Invite people** | One person, or a whole list (CSV or pasted). See [Inviting people](#inviting-people). |
| **Done** | A summary. *Finish setup* makes the setup link stop working. |

Later, sign in at `/admin` with your email and password. Forgot it? `gnomon-admin admin-link` prints a one-time link
to the Admin page (60 minutes), where you set a new one under *Admin password* (the menu under your name).

## The Admin page

`https://gnomon.example.com/admin`, for admins only. It opens on the **Overview**: how many people are active,
invited, waiting for approval or disabled; a *Needs attention* list (people waiting for approval, expired
invitations, email not set up, no backup password or a failed backup, a full disk, a new Gnomon version), each with a
button that goes where it's fixed; and the server's health at a glance. The menu on the left is grouped:

| Group | Pages |
|---|---|
| **People** | *People*: everyone, searchable and sortable, filtered by status; a click on a person shows their devices and what you can do (send the invitation again, send a password reset, make admin, disable, remove). *Invitations and approvals*: invite one person or a list, approve or decline people who signed up themselves, and send expired invitations again (all at once, too). *Who may sign up*. |
| **Inbox** | *Feedback* people send from the app. |
| **Company** | *Company details*, *Mac app and roll-out* (where the app comes from, the rules, the settings profile for Iru), *Float and Personio*. |
| **Server** | *Health and updates* (version and how to update, backups, disk, email, HTTPS, recent changes, running the setup again), *Email*, *Backups*. |

Your own admin password, your own account and *Sign out* are in the menu under your name at the top right. Admins
manage accounts here, but **never see anyone's times**: the Admin page has no way to show them.

## Email

Email is for invitations and password resets. Set it up on the setup page or under Admin → Server → Email, then
*Send a test email*: it says plainly what went wrong. The password or client secret is stored encrypted and never
shown again.

**SMTP**, with any provider:

| Provider | Host | Port and security | User and password |
|---|---|---|---|
| Gmail / Google Workspace | `smtp.gmail.com` | 465 TLS or 587 STARTTLS | the address and an [app password](https://myaccount.google.com/apppasswords) (needs 2-step verification) |
| Your company's mail server | from your mail admin | 465 TLS or 587 STARTTLS | usually a mailbox for Gnomon |
| A relay on the same network | its address | 25, *None* | none; only for a relay you trust |

The sender address usually has to be that mailbox or one of its aliases.

**Microsoft 365** sends through Microsoft Graph with an app registration in **Entra**, because Microsoft is retiring
SMTP sign-in with a password:

1. Create a mailbox to send from, for example a shared mailbox `gnomon@example.com` (needs no licence).
2. [Entra admin center](https://entra.microsoft.com) → Applications → **App registrations** → *New registration*: a
   name like *Gnomon mail*, "Accounts in this organizational directory only", no redirect URI.
3. On its Overview, copy the **Directory (tenant) ID** and the **Application (client) ID**.
4. **Certificates & secrets** → *New client secret*: copy its **Value**. Note when it expires and enter a new one in
   Gnomon before then.
5. Allow the app to send **only as that mailbox**, in Exchange Online PowerShell (`Connect-ExchangeOnline`); the
   Object ID is under Entra → *Enterprise applications* → *Gnomon mail*:

   ```powershell
   New-ServicePrincipal -AppId <client-id> -ObjectId <enterprise-app-object-id> -DisplayName "Gnomon mail"
   New-ManagementScope -Name "Gnomon sender" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'gnomon@example.com'"
   New-ManagementRoleAssignment -App <client-id> -Role "Application Mail.Send" -CustomResourceScope "Gnomon sender"
   Test-ServicePrincipalAuthorization -Identity <client-id> -Resource gnomon@example.com
   ```

   Don't also grant *Mail.Send* under the app's API permissions in Entra: that covers every mailbox.
6. In Gnomon: Email → **Microsoft 365**: tenant ID, client ID, client secret, `gnomon@example.com` as the sender. Save,
   then *Send a test email* (changes in Exchange can take a little while).

## Inviting people

On the setup page's last step, or any time under **Admin → Invitations and approvals**:

- **One person:** email, name, member or admin. With email set up they get an email with their link; without, you
  get the link to pass on.
- **From a list:** upload a CSV (Excel: save as *CSV UTF-8*) or paste lines like `Jane Doe; jane.doe@example.com`.
  A preview shows who's new, who already has an account or invitation, duplicates and wrong emails; only the new ones
  are invited. Send by email (10 at a time, keep the page open) or download the links as a CSV to hand out yourself.

Each person opens their link, chooses a password, and signs in with their email on the Mac, phone and web. An admin
never sees anyone's times. Leaving the company: **Disable** the person (signs them out everywhere) or **Remove** them
with their data.

## Handing out the Mac app

People download the app at **`https://gnomon.example.com/latest`** (a short page in English or German with the
version, what's new and how to install), and the app checks there for new versions. On the setup page's *Mac app*
step, choose where it comes from:

- **The official release from GitHub** (default): always the newest version; the download goes straight to GitHub.
- **Upload your own**: for example a build signed with your company's Apple Developer ID. Upload the `.dmg` and its
  version; upload each new version the same way.

The page and the download are public (the app contains no data or secrets). With **Iru** or another Mac management
tool, use the *Roll-out* step instead: add the `.dmg` as a custom app and the settings profile as a custom profile, try
it on one Mac, then assign it to everyone. The profile connects the app to your server, so nobody types the address.

macOS only opens apps from outside the App Store without questions when they're signed with an Apple Developer ID and
notarized. Until the official build is, each person allows it once (right-click → Open); for a company roll-out, use a
signed build.

## Phone and web app

- **Phone:** people open `https://gnomon.example.com` in Safari (or Chrome on Android), sign in with their email and
  password, and add it to the home screen (Share → *Add to Home Screen*). Clocking in, timers and the week are there.
  It needs HTTPS. You can turn it off under Rules.
- **Web:** `https://gnomon.example.com/app` is the Mac app's interface in a browser, for people on Windows or Linux or
  away from their Mac.

## Backups and restore

**Every night** (at 02:00 server time by default) the server backs up everything (times, accounts, settings) into its
data volume, **encrypted**, and keeps the **last 14**. A backup is made before every update too.

**The backup password** was shown once at install. The server keeps only a key that can *encrypt*, not decrypt
(public-key encryption), so someone who gets the backup files can't read them, and **nobody can recover a lost backup
password**, not even the Gnomon project. A backup without its password is lost. Keep it in your password manager, and
somewhere a colleague can find it if you're away. Change it on the setup page or under Admin → Server → Backups (with
the current one) or on the machine with `gnomon-admin backup-password` (without, since that's the machine's owner).
After a change, older backups still need the password they were made with.

**Copy backups off the machine.** Backups in the data volume are lost with the disk. Copy them to your backup system,
for example every night with cron:

```bash
gnomon-admin backup --out /srv/backup/gnomon-$(date +%F).gnomonbak
```

Or download one under Admin → Server → Backups. The files stay encrypted, so any storage will do.

| Command | |
|---|---|
| `gnomon-admin backup` | Make a backup now |
| `gnomon-admin backup --out FILE` | …and copy it to FILE on the machine |
| `gnomon-admin backups` | List the backups on the server |
| `gnomon-admin restore NAME` | Restore one of them (name from `backups`) |
| `gnomon-admin restore FILE` | Restore a `.gnomonbak` file from the machine |

**Restoring** asks for the backup password, stops the server, replaces its data, and starts it again. The data from
before is kept in the volume as `gnomon.db.before-restore-<time>` (encrypted like the database; delete it once all
is well). The restored data is encrypted with the server's own data key: a backup doesn't need the data key, only
its backup password. On a
**new machine**: install as usual, then `gnomon-admin restore FILE`. What's not in a backup: the `.env` file. Without
the old `GNOMON_SECRET_KEY`, the Float and Personio tokens and the email password have to be entered again; everything
else works. So keep a copy of `.env` safe too.

## Encryption at rest

All data in the database (times, entries, workdays, projects, people's names and emails, invitations, feedback) is
encrypted on disk with **SQLCipher (AES-256)**, including the database's write-ahead log and every copy the server
makes. The key is **`GNOMON_DATA_KEY`** in `.env`, outside the database. Someone who gets a copy of the database
file, the Docker volume or a backup can't read it. The server itself still reads the data, so it can show times,
produce working-time records and send password resets: this isn't end-to-end encryption.

**Keep the data key in your password manager.** If it's lost, the data on the server can't be read any more, by
anyone, and the server won't start. The only way back is a backup and its backup password (backups don't depend on
the data key). The install shows the key once; it's also in `.env`.

**Updating a server installed before encryption at rest:** `gnomon-admin update` adds a data key to `.env` and
`compose.yml`, shows it once, and the new version encrypts the data on its first start. Before it does, it makes an
encrypted backup (`backups/gnomon-<time>-pre-encryption.gnomonbak`), or, without a backup password, keeps the
unencrypted database as `gnomon.db.before-encryption-<time>`; `gnomon-admin status` lists such unencrypted copies
until you delete them. If encrypting fails, the data stays as it was and unencrypted, and the log says why. With a
compose file of your own (like the Raspberry Pi example below), add the key yourself:

```bash
echo "GNOMON_DATA_KEY=$(head -c 64 /dev/urandom | base64 | tr -d '\n/+=' | head -c 48)" >> .env
# in compose.yml, under the gnomon service's environment:  GNOMON_DATA_KEY: ${GNOMON_DATA_KEY}
docker compose up -d
```

| | |
|---|---|
| `gnomon-admin status` | `Data: encrypted at rest`, or a warning when it isn't, and any unencrypted copies left |
| `gnomon-admin rotate-data-key` | Back up, stop, re-encrypt all data with a new key (written to `.env` and shown once), start |
| `GNOMON_DATA_KEY_FILE` | Instead of `GNOMON_DATA_KEY`: read the key from a file, such as a Docker secret |

A wrong or missing key stops the server with the reason in `gnomon-admin logs`; it never starts with an empty
database. The Admin page reads the same status from `GET /api/v1/admin/encryption`.

**What it protects, and what not.** It protects a copied database file, a leaked backup, a copied volume or VM image,
and a disk thrown away without `.env`. It doesn't protect against someone with root on the running machine, and a
stolen disk that also holds `.env` holds the key too. So keep **disk encryption** on as well (below), or keep the key
off the disk with `GNOMON_DATA_KEY_FILE` on a separate secret mount. Encryption at rest is what Article 34(3)(a) of the
GDPR asks for so that a breach of unreadable data needn't be told to every person, as long as the key wasn't part of
it; your data protection officer makes that call. Data written before encryption can remain in the disk's free space,
and so can copies made before (for example plain `.db` backups you made by hand): delete those.

## Updates

```bash
gnomon-admin update            # the newest version
gnomon-admin update 0.1.19     # a specific one
```

It makes a backup, downloads the new image, restarts, and checks that the server is healthy. Your data and settings
stay. What's new is in [CHANGELOG.md](../CHANGELOG.md). With `--build` installs, it gets that version's code and
builds it. To go back: `gnomon-admin update <older version>`, and if the data changed in a way the older version
doesn't understand, `gnomon-admin restore` the backup made before the update. Versions from before
[encryption at rest](#encryption-at-rest) can't open encrypted data: going back to one needs that restore too.

Caddy and cloudflared are updated with `docker compose pull && docker compose up -d` in the install folder. Keep the
machine itself updated as usual.

## Security and privacy

**Where the data is:** only on your server, in the Docker volume `gnomon_gnomon-data` (the SQLite database and the
backups). Nothing is sent to the Gnomon project or anyone else. The server only contacts: your mail provider, Float and
Personio if you connect them, and GitHub (only for the Mac app's version and download, if you use the official
release).

**What's encrypted:**

| | |
|---|---|
| In transit | Everything, by HTTPS (Caddy, your proxy or Cloudflare). |
| Passwords | Never stored, only as salted scrypt hashes. After 5 wrong tries from one address, signing in pauses for 15 minutes. |
| Device keys and session tokens | Only as SHA-256 hashes. |
| Float and Personio tokens, the email password | AES-256-GCM, with `GNOMON_SECRET_KEY` from `.env`. |
| Backups | Encrypted for the backup password (X25519 and AES-256-GCM). |
| Times, entries, people and everything else in the database | SQLCipher (AES-256), with `GNOMON_DATA_KEY` from `.env`, including the write-ahead log. See [Encryption at rest](#encryption-at-rest). |

**Recommended on the machine:**

- **Disk encryption** (LUKS on Linux, or your cloud provider's encrypted volumes), so a stolen disk or a discarded VM
  image doesn't give away the data key in `.env` along with the database.
- Keep **`.env`** (the secret key and the data key) readable only by root: the install sets it to `600`. Keep a copy in your password
  manager or vault. Anyone with root on the machine can read everything, as with any server: give root access to few.
- Keep the **backup password** away from the server (a password manager, a vault).
- Only expose what's needed: with Caddy ports 80 and 443; with your own proxy, the port only to the proxy; with a
  tunnel nothing.
- The container runs as an unprivileged user, with a read-only file system, no capabilities and
  `no-new-privileges`; only the data volume is writable.

**People's privacy:** each person sees only their own times; admins manage accounts but don't see anyone's times. The
activity trail (if allowed) never leaves the Mac. In Germany, introducing time tracking usually involves the works
council and data protection: plan for that before rolling out.

## Troubleshooting

Start with `gnomon-admin status` (containers, version, HTTPS, backups, disk) and `gnomon-admin logs`.

| Problem | What to check |
|---|---|
| The setup link says it expired or was used | `gnomon-admin setup-link` for a new one. After *Finish setup*, sign in at `/admin` instead. |
| The HTTPS check fails: *isn't found in DNS* | The DNS record for the host name, and that it has spread (`dig gnomon.example.com`). |
| *Nothing answers* / timeout | Caddy: ports 80 and 443 open in the firewall and at the cloud provider? Proxy: does it forward to the right port? Tunnel: is the public hostname `gnomon:8080`? Some networks can't reach their own public address from inside; if a browser shows the page with a padlock, it's fine. |
| *The certificate isn't valid* | Caddy: `docker compose logs caddy` (Let's Encrypt needs port 80). Own certificate: does it include the full chain and the right name? Company CA: see `NODE_EXTRA_CA_CERTS` above. |
| *Answers, but not as this Gnomon server* | The proxy or tunnel forwards to something else, or caches. |
| Emails don't arrive | *Send a test email* says why. Check the spam folder, and that the sender address belongs to the mailbox. |
| A backup failed | `gnomon-admin status` shows the error. Usually the disk is full (`df -h`). |
| Forgot the admin password | `gnomon-admin admin-link`, then set a new one under *Admin password*. |
| Lost the backup password | Existing backups can't be restored. Set a new one now (`gnomon-admin backup-password`) so new backups can be, and make one: `gnomon-admin backup`. |
| *Gnomon can't start: The database is encrypted, but GNOMON_DATA_KEY isn't set* | `.env` or `compose.yml` lost the key (see [Encryption at rest](#encryption-at-rest)). Put it back from your password manager, then `gnomon-admin restart`. |
| *GNOMON_DATA_KEY doesn't open this database* | It's not the key the data was encrypted with. Use the one from your password manager. Without it, install anew and `gnomon-admin restore` a backup. |
| `status` lists *unencrypted copies to delete* | Copies from before encryption or a plain backup, in the data volume. Once all is well: `docker compose exec gnomon rm /data/<name>`. |
| The server won't start after an update | `gnomon-admin logs`; go back with `gnomon-admin update <previous version>`. |

## Moving or removing a server

**Moving** to another machine:

1. On the new machine, install with the same host name (`--no-start` lets you prepare it before switching DNS).
2. On the old one: `gnomon-admin backup --out gnomon.gnomonbak`, and copy that file and the old `.env`'s
   `GNOMON_SECRET_KEY` line to the new machine. The data key isn't needed: the new machine encrypts with its own.
3. On the new one: put the old `GNOMON_SECRET_KEY` into its `.env` (so the stored tokens keep working),
   `gnomon-admin restart`, then `gnomon-admin restore gnomon.gnomonbak` with the backup password.
4. Point the host name at the new machine. Macs and phones keep working, since the address stays the same.

**Removing** a server and all its data, in the install folder (this can't be undone; make and copy a backup first if
you might need it):

```bash
cd /opt/gnomon && docker compose down --volumes && cd / && rm -rf /opt/gnomon /usr/local/bin/gnomon-admin
```

## Example: a Raspberry Pi with a Cloudflare Tunnel

A Raspberry Pi 4 or 5 (64-bit Raspberry Pi OS) at home or in a small office, reachable without opening any ports:

1. Install Docker: `curl -fsSL https://get.docker.com | sh`, then `sudo usermod -aG docker $USER` and log in again.
2. In Cloudflare, create a tunnel and copy its token; add the public hostname `gnomon.example.com` → HTTP →
   `gnomon:8080`.
3. Install: `sudo sh install.sh --https tunnel --domain gnomon.example.com --tunnel-token <token>`.
4. Open the setup link it prints. The Pi uses the same arm64 image as any other machine; updates are
   `gnomon-admin update`.

A Pi's SD card wears out and fails more often than an SSD: boot from an SSD if you can, and copy the backups off the
Pi (see [Backups](#backups-and-restore)).
