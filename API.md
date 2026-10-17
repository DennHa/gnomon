# Gnomon API (v1)

A small local REST API so another system can read your times and push entries in, for example your company's
time-recording system. The Gnomon app must be running; the API is answered by the same logic as the UI, so
anything you send appears in the app immediately.

## Turning it on

Settings → **API**:

1. **Enable the local API.** It listens on `http://127.0.0.1:7799/api/v1` (port configurable).
2. **Create API key.** It's shown **once**; copy it into the other system. Gnomon stores it encrypted in the keychain.
   "Create new key" invalidates the old one.
3. Optional: **Allow other devices on my network.** Gnomon then listens on all interfaces instead of only your Mac.
   Anyone on that network who has the key can read and change your times, so enable it only on a trusted network.

## Basics

- **Base URL:** `http://127.0.0.1:7799/api/v1`
- **Auth:** every request needs `Authorization: Bearer <key>` (otherwise `401`).
- **Format:** JSON. Requests with a body need `Content-Type: application/json` (otherwise `415`). Max body size is 1 MB.
- **Dates** are `YYYY-MM-DD`. **Times** are ISO 8601 (`2026-10-16T09:30:00+02:00`) and come back in UTC (`…Z`).
  "Which day" is always your Mac's local day.
- **Ids:** Gnomon ids are UUIDs. Anywhere an `:id` is expected you can also use `ext:<externalId>`, the id from
  *your* system.
- **Idempotent sync:** send `externalId` with projects and entries. Sending the same `externalId` again
  **updates** the record instead of creating a duplicate, so a sync job can push the same data repeatedly.

### Errors

Errors have a status code and a JSON body:

```json
{ "error": "invalid", "message": "minutes must be a number between 1 and 1440 when you send date" }
```

| Status | `error` | Meaning |
|---|---|---|
| 400 | `invalid_json` | The body isn't valid JSON |
| 401 | `unauthorized` | Missing or wrong API key |
| 404 | `not_found` | Unknown route, project or entry |
| 415 | `unsupported_media_type` | The body isn't sent as JSON |
| 422 | `invalid` | A field is missing or has the wrong format (the message says which) |
| 503 | `not_ready` | Gnomon is still starting; retry |
| 504 | `timeout` | Gnomon didn't answer within 5 seconds |

## Objects

**Project**

```json
{ "id": "19aa9e2e-…", "name": "Client XYZ", "color": "#8E44AD", "dailyGoalHours": 4.5,
  "client": "XYZ GmbH", "externalId": "crm-42", "floatId": 900 }
```

**Entry** (`minutes` is computed; `running` is true for the live timer)

```json
{ "id": "0db8272e-…", "externalId": "time-1", "date": "2026-10-15",
  "start": "2026-10-15T07:00:00.000Z", "end": "2026-10-15T08:30:00.000Z", "running": false, "minutes": 90,
  "description": "Landing page", "projectId": "19aa9e2e-…", "project": "Client XYZ",
  "activityId": "a1", "activity": "Design", "task": "Landing page design", "billable": true }
```

**Workday** (attendance: when you arrived and left)

```json
{ "date": "2026-10-14", "off": false, "offReason": null, "in": "2026-10-14T06:00:00.000Z",
  "out": "2026-10-14T14:30:00.000Z", "breakMinutes": 30, "workedMinutes": 480 }
```

## Endpoints

| Method & path | What it does |
|---|---|
| `GET /health` | Check that Gnomon is reachable and the key works |
| `GET /projects` | All projects |
| `GET /projects/:id` | One project (`:id` or `ext:<externalId>`) |
| `POST /projects` | Create a project, or update it if `externalId` or the same name already exists |
| `PATCH /projects/:id` | Change `name`, `color`, `dailyGoalHours`, `externalId` |
| `GET /activities` | Activities (Call, Design, …) with ids |
| `GET /entries?from=&to=&projectId=` | Entries whose start falls in the range (default: today) |
| `GET /entries/:id` | One entry |
| `POST /entries` | Create an entry, or update it when `externalId` already exists |
| `PATCH /entries/:id` | Change only the fields you send |
| `DELETE /entries/:id` | Delete an entry |
| `GET /workdays?from=&to=` | Attendance per day |
| `PUT /workdays/:date` | Set a day's in/out/break, or mark it as a day off |
| `DELETE /workdays/:date` | Remove a day's attendance |
| `GET /timer` | The running entry, or `null` |
| `POST /timer/start` | Start a timer (stops a running one) |
| `POST /timer/stop` | Stop the running timer |
| `POST /day/start`, `POST /day/leave` | Clock in / clock out (today) |
| `GET /summary?from=&to=` | Totals: tracked and worked minutes, per project and per day |

Ranges can span at most 400 days; `to` defaults to `from`.

### `POST /entries`

Send **either** exact times **or** a day plus a duration:

| Field | |
|---|---|
| `start`, `end` | ISO date-times. At most 24 h, and `end` after `start`. |
| `date`, `minutes` | The day and 1–1440 minutes. Gnomon places the entry after that day's last entry (or at 09:00). |
| `description` | Text, optional |
| `projectId` / `projectExternalId` / `project` | Pick the project by Gnomon id, by your id, or by name. A **new name creates the project**. |
| `activityId` / `activity` | By id or by name (must exist) |
| `billable` | `true` / `false` |
| `externalId` | Your id; repeating it updates this entry |

### `PUT /workdays/:date`

```json
{ "in": "08:00", "out": "16:30", "breakMinutes": 30 }
{ "off": true, "reason": "Vacation" }
{ "off": true, "kind": "overtime" }
```

Leaving out `out` means you're still at work. `"kind": "overtime"` marks time off in lieu: the daily target still counts, so it reduces the overtime balance. Replaces whatever that day had.

## Examples

```bash
KEY="<your API key from Settings>"
API=http://127.0.0.1:7799/api/v1

# Is it up?
curl -s -H "Authorization: Bearer $KEY" $API/health

# Create (or update) a project that your system knows as crm-42
curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Client XYZ","externalId":"crm-42","dailyGoalHours":4.5}' $API/projects

# Push 90 minutes on 15 Oct; sending it again with the same externalId updates it
curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"date":"2026-10-15","minutes":90,"projectExternalId":"crm-42","description":"Workshop","activity":"Call","externalId":"time-1"}' \
  $API/entries

# Read the week back out
curl -s -H "Authorization: Bearer $KEY" "$API/entries?from=2026-10-12&to=2026-10-18"
curl -s -H "Authorization: Bearer $KEY" "$API/summary?from=2026-10-12&to=2026-10-18"

# Fix the description later, using your own id
curl -s -X PATCH -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"description":"Workshop with client"}' $API/entries/ext:time-1
```

A typical sync job for a company system:

1. `POST /projects` for each project with your `externalId` (safe to repeat).
2. Either push bookings with `POST /entries` + `externalId`, or pull with `GET /entries?from=…&to=…` / `GET /summary`.
3. Delete with `DELETE /entries/ext:<id>` when a booking is removed on your side.

## Limits & notes

- The API only works while Gnomon is running on your Mac (it's part of the app, not a cloud service).
- There's no web-browser access (no CORS), only programs that can send the key.
- Float-imported plans and the activity trail aren't exposed through the API.
