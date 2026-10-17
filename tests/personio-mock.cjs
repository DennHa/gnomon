// A local stand-in for the Personio API v2, following the documented shapes (developer.personio.de):
// POST /v2/auth/token, GET /v2/persons, /v2/absence-types, /v2/absence-periods (+ /{id}/breakdowns),
// cursor pagination via _meta.links.next. Fake data only, dated relative to today.
//
//   node tests/personio-mock.cjs            # listens on 127.0.0.1:7811
//   PERSONIO_API_BASE=http://127.0.0.1:7811 npm start
// Credentials: client ID "demo-id", secret "demo-secret"; person: alex@example.com.
// MOCK_429=1 answers the first absence-periods request with 429 (tests the back-off).
const http = require('http');

const PORT = Number(process.env.PORT) || 7811;
const base = `http://127.0.0.1:${PORT}`;
const TOKEN = 'papi-mock-token';
let throttled = !process.env.MOCK_429;

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** The next Monday at least `weeks` weeks away. */
const monday = (weeks) => {
  const d = new Date();
  return day(weeks * 7 + ((8 - d.getDay()) % 7 || 7));
};
const plus = (date, n) => {
  const d = new Date(`${date}T12:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const persons = [
  { id: '1001', email: 'alex@example.com', first_name: 'Alex', last_name: 'Example', preferred_name: null, status: 'ACTIVE' },
  { id: '1002', email: 'sam@example.com', first_name: 'Sam', last_name: 'Sample', preferred_name: null, status: 'ACTIVE' },
];
const types = [
  { id: 'at-vac', name: 'Vacation', category: 'PAID_VACATION', unit: 'DAY' },
  { id: 'at-sick', name: 'Sick leave', category: 'SICK_LEAVE', unit: 'DAY' },
  { id: 'at-doc', name: 'Doctor’s appointment', category: 'OTHER', unit: 'HOUR' },
];
const vac = monday(2);
const period = (id, person, type, from, to, extra = {}) => ({
  id,
  person: { id: person },
  starts_from: { date_time: `${from}T00:00:00`, type: null },
  ends_at: to ? { date_time: `${to}T00:00:00`, type: null } : null,
  timezone_id: 'Europe/Berlin',
  comment: null,
  absence_type: { id: type },
  approval: { status: 'APPROVED' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...extra,
});
const periods = [
  // A week of vacation (Mon–Fri; the end is the following Saturday 00:00, exclusive).
  period('ap-1', '1001', 'at-vac', vac, plus(vac, 5)),
  // A sick day last week.
  period('ap-2', '1001', 'at-sick', plus(monday(-1), -5), plus(monday(-1), -4)),
  // A half day (afternoon off) and an hourly appointment: skipped by Gnomon.
  period('ap-3', '1001', 'at-vac', plus(vac, 9), plus(vac, 10), { starts_from: { date_time: `${plus(vac, 9)}T00:00:00`, type: 'SECOND_HALF' } }),
  period('ap-4', '1001', 'at-doc', plus(vac, 15), null, { starts_from: { date_time: `${plus(vac, 15)}T09:00:00`, type: null }, ends_at: { date_time: `${plus(vac, 15)}T11:00:00`, type: null } }),
  // Pending: not imported yet.
  period('ap-5', '1001', 'at-vac', monday(6), plus(monday(6), 3), { approval: { status: 'PENDING' } }),
  // Someone else's.
  period('ap-6', '1002', 'at-vac', monday(1), plus(monday(1), 5)),
];

function breakdowns(p) {
  const out = [];
  const first = p.starts_from.date_time.slice(0, 10);
  let last = p.ends_at.date_time.slice(0, 10);
  if (last > first && p.ends_at.date_time.endsWith('T00:00:00')) last = plus(last, -1);
  for (let d = first; d <= last; d = plus(d, 1)) {
    const weekend = [0, 6].includes(new Date(`${d}T12:00`).getDay());
    const unit = types.find((t) => t.id === p.absence_type.id).unit;
    const value = weekend ? 0 : unit === 'HOUR' ? 120 : p.starts_from.type && d === first ? 0.5 : 1;
    out.push({ date: d, effective_duration: { value, unit: unit === 'HOUR' ? 'MINUTE' : 'DAY' } });
  }
  return out;
}

/** Cursor = offset as a string, like an opaque cursor to the client. */
function page(res, url, items, maxLimit) {
  const limit = Math.min(maxLimit, Math.max(1, Number(url.searchParams.get('limit')) || maxLimit));
  const offset = Number(url.searchParams.get('cursor') || 0);
  const next = offset + limit < items.length ? new URL(url.href) : null;
  if (next) next.searchParams.set('cursor', String(offset + limit));
  json(res, 200, { _data: items.slice(offset, offset + limit), _meta: { links: { self: { href: url.href }, ...(next && { next: { href: next.href } }) } } });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, base);
    console.log(req.method, url.pathname + url.search);
    if (req.method === 'POST' && url.pathname === '/v2/auth/token') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (!String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')) return json(res, 400, { error: 'invalid_request' });
        const f = new URLSearchParams(raw);
        if (f.get('grant_type') !== 'client_credentials') return json(res, 400, { error: 'unsupported_grant_type' });
        if (f.get('client_id') !== 'demo-id' || f.get('client_secret') !== 'demo-secret') return json(res, 400, { error: 'unauthorized_client', error_description: 'The credentials were not correct' });
        json(res, 200, { access_token: TOKEN, token_type: 'Bearer', expires_in: 86400, scope: 'personio:persons:read personio:absences:read' });
      });
      return;
    }
    if (req.method !== 'GET') return json(res, 405, {});
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { errors: [{ title: 'Unauthorized', detail: 'Invalid token' }] });

    if (url.pathname === '/v2/persons') {
      const emails = (url.searchParams.get('email') || '').toLowerCase().split(',').filter(Boolean);
      return page(res, url, persons.filter((p) => !emails.length || emails.includes(p.email)), 50);
    }
    if (url.pathname === '/v2/absence-types') return page(res, url, types, 100);
    if (url.pathname === '/v2/absence-periods') {
      if (!throttled) {
        throttled = true;
        return json(res, 429, { errors: [{ title: 'Too Many Requests' }] });
      }
      const ids = (url.searchParams.get('person.id') || '').split(',').filter(Boolean);
      const lte = url.searchParams.get('starts_from.date_time.lte');
      const gte = url.searchParams.get('ends_at.date_time.gte');
      // Overlap: starts before the window ends and ends (or is ongoing) after it starts.
      const list = periods.filter((p) => (!ids.length || ids.includes(p.person.id)) && (!lte || p.starts_from.date_time <= lte) && (!gte || !p.ends_at || p.ends_at.date_time >= gte));
      return page(res, url, list, 2); // tiny pages, so pagination gets exercised
    }
    const m = /^\/v2\/absence-periods\/([^/]+)\/breakdowns$/.exec(url.pathname);
    if (m) {
      const p = periods.find((x) => x.id === m[1]);
      if (!p) return json(res, 404, { errors: [{ title: 'Not found' }] });
      return page(res, url, breakdowns(p), 28);
    }
    json(res, 404, { errors: [{ title: 'Not found' }] });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Personio mock on ${base}`));
