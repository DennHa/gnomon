// Inviting people from a list: reading CSV and pasted text, the preview, and inviting in batches through the app
// with a fake mail transport. Nothing is ever sent for real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { createApp } from '../src/app';
import { Company } from '../src/company';
import { guessSeparator, parseCsv, toCsv } from '../src/csv';
import { MailError, type Mail, type Transport } from '../src/mail';
import { parsePeopleList, previewImport } from '../src/people-import';
import { Store } from '../src/store';

const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-import-test-'));
const people = (text: string) => parsePeopleList(text).map(({ name, email }) => [name, email]);

describe('reading a list', () => {
  test('comma, semicolon or tab; name first or email first; blank lines skipped; line numbers kept', () => {
    assert.deepEqual(people('Jane Doe, jane@example.com\nJohn Roe, john@example.com\n'), [['Jane Doe', 'jane@example.com'], ['John Roe', 'john@example.com']]);
    assert.deepEqual(people('Jane Doe;jane@example.com\r\n\r\nJohn Roe;JOHN@Example.com'), [['Jane Doe', 'jane@example.com'], ['John Roe', 'john@example.com']]);
    assert.deepEqual(people('Jane Doe\tjane@example.com\njohn@example.com\tJohn Roe'), [['Jane Doe', 'jane@example.com'], ['John Roe', 'john@example.com']]);
    assert.deepEqual(people('jane@example.com\nJane Doe <jane.doe@example.com>\nmailto:sam@example.com'), [['', 'jane@example.com'], ['Jane Doe', 'jane.doe@example.com'], ['', 'sam@example.com']]);
    assert.deepEqual(people('Jane;Doe;jane@example.com;Sales'), [['Jane Doe', 'jane@example.com']], 'first and last name in two cells');
    assert.deepEqual(parsePeopleList('a, a@example.com\n\n,,\nb, b@example.com').map((r) => r.line), [1, 4]);
  });

  test('a header line is recognised and says which column is which, in English or German', () => {
    assert.deepEqual(people('Name,Email\nJane Doe,jane@example.com'), [['Jane Doe', 'jane@example.com']]);
    assert.deepEqual(people('E-Mail-Adresse;Abteilung;Vorname;Nachname\njane@example.com;Sales;Jane;Doe'), [['Jane Doe', 'jane@example.com']]);
    assert.deepEqual(people('Email Address\tDisplay Name\tTeam\njane@example.com\tJane Doe\tOps'), [['Jane Doe', 'jane@example.com']]);
    assert.equal(parsePeopleList('Name,Email\nJane Doe,jane@example.com')[0].line, 2);
    assert.deepEqual(people('Jane Doe\njane@example.com'), [['', 'jane doe'], ['', 'jane@example.com']], 'a first line that isn’t a header stays a line');
  });

  test('Excel-style CSV: byte order mark, quotes with separators, doubled quotes and line breaks inside', () => {
    const excel = '﻿"Name";"E-Mail"\r\n"Doe; Jane";"jane@example.com"\r\n"Roe, ""Johnny"" John";john@example.com\r\n"Smith\nSam";sam@example.com\r\n';
    assert.deepEqual(people(excel), [['Doe; Jane', 'jane@example.com'], ['Roe, "Johnny" John', 'john@example.com'], ['Smith Sam', 'sam@example.com']]);
    assert.deepEqual(parsePeopleList(excel).map((r) => r.line), [2, 3, 4]);
    assert.equal(guessSeparator('"Doe, Jane";jane@example.com'), ';', 'a comma inside quotes doesn’t count');
    assert.equal(guessSeparator('Doe, Jane; jane@example.com'), ';');
    assert.deepEqual(parseCsv('a,"b ""c""",d\n'), [{ line: 1, fields: ['a', 'b "c"', 'd'] }]);
  });

  test('the links file is CSV that Excel opens as UTF-8, quotes what needs it, and never runs a formula', () => {
    const csv = toCsv([['Name', 'Email'], ['Doe, Jane', 'jane@example.com'], ['=HYPERLINK("x")', 'a@example.com']]);
    assert.ok(csv.startsWith('﻿Name,Email\r\n'));
    assert.ok(csv.includes('"Doe, Jane",jane@example.com'));
    assert.ok(csv.includes(`"'=HYPERLINK(""x"")",a@example.com`));
    assert.deepEqual(people(csv).slice(0, 1), [['Doe, Jane', 'jane@example.com']], 'and it reads back');
    assert.ok(toCsv([['Doe; Jane', 'x']], ';').includes('"Doe; Jane";x'));
  });
});

