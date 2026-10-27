// Votes, comments and ideas on the roadmap (roadmap.ts): only signed-in people, one vote each, ideas visible to others
// only once an admin approved them, never who voted, and the admin's export for the product owner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { parseRoadmap } from '../../src/roadmap';
import { createApp } from '../src/app';
import { Company } from '../src/company';
import { renderRoadmap } from '../roadmap/render.mjs';
import { Store } from '../src/store';
import { VERSION } from '../src/version';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-roadmap-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const MD = `<!--
How ids work, over more than one line.
-->
# Roadmap

## Now

Nothing in progress right now.

## Next

- **A drafted day.** Suggest the day from the calendar,
  on the Mac only.
- **Close a month.** Lock a month. <!-- id: month-close -->

## Later

- **Company login (OIDC).** Microsoft, Google or Okta.

## What Gnomon does today

- **Private by design.** Data on your Mac.

## Left out on purpose

- **Invoicing.** Not for billing.
`;

async function server() {
  const dir = fs.mkdtempSync(path.join(tmp, 'server-'));
  fs.mkdirSync(path.join(dir, 'roadmap'));
  fs.writeFileSync(path.join(dir, 'roadmap/ROADMAP.md'), MD);
  const store = new Store(path.join(dir, 'gnomon.db'));
  const company = new Company(store, Buffer.alloc(32, 7), 'env');
  const srv = http.createServer(createApp({ store, company, roadmapDir: path.join(dir, 'roadmap') }));
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const go = async (method: string, p: string, body?: unknown, auth?: string) => {
    const r = await fetch(`${url}/api/v1${p}`, {
      method,
      headers: { ...(auth && { Authorization: `Bearer ${auth}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const person = (name: string) => {
    const p = store.addPerson({ email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`, name, status: 'active' });
    return store.addDevice('Mac', 'mac', p.id).key;
  };
  const admin = (await go('POST', '/admin/session', { code: store.createAdminCode('admin', 60) })).body.token as string;
  return { store, go, person, admin, close: async () => (await new Promise((r) => srv.close(r)), store.close()) };
}

describe('the roadmap as data', () => {
  test('ids come from the title, or the explicit id; comments never show on the public page', () => {
    const s = parseRoadmap(MD);
    assert.deepEqual(
      s.map((x) => x.key),
      ['now', 'next', 'later', 'done', 'out'],
    );
    assert.equal(s[0].intro, 'Nothing in progress right now.');
    assert.deepEqual(s[1].items, [
      { id: 'a-drafted-day', title: 'A drafted day', text: 'Suggest the day from the calendar, on the Mac only.' },
      { id: 'month-close', title: 'Close a month', text: 'Lock a month.' },
    ]);
    assert.equal(s[2].items[0].id, 'company-login-oidc');
    const html = renderRoadmap(MD).html;
    assert.ok(!html.includes('id:') && !html.includes('&lt;!--'), html);
    assert.equal((html.match(/<ul>/g) ?? []).length, 4); // one list per section, not split by the comment
  });

  test('the real docs/ROADMAP.md has unique ids for every item', () => {
    const md = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../../docs/ROADMAP.md'), 'utf8');
    const ids = parseRoadmap(md).flatMap((s) => s.items.map((it) => it.id));
    assert.ok(ids.length > 10);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('roadmap votes, comments and ideas', () => {
  test('only signed-in people take part', async () => {
    const x = await server();
    try {
      assert.equal((await x.go('GET', '/roadmap/board')).status, 401);
      assert.equal((await x.go('PUT', '/roadmap/votes/a-drafted-day', { on: true })).status, 401);
      assert.equal((await x.go('POST', '/roadmap/suggestions', { title: 'x' })).status, 401);
      assert.equal((await x.go('POST', '/roadmap/comments', { target: 'a-drafted-day', text: 'x' }, 'gnomon_wrong')).status, 401);
      assert.equal((await x.go('GET', '/admin/roadmap/export')).status, 401);
      // A member's device key isn't an admin session.
      assert.equal((await x.go('GET', '/admin/roadmap', undefined, x.person('Anna Example'))).status, 401);
    } finally {
      await x.close();
    }
  });

  test('one vote per person, which they can take back; nobody sees who voted', async () => {
    const x = await server();
    try {
      const anna = x.person('Anna Example');
      const ben = x.person('Ben Example');
      await x.go('PUT', '/roadmap/votes/a-drafted-day', { on: true }, anna);
      await x.go('PUT', '/roadmap/votes/a-drafted-day', { on: true }, anna); // twice is still one
      const b = (await x.go('PUT', '/roadmap/votes/a-drafted-day', { on: true }, ben)).body;
      const item = b.sections[1].items[0];
      assert.equal(item.votes, 2);
      assert.equal(item.voted, true);
      assert.equal((await x.go('PUT', '/roadmap/votes/a-drafted-day', { on: false }, anna)).body.sections[1].items[0].votes, 1);
      const forAnna = (await x.go('GET', '/roadmap/board', undefined, anna)).body;
      assert.equal(forAnna.sections[1].items[0].voted, false);
      // Only Now, Next, Later and approved ideas take votes.
      assert.equal((await x.go('PUT', '/roadmap/votes/private-by-design', { on: true }, anna)).status, 404);
      assert.equal((await x.go('PUT', '/roadmap/votes/no-such-thing', { on: true }, anna)).status, 404);
      // No ids, emails or names of voters anywhere in what people or the admin get.
      const all = JSON.stringify([forAnna, (await x.go('GET', '/admin/roadmap', undefined, x.admin)).body]);
      for (const leak of ['example.com', 'Ben', 'personId', 'person_id', ...x.store.listPeople().map((p) => p.id)]) assert.ok(!all.includes(leak), leak);
    } finally {
      await x.close();
    }
  });

  test('comments show a first name or "Someone", and only the writer can remove their own', async () => {
    const x = await server();
    try {
      const anna = x.person('Anna Example');
      const ben = x.person('Ben Example');
      await x.go('POST', '/roadmap/comments', { target: 'a-drafted-day', text: 'Would save me time.' }, anna);
      const b = (await x.go('POST', '/roadmap/comments', { target: 'a-drafted-day', text: 'Only on the Mac.', anonymous: true }, ben)).body;
      const cs = b.sections[1].items[0].comments;
      assert.deepEqual(
        cs.map((c: any) => [c.name, c.text, c.mine]),
        [
          ['Anna', 'Would save me time.', false],
          ['', 'Only on the Mac.', true],
        ],
      );
      assert.equal((await x.go('DELETE', `/roadmap/comments/${cs[0].id}`, undefined, ben)).status, 404);
      assert.equal((await x.go('DELETE', `/roadmap/comments/${cs[1].id}`, undefined, ben)).body.sections[1].items[0].comments.length, 1);
      assert.equal((await x.go('POST', '/roadmap/comments', { target: 'a-drafted-day', text: '' }, ben)).status, 422);
      // The admin can remove any comment.
      const v = (await x.go('DELETE', `/admin/roadmap/comments/${cs[0].id}`, undefined, x.admin)).body;
      assert.equal(v.sections[1].items[0].comments.length, 0);
    } finally {
      await x.close();
    }
  });

  test('an idea is only seen by others once the admin approved it', async () => {
    const x = await server();
    try {
      const anna = x.person('Anna Example');
      const ben = x.person('Ben Example');
      const mine = (await x.go('POST', '/roadmap/suggestions', { title: 'Export to a spreadsheet', text: 'For the monthly report.' }, anna)).body.suggestions;
      assert.deepEqual(
        mine.map((s: any) => [s.title, s.status, s.mine]),
        [['Export to a spreadsheet', 'waiting', true]],
      );
      assert.equal((await x.go('GET', '/roadmap/board', undefined, ben)).body.suggestions.length, 0);
      assert.equal((await x.go('PUT', `/roadmap/votes/${mine[0].id}`, { on: true }, ben)).status, 404);
      assert.equal((await x.go('POST', '/roadmap/suggestions', { title: '' }, anna)).status, 422);

      const overview = (await x.go('GET', '/admin/overview', undefined, x.admin)).body;
      assert.ok(overview.attention.some((a: any) => a.code === 'roadmap' && a.n === 1));
      const admin = (await x.go('GET', '/admin/roadmap', undefined, x.admin)).body;
      assert.deepEqual(
        admin.suggestions.map((s: any) => [s.id, s.status, s.name]),
        [[mine[0].id, 'waiting', 'Anna']],
      );
      await x.go('PUT', `/admin/roadmap/suggestions/${mine[0].id}`, { status: 'approved' }, x.admin);
      const forBen = (await x.go('PUT', `/roadmap/votes/${mine[0].id}`, { on: true }, ben)).body;
      assert.deepEqual(
        forBen.suggestions.map((s: any) => [s.title, s.votes, s.voted, s.mine]),
        [['Export to a spreadsheet', 1, true, false]],
      );
      await x.go('PUT', `/admin/roadmap/suggestions/${mine[0].id}`, { status: 'hidden' }, x.admin);
      assert.equal((await x.go('GET', '/roadmap/board', undefined, ben)).body.suggestions.length, 0);
      assert.equal((await x.go('GET', '/roadmap/board', undefined, anna)).body.suggestions.length, 0);
    } finally {
      await x.close();
    }
  });

  test('Copy for Claude: stable ids, sorted by votes, version and date on top, no names or emails, orphans kept', async () => {
    const x = await server();
    try {
      const anna = x.person('Anna Example');
      const ben = x.person('Ben Example');
      await x.go('PUT', '/roadmap/votes/month-close', { on: true }, anna);
      await x.go('PUT', '/roadmap/votes/month-close', { on: true }, ben);
      await x.go('PUT', '/roadmap/votes/a-drafted-day', { on: true }, anna);
      await x.go('POST', '/roadmap/comments', { target: 'month-close', text: 'Payroll\nneeds this.' }, anna);
      const idea = (await x.go('POST', '/roadmap/suggestions', { title: 'Dark menu bar icon', text: 'Hard to see.' }, ben)).body.suggestions[0].id;
      await x.go('POST', '/roadmap/suggestions', { title: 'Export to a spreadsheet' }, anna);
      await x.go('PUT', `/admin/roadmap/suggestions/${idea}`, { status: 'approved' }, x.admin);
      await x.go('PUT', `/roadmap/votes/${idea}`, { on: true }, anna);
      // A vote for an item that was renamed away.
      x.store.setRoadmapVote('float-sync', x.store.ownerId, true);

      const { text } = (await x.go('GET', '/admin/roadmap/export', undefined, x.admin)).body;
      const today = new Date().toISOString().slice(0, 10);
      assert.equal(
        text,
        `# Gnomon roadmap feedback
Server ${VERSION} · ${today} · 3 people voted · ids in [brackets] are stable · comments are anonymous

## Roadmap items (by votes)
- [month-close] Close a month (Next) · 2 votes
  - "Payroll needs this."
- [a-drafted-day] A drafted day (Next) · 1 vote
- [company-login-oidc] Company login (OIDC) (Later) · 0 votes

## Suggestions by people, approved (by votes)
- [${idea}] Dark menu bar icon · 1 vote
  Hard to see.

## Suggestions by people, waiting for approval
- [idea-2] Export to a spreadsheet · 0 votes

## Votes and comments for ids no longer on the roadmap
- [float-sync] (renamed or removed) · 1 vote
`,
      );
      assert.ok(!/example\.com|Anna|Ben/.test(text));
    } finally {
      await x.close();
    }
  });
});
