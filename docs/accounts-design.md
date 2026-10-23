# People, accounts and company sign-in: design

> **Status: for review, nothing built yet.** The big picture is in [company-setup.md](company-setup.md); this is the
> concrete plan for the server: data model, routes, what happens to existing data, and the order to build it in.
> Decisions that need an answer are marked **Decide**.

## Why

Today a Gnomon server holds **one** person's data: every device paired to it sees and changes the same entries and
workdays. That's right for one person with a Mac and a phone, and wrong for a team. And Float and Personio can only be
used safely when the server knows *who* is asking, so it hands each person their own plan and absences and nothing
else.

## The goal in one paragraph

A server has **people**. Each person has their own time data and their own devices, and a role: **member** or
**admin**. People are invited by email; later they sign in with the company login (Microsoft, Google, Okta…). The
Float token and Personio credentials stay on the server, encrypted, and are never sent to a device. When a Mac asks
for "my plan" or "my absences", the server looks up that person in Float and Personio by work email and returns
only theirs.

## 1. Data model

New tables (SQLite, next to the existing ones):

| Table | Columns | Notes |
|---|---|---|
| `people` | id, email (unique, lowercase), name, role (`admin` / `member`), status (`invited` / `active` / `disabled`), float_person_id, personio_person_id, created_at, last_seen_at | The account. |
| `devices` | + person_id | Every device belongs to a person. Revoking a person revokes their devices. |
| `records` | + person_id, primary key becomes (person_id, kind, id) | Each person's entries, workdays, projects, activities. |
| `meta` | per-person keys become `person:<id>:<key>` | Sync cursor and the like. |
| `invites` | code_hash, person_id, expires_at | One-time invitation codes (replaces today's anonymous pairing codes for teams). |

The admin password moves from `meta` to the admin's person record (a person may have a password; members usually
won't need one). Feedback stays server-wide, with an optional person_id when the sender is signed in.

**Projects and activities:** per person at first, exactly like today. Shared company projects (from Float, or set by
the admin) come later as a separate, read-only list that every person's projects can link to. *(Decided.)*

## 2. Who is asking

Every request already carries a device key. The key now resolves to a **device → person**, and every data route
works on that person's data only. The routes stay the same (`/entries`, `/workdays`, `/sync`, …), so the Mac app and
the phone app keep working unchanged; they just see their own person's data.

Admin routes check the person's role instead of today's separate admin flag on the device.

## 3. Getting people in

**Step A, invitations (no company login needed):**

1. Admin → People → *Invite*: enter email and name. The server creates the person (`invited`) and a one-time code,
   shown as a link and QR code, valid 7 days.
2. The person opens the link on their Mac (or types the code in Gnomon → Settings → Connections). The Mac becomes their
   first device; the person becomes `active`.
3. From the Mac they can add their phone (QR code), as today; the phone joins the same person.

**Step B, company login (OpenID Connect):**

1. Admin → Settings → Sign-in: enter the issuer and client ID of the company's identity provider (Microsoft Entra ID,
   Google, Okta, Keycloak…). The settings profile already has `signIn: 'oidc'`, `signInIssuer`, `signInClientId`.
2. On the Mac, *Sign in* opens the system browser at the identity provider (authorization code flow with PKCE, a
   loopback redirect to the app). The provider confirms the email; the app sends the result to the server.
3. The server checks the token's signature against the provider's published keys, and the email against `people`.
   Only invited people can sign in; nobody gets an account just for having a company address. *(Decided.)*
4. The Mac gets its device key as today. No password for employees, and leaving the company (disabled in the identity
   provider) stops new sign-ins; the admin disables the person in Gnomon to stop existing devices.

## 3b. The account is the centre: passwords, email and the web

The account, not a particular Mac, is what everything hangs on: a person's data lives in their account on the server,
and the Mac, the phone and a browser are ways in. The Mac keeps what only it can do (menu bar, shortcuts, working
offline, the activity trail), but signing in no longer depends on it.

- **Email server (Settings → Email):** host, port, user, password (stored encrypted like the Float and Personio
  tokens), sender address, and *Send a test email*. Used for invitations and password resets. Without it, invitations
  are shown as links and QR codes to pass on by hand, as today.
- **Passwords for members:** when the company has no single sign-on, a person sets a password from their invitation.
  Only a salted scrypt hash is stored, wrong tries lock for a while (as for the admin today).
- **Password reset:** *Forgot your password?* sends a link valid once for 30 minutes to the account's email. The
  answer is the same whether the email exists or not, so nobody can probe for accounts.
- **Web app:** the Mac app's interface in the browser (the web demo already runs it on made-up data), signed in with
  email and password or the company login, reading and writing the account's data on the server. Sessions are
  cookies scoped to the server, with a sign-out on every device from the account page.
- With company login (OIDC), passwords and resets are the identity provider's job; the email server is then only
  needed for invitations.

## 4. Float and Personio, per person

- The tokens are entered once in the admin's Settings (that part exists) and live only on the server, encrypted.
- Matching: when a person becomes active, the server looks them up by email: Float `/people` (email field), Personio
  `/persons` (email attribute). The match is stored on the person; the admin can correct it under People.
- New routes for the apps: `GET /me/plan?from&to` (Float allocations for this person), `GET /me/absences?from&to`
  (Personio absences for this person), `GET /me/holidays`. The server calls Float or Personio with the company token,
  **always filtered to the stored person id**, and returns only that.
- The Mac app, when connected to such a server, takes its plan and absences from these routes and hides its own
  Float and Personio connection (managed mode already does this). The per-Mac tokens stay possible for people
  without a company server.
- Caching: the server keeps each person's plan and absences for a few minutes, so many Macs don't hit Float or
  Personio limits.
- Audit: the server logs which person's data it fetched, not the data itself.

What a person can **never** get: another person's data, the tokens, or a list of everyone in Float or Personio. The
filter is applied on the server before anything leaves it; the apps can't widen it.

## 5. What happens to your existing server

Your server today has one dataset and several devices. Migration, once, on start:

1. Create a person for the owner, role `admin`. Their email is asked once on the Admin page after the update.
2. Give every existing record and device to that person.
3. Old anonymous pairing codes keep working for that person until they expire.

Nothing changes for you except a new "People" page with one entry: you.

## 6. Admin area

Manage: **People** (new), Devices (grouped by person), Feedback, My account. Settings: Company, **Sign-in** (new),
Float, Personio, Rules, Rollout, Overview.

People shows per person: name, email, role, status, matched in Float / Personio (✓ or "not found"), devices, last
seen; actions: invite again, change role, disable, remove (with their data, after a confirmation that names it).

## 7. Order of building

1. **People and per-person data** (sections 1, 2, 5): the biggest change; the apps keep working unchanged. Tests:
   two people never see each other's entries, through every route and the sync. *(Built.)*
2. **Invitations** (section 3A) and the People page.
3. **Email server, member passwords and password reset** (section 3b).
4. **Web app with sign-in** (section 3b).
5. **Float and Personio per person** (section 4).
6. **Company login** (section 3B).

Each step ships on its own, with a backup and a migration test on a copy of a real database before it reaches a
server.

## Decisions

1. **Projects:** per person first; shared company projects later, read-only. *(Decided.)*
2. **Company login:** only invited people; no automatic accounts for the company domain. *(Decided.)*
3. **Admins and times:** admins manage accounts and connections, and never see anyone's entries. Team reports come
   later as an opt-in with consent (in Germany usually with the works council). *(Decided.)*
4. **The owner's email:** asked once on the Admin page after the update. *(Decided.)*