describe('the preview', () => {
  test('each line is new, has an account, already invited, twice in the list, or not an email; with a count per kind', () => {
    const store = new Store(':memory:');
    try {
      store.addPerson({ email: 'active@example.com', name: 'Active', status: 'active' });
      store.addPerson({ email: 'invited@example.com', name: 'Invited', status: 'invited' });
      store.addPerson({ email: 'pending@example.com', name: 'Pending', status: 'pending' });
      const list = ['Jane Doe, jane@example.com', 'Active One, active@example.com', 'Invited One, invited@example.com', 'Pending One, pending@example.com', 'Jane Again, JANE@example.com', 'No Email, not-an-email', 'Bad, jane@@example', 'John Roe, john@example.com'].join('\n');
      const { rows, counts } = previewImport(store, parsePeopleList(list));
      assert.deepEqual(
        rows.map((r) => r.status),
        ['new', 'account', 'invited', 'account', 'duplicate', 'invalid', 'invalid', 'new'],
      );
      assert.deepEqual(counts, { new: 2, account: 2, invited: 1, duplicate: 1, invalid: 2 });
      assert.equal(store.listPeople().length, 4, 'the preview changes nothing');
    } finally {
      store.close();
    }
  });
});

// ---- Through the app ------------------------------------------------------------------------------

async function app(opts: { email?: boolean } = {}) {
  const store = new Store(':memory:');
  const company = new Company(store, Buffer.alloc(32, 9), 'file');
  company.save({ ...company.get(), company: { ...company.get().company, name: 'Acme', publicUrl: 'https://gnomon.example.com' } });
  store.updatePerson(store.ownerId, { email: 'boss@example.com', name: 'Alex' });
  store.setPassword(store.ownerId, 'boss password 1');
  const outbox: Mail[] = [];
  const failFor = new Set<string>();
  const mail: Transport | undefined =
    opts.email === false
      ? undefined
      : async (m) => {
          if (failFor.has(m.to)) throw new MailError('The mail server refused the recipient.');
          outbox.push(m);
        };
  const server = http.createServer(createApp({ store, webDir, company, mail }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const go = async (method: string, p: string, body?: unknown, auth?: string) => {
    const r = await fetch(`${url}/api/v1${p}`, { method, headers: { ...(auth && { Authorization: `Bearer ${auth}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const admin = (await go('POST', '/admin/login', { email: 'boss@example.com', password: 'boss password 1' })).body.token as string;
  return { store, company, outbox, failFor, go, admin, close: async () => (await new Promise((r) => server.close(r)), store.close()) };
}

describe('inviting from a list', () => {
  test('only admins can check or import a list', async () => {
    const { store, go, close } = await app();
    try {
      const member = store.addPerson({ email: 'member@example.com', name: 'Member', status: 'active' });
      store.setPassword(member.id, 'member password 1');
      const token = (await go('POST', '/account/login', { email: 'member@example.com', password: 'member password 1' })).body.token;
      assert.ok(token);
      for (const [p, body] of [['/admin/people/import/preview', { text: 'Jane Doe, jane@example.com' }], ['/admin/people/import', { people: [{ email: 'jane@example.com' }], by: 'link' }]] as const) {
        assert.equal((await go('POST', p, body, token)).status, 403, `${p} as a member`);
        assert.equal((await go('POST', p, body)).status, 401, `${p} signed out`);
      }
      assert.equal(store.personByEmail('jane@example.com'), undefined);
    } finally {
      await close();
    }
  });

  test('preview, then invite the new people by email in batches; a failed email shows its link and can be retried', async () => {
    const { store, company, outbox, failFor, go, admin, close } = await app();
    try {
      store.setInviteDays(5);
      store.addPerson({ email: 'active@example.com', name: 'Active', status: 'active' });
      const list = ['Name;E-Mail', ...Array.from({ length: 23 }, (_, i) => `Person ${i + 1};person${i + 1}@example.com`), 'Active;active@example.com', 'Again;PERSON1@example.com', 'Nobody;nope'].join('\n');
      const pre = await go('POST', '/admin/people/import/preview', { text: list }, admin);
      assert.equal(pre.status, 200);
      assert.deepEqual(pre.body.counts, { new: 23, account: 1, invited: 0, duplicate: 1, invalid: 1 });
      assert.equal(pre.body.email, true);
      assert.equal(pre.body.inviteDays, 5);
      assert.equal(outbox.length, 0, 'nothing is sent by a preview');
      assert.equal(store.listPeople().length, 2);

      // The Admin page sends the new rows in batches of 10.
      failFor.add('person7@example.com');
      const fresh = pre.body.rows.filter((r: any) => r.status === 'new');
      const results: any[] = [];
      for (let i = 0; i < fresh.length; i += 10) {
        const r = await go('POST', '/admin/people/import', { people: fresh.slice(i, i + 10).map(({ name, email }: any) => ({ name, email })), by: 'email' }, admin);
        assert.equal(r.status, 200);
        results.push(...r.body.results);
      }
      assert.equal(results.length, 23);
      assert.equal(outbox.length, 22);
      assert.equal(results.filter((r) => r.sent).length, 22);
      const failed = results.find((r) => !r.sent);
      assert.equal(failed.email, 'person7@example.com');
      assert.match(failed.error, /refused the recipient/);
      assert.match(failed.link, /^https:\/\/gnomon\.example\.com\/account\/register#invite=/);
      assert.ok(Math.abs(Date.parse(failed.expiresAt) - Date.now() - 5 * 86_400_000) < 60_000, 'the admin’s validity is used');
      assert.match(outbox[0].text, /Hello Person 1,/);
      assert.equal(store.personByEmail('person1@example.com')?.status, 'invited');
      assert.equal(store.personByEmail('person1@example.com')?.role, 'member');

      // Sending the same people again changes nothing; trying again for the failed one sends a fresh invitation.
      const twice = await go('POST', '/admin/people/import', { people: [{ email: 'person2@example.com' }, { email: 'active@example.com' }], by: 'email' }, admin);
      assert.deepEqual(twice.body.results.map((r: any) => r.error), ['Already invited', 'There’s already an account with this email']);
      assert.equal(outbox.length, 22);
      failFor.clear();
      const retry = await go('POST', '/admin/people/import', { people: [{ email: 'person7@example.com', name: 'Person 7' }], by: 'email', again: true }, admin);
      assert.equal(retry.body.results[0].sent, true);
      assert.equal(outbox.length, 23);
      assert.ok(company.get().audit.some((a) => a.what === 'Invited 10 people from a list by email'));
    } finally {
      await close();
    }
  });

  test('as links (without email, or by choice), with limits on list and batch size', async () => {
    const { outbox, go, admin, close } = await app();
    try {
      const r = await go('POST', '/admin/people/import', { people: [{ name: 'Jane Doe', email: 'jane@example.com' }], by: 'link' }, admin);
      assert.equal(r.body.results[0].sent, false);
      assert.equal(r.body.results[0].error, undefined);
      assert.match(r.body.results[0].link, /#invite=[A-Z0-9]{10}$/);
      assert.equal(outbox.length, 0, 'links only: no email even though email is set up');
      assert.equal((await go('POST', '/admin/people/import', { people: Array.from({ length: 51 }, (_, i) => ({ email: `p${i}@example.com` })), by: 'link' }, admin)).status, 422);
      assert.equal((await go('POST', '/admin/people/import', { people: [], by: 'link' }, admin)).status, 422);
      assert.equal((await go('POST', '/admin/people/import/preview', { text: ' \n ' }, admin)).status, 422);
      const big = Array.from({ length: 1001 }, (_, i) => `p${i}@example.com`).join('\n');
      assert.equal((await go('POST', '/admin/people/import/preview', { text: big }, admin)).status, 422);
      const ok = Array.from({ length: 500 }, (_, i) => `Person ${i}, p${i}@example.com`).join('\n');
      assert.equal((await go('POST', '/admin/people/import/preview', { text: ok }, admin)).body.counts.new, 500);
    } finally {
      await close();
    }
    const plain = await app({ email: false });
    try {
      assert.equal((await plain.go('POST', '/admin/people/import/preview', { text: 'jane@example.com' }, plain.admin)).body.email, false);
      assert.equal((await plain.go('POST', '/admin/people/import', { people: [{ email: 'jane@example.com' }], by: 'email' }, plain.admin)).status, 422, 'by email needs email set up');
      assert.match((await plain.go('POST', '/admin/people/import', { people: [{ email: 'jane@example.com' }], by: 'link' }, plain.admin)).body.results[0].link, /#invite=/);
    } finally {
      await plain.close();
    }
  });
});
