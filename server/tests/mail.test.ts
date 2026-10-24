// Email: the mail layer (SMTP against a fake mail server, Microsoft Graph against a stand-in), settings, invitations
// and password resets through the app with a fake transport. Nothing is ever sent for real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { createApp } from '../src/app';
import { Company } from '../src/company';
import { inviteEmail, resetEmail } from '../src/emails';
import { invitePeople } from '../src/invites';
import { buildMessage, graphTransport, MailError, smtpTransport, type Mail, type Transport } from '../src/mail';
import { Store } from '../src/store';

const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-mail-test-'));
const sample: Mail = { to: 'sam@example.com', subject: 'Grüße aus Gnomon', text: 'Hallo Sam,\n\n.a line with a dot\n', html: '<p>Hallo Sam</p>', fromName: 'Acme Gnomon' };

/** Decode the parts of a message built by buildMessage: headers, text and HTML. */
function parse(raw: string) {
  const [head] = raw.split('\r\n\r\n');
  const parts = raw.split(/\r\n--gnomon-[a-z0-9]+(?:--)?\r\n/).slice(1);
  const body = (p: string) => Buffer.from(p.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  return { head, text: body(parts[0]), html: body(parts[1]) };
}

/** A fake SMTP server: answers like a real one, records what it got. `auth` decides whether a login works. */
async function fakeSmtp(opts: { auth?: (user: string, pass: string) => boolean; starttls?: boolean; mechs?: string; rejectRcpt?: boolean } = {}) {
  const got: { auth?: [string, string]; from?: string; to?: string; data?: string; commands: string[] } = { commands: [] };
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    let buf = '';
    let inData = false;
    let loginStep = 0;
    let loginUser = '';
    const say = (l: string) => sock.write(`${l}\r\n`);
    say('220 fake.example.com ESMTP');
    sock.on('data', (chunk: string) => {
      buf += chunk;
      while (true) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          got.data = buf.slice(0, end).replace(/\r\n\.\./g, '\r\n.');
          buf = buf.slice(end + 5);
          inData = false;
          say('250 OK queued');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        got.commands.push(line.split(' ')[0]);
        const b64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');
        if (loginStep === 1) {
          loginUser = b64(line);
          loginStep = 2;
          say('334 UGFzc3dvcmQ6');
        } else if (loginStep === 2) {
          loginStep = 0;
          got.auth = [loginUser, b64(line)];
          say(opts.auth?.(loginUser, b64(line)) === false ? '535 5.7.8 Authentication failed' : '235 OK');
        } else if (/^EHLO /.test(line)) {
          say('250-fake.example.com');
          if (opts.starttls) say('250-STARTTLS');
          say(`250-AUTH ${opts.mechs ?? 'PLAIN LOGIN'}`);
          say('250 8BITMIME');
        } else if (/^AUTH PLAIN /.test(line)) {
          const [, user, pass] = b64(line.slice(11)).split('\0');
          got.auth = [user, pass];
          say(opts.auth?.(user, pass) === false ? '535 5.7.8 Authentication failed' : '235 OK');
        } else if (line === 'AUTH LOGIN') {
          loginStep = 1;
          say('334 VXNlcm5hbWU6');
        } else if (/^MAIL FROM:/.test(line)) {
          got.from = line.slice(10).replace(/[<>]/g, '');
          say('250 OK');
        } else if (/^RCPT TO:/.test(line)) {
          got.to = line.slice(8).replace(/[<>]/g, '');
          say(opts.rejectRcpt ? '550 5.1.1 No such user' : '250 OK');
        } else if (line === 'DATA') {
          inData = true;
          say('354 Go ahead');
        } else if (line === 'QUIT') {
          say('221 Bye');
          sock.end();
        } else say('502 Not implemented');
      }
    });
    sock.on('error', () => {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { got, port: (server.address() as AddressInfo).port, close: () => new Promise((r) => server.close(r)) };
}

describe('mail layer', () => {
  test('a message is plain text plus HTML, with non-ASCII subject and sender name encoded', () => {
    const raw = buildMessage(sample, 'gnomon@example.com');
    const m = parse(raw);
    assert.match(m.head, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <gnomon@example.com>|^From: "Acme Gnomon" <gnomon@example.com>/m);
    assert.match(m.head, /^Subject: =\?UTF-8\?B\?/m);
    assert.equal(Buffer.from(m.head.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)![1], 'base64').toString('utf8'), 'Grüße aus Gnomon');
    assert.match(m.head, /^Content-Type: multipart\/alternative/m);
    assert.equal(m.text, sample.text);
    assert.equal(m.html, sample.html);
    assert.ok(raw.split('\r\n').every((l) => l.length <= 998), 'no line is too long for SMTP');
  });

  test('SMTP: signs in (PLAIN or LOGIN), sends to the recipient from the sender, and the message arrives intact', async () => {
    for (const mechs of ['PLAIN LOGIN', 'LOGIN']) {
      const smtp = await fakeSmtp({ mechs });
      try {
        await smtpTransport({ provider: 'smtp', host: '127.0.0.1', port: smtp.port, security: 'none', user: 'mailer', from: 'gnomon@example.com' }, 'sëcret pass')(sample);
        assert.deepEqual(smtp.got.auth, ['mailer', 'sëcret pass']);
        assert.equal(smtp.got.from, 'gnomon@example.com');
        assert.equal(smtp.got.to, 'sam@example.com');
        assert.equal(parse(smtp.got.data!).text, sample.text);
        assert.ok(smtp.got.commands.includes('QUIT'));
      } finally {
        await smtp.close();
      }
    }
  });

  test('SMTP: failures come back in words an admin can act on', async () => {
    const cfg = (port: number, extra = {}) => ({ provider: 'smtp' as const, host: '127.0.0.1', port, security: 'none' as const, user: 'mailer', from: 'gnomon@example.com', ...extra });
    const fails = async (t: Transport, re: RegExp) => {
      await assert.rejects(t(sample), (err: Error) => (assert.ok(err instanceof MailError, err.message), assert.match(err.message, re), true));
    };
    let smtp = await fakeSmtp({ auth: () => false });
    await fails(smtpTransport(cfg(smtp.port), 'wrong'), /didn’t accept the user name and password.*app password/);
    await smtp.close();
    smtp = await fakeSmtp({ rejectRcpt: true });
    await fails(smtpTransport(cfg(smtp.port), 'pw'), /refused the recipient sam@example.com/);
    await smtp.close();
    smtp = await fakeSmtp(); // no STARTTLS on offer: never falls back to sending in the clear
    await fails(smtpTransport(cfg(smtp.port, { security: 'starttls' }), 'pw'), /doesn’t offer STARTTLS/);
    assert.equal(smtp.got.auth, undefined, 'no password was sent');
    await smtp.close();
    await fails(smtpTransport(cfg(smtp.port), 'pw'), /refused the connection on port/); // nothing listens any more
    await fails(smtpTransport(cfg(25, { host: 'smtp.example.com' }), 'pw'), /unencrypted/);
  });

  test('Microsoft 365: an app-only token, then sendMail as the sender mailbox; refusals are explained', async () => {
    const seen: { token?: URLSearchParams; path?: string; auth?: string; body?: any }[] = [];
    let mode: 'ok' | 'forbidden' | 'badSecret' = 'ok';
    const mock = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        if (req.url?.endsWith('/oauth2/v2.0/token')) {
          seen.push({ token: new URLSearchParams(b), path: req.url });
          if (mode === 'badSecret') return res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"invalid_client","error_description":"AADSTS7000215: Invalid client secret provided."}');
          return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"access_token":"graph-token","expires_in":3600}');
        }
        seen.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(b) });
        if (mode === 'forbidden') return res.writeHead(403, { 'Content-Type': 'application/json' }).end('{"error":{"code":"ErrorAccessDenied","message":"Access is denied."}}');
        res.writeHead(202).end();
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
    process.env.GRAPH_LOGIN_BASE = base;
    process.env.GRAPH_API_BASE = base;
    try {
      const cfg = { provider: 'graph' as const, tenantId: '11111111-2222-3333-4444-555555555555', clientId: '66666666-7777-8888-9999-000000000000', from: 'gnomon@example.com' };
      const send = graphTransport(cfg, 'client-secret');
      await send(sample);
      await send(sample);
      assert.equal(seen.filter((x) => x.token).length, 1, 'the token is reused');
      assert.equal(seen[0].path, `/${cfg.tenantId}/oauth2/v2.0/token`);
      assert.equal(seen[0].token!.get('grant_type'), 'client_credentials');
      assert.equal(seen[0].token!.get('scope'), 'https://graph.microsoft.com/.default');
      assert.equal(seen[1].path, '/v1.0/users/gnomon%40example.com/sendMail');
      assert.equal(seen[1].auth, 'Bearer graph-token');
      assert.deepEqual(seen[1].body.message.toRecipients, [{ emailAddress: { address: 'sam@example.com' } }]);
      assert.equal(seen[1].body.message.from.emailAddress.name, 'Acme Gnomon');
      assert.equal(seen[1].body.message.body.content, sample.html);
      mode = 'forbidden';
      await assert.rejects(send(sample), /may not send as gnomon@example.com.*Mail\.Send/);
      mode = 'badSecret';
      await assert.rejects(graphTransport(cfg, 'wrong')(sample), /didn’t accept the client secret/);
    } finally {
      delete process.env.GRAPH_LOGIN_BASE;
      delete process.env.GRAPH_API_BASE;
      await new Promise((r) => mock.close(r));
    }
  });

  test('the emails: short, both languages, the link in text and HTML, the server as sender, HTML escaped', () => {
    const inv = inviteEmail({ lang: 'de', to: 'sam@example.com', name: 'Sam <b>', server: 'Acme', inviter: 'Alex', link: 'https://gnomon.example.com/account/register#invite=ABC', expiresAt: '2026-11-07T10:00:00Z' });
    assert.equal(inv.fromName, 'Acme');
    assert.match(inv.subject, /Einladung zu Acme/);
    assert.ok(inv.text.includes('https://gnomon.example.com/account/register#invite=ABC'));
    assert.ok(inv.html.includes('href="https://gnomon.example.com/account/register#invite=ABC"'));
    assert.ok(inv.html.includes('Sam &lt;b&gt;') && !inv.html.includes('Sam <b>'));
    const reset = resetEmail({ lang: 'en', to: 'sam@example.com', server: 'Gnomon', link: 'https://x.example.com/account/reset#token=T' });
    assert.match(reset.text, /30 minutes/);
    assert.match(reset.text, /If that wasn’t you/);
  });
});

// ---- Through the app ------------------------------------------------------------------------------

async function app(opts: { email?: boolean; publicUrl?: string } = {}) {
  const store = new Store(':memory:');
  const company = new Company(store, Buffer.alloc(32, 9), 'file');
  company.save({ ...company.get(), company: { ...company.get().company, name: 'Acme', publicUrl: opts.publicUrl ?? 'https://gnomon.example.com' } });
  store.updatePerson(store.ownerId, { email: 'boss@example.com', name: 'Alex' });
  store.setPassword(store.ownerId, 'boss password 1');
  const outbox: Mail[] = [];
  let failNext: string | null = null;
  const mail: Transport | undefined =
    opts.email === false
      ? undefined
      : async (m) => {
          if (failNext) {
            const msg = failNext;
            failNext = null;
            throw new MailError(msg);
          }
          outbox.push(m);
        };
  const server = http.createServer(createApp({ store, webDir, company, mail }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const go = async (method: string, p: string, body?: unknown, auth?: string, headers: Record<string, string> = {}) => {
    const r = await fetch(`${url}/api/v1${p}`, { method, headers: { ...(auth && { Authorization: `Bearer ${auth}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const admin = (await go('POST', '/admin/login', { email: 'boss@example.com', password: 'boss password 1' })).body.token as string;
  /** Wait for an email sent in the background. */
  const nextMail = async (n: number) => {
    for (let i = 0; i < 100 && outbox.length < n; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(outbox.length, n, `expected ${n} emails, got ${outbox.length}`);
    return outbox[n - 1];
  };
  return { store, company, outbox, go, admin, nextMail, failNext: (m: string) => (failNext = m), close: async () => (await new Promise((r) => server.close(r)), store.close()) };
}
const tokenIn = (m: Mail) => m.text.match(/#token=([\w-]+)/)![1];
const inviteIn = (m: Mail) => m.text.match(/#invite=([A-Z0-9]+)/)![1];

describe('email settings', () => {
  test('SMTP and Microsoft 365 settings: the secret is stored encrypted and never sent back; a test email says what went wrong', async () => {
    const smtp = await fakeSmtp({ auth: (u, p) => u === 'mailer' && p === 'smtp-secret-value' });
    const { store, company, go, admin, close } = await app({ email: false });
    try {
      assert.equal((await go('POST', '/admin/email/test', {}, admin)).status, 422, 'nothing set up yet');
      assert.equal((await go('PUT', '/admin/email', { provider: 'smtp', host: '127.0.0.1', port: smtp.port, security: 'none', user: 'mailer', from: 'gnomon@example.com' }, admin)).status, 422, 'a password is needed');
      let st = await go('PUT', '/admin/email', { provider: 'smtp', host: '127.0.0.1', port: smtp.port, security: 'none', user: 'mailer', secret: 'wrong', from: 'gnomon@example.com' }, admin);
      assert.equal(st.status, 200);
      assert.equal(st.body.secrets.email, true);
      assert.equal(st.body.email.ready, true);
      const failed = await go('POST', '/admin/email/test', {}, admin);
      assert.equal(failed.status, 422);
      assert.match(failed.body.message, /didn’t accept the user name and password/);
      // A new password; then changing only the sender keeps it.
      await go('PUT', '/admin/email', { provider: 'smtp', host: '127.0.0.1', port: smtp.port, security: 'none', user: 'mailer', secret: 'smtp-secret-value', from: 'gnomon@example.com' }, admin);
      st = await go('PUT', '/admin/email', { provider: 'smtp', host: '127.0.0.1', port: smtp.port, security: 'none', user: 'mailer', from: 'team@example.com' }, admin);
      const ok = await go('POST', '/admin/email/test', {}, admin);
      assert.equal(ok.status, 200);
      assert.equal(ok.body.sentTo, 'boss@example.com');
      assert.equal(smtp.got.from, 'team@example.com');
      assert.match(parse(smtp.got.data!).head, /^From: "Acme" <team@example.com>/m, 'the server’s name is the sender name');
      assert.ok(ok.body.config.email.tested);
      for (const r of [st, ok]) assert.ok(!JSON.stringify(r.body).includes('smtp-secret-value'), 'never sent back');
      assert.ok(!(store.getMeta('secret:email') ?? '').includes('smtp-secret-value'), 'not in plain text');
      assert.equal(company.secret('email'), 'smtp-secret-value');
      // Microsoft 365: the client secret is needed when switching; IDs are checked.
      assert.equal((await go('PUT', '/admin/email', { provider: 'graph', tenantId: 'x', clientId: 'y', secret: 's', from: 'gnomon@example.com' }, admin)).status, 422);
      assert.equal((await go('PUT', '/admin/email', { provider: 'graph', tenantId: '11111111-2222-3333-4444-555555555555', clientId: '66666666-7777-8888-9999-000000000000', from: 'gnomon@example.com' }, admin)).status, 422);
      st = await go('PUT', '/admin/email', { provider: 'graph', tenantId: '11111111-2222-3333-4444-555555555555', clientId: '66666666-7777-8888-9999-000000000000', secret: 'graph-secret-value', from: 'gnomon@example.com' }, admin);
      assert.equal(st.body.config.email.provider, 'graph');
      assert.ok(!JSON.stringify(st.body).includes('graph-secret-value'));
      st = await go('DELETE', '/admin/email', undefined, admin);
      assert.equal(st.body.secrets.email, false);
      assert.equal(st.body.email.ready, false);
    } finally {
      await close();
      await smtp.close();
    }
  });
});

describe('invitations by email', () => {
  test('with email the link is emailed, not shown; without, it is shown to copy; a failed send falls back to the link', async () => {
    const { outbox, go, admin, failNext, close } = await app();
    try {
      const r = await go('POST', '/admin/people', { email: 'Sam@Example.com', name: 'Sam' }, admin);
      assert.equal(r.status, 201);
      assert.equal(r.body.invite.sent, true);
      assert.equal(r.body.invite.link, undefined);
      assert.equal(outbox.length, 1);
      assert.equal(outbox[0].to, 'sam@example.com');
      assert.equal(outbox[0].fromName, 'Acme');
      assert.match(outbox[0].text, /Alex invited you to Gnomon on Acme/);
      assert.match(outbox[0].text, /https:\/\/gnomon\.example\.com\/account\/register#invite=/);
      const reg = await go('POST', '/account/register', { invite: inviteIn(outbox[0]), name: 'Sam', password: 'sam password 12' });
      assert.equal(reg.status, 201, 'the emailed link works');
      failNext('The mail server refused the recipient');
      const f = await go('POST', '/admin/people', { email: 'kim@example.com' }, admin);
      assert.equal(f.body.invite.sent, false);
      assert.match(f.body.invite.error, /refused the recipient/);
      assert.match(f.body.invite.link, /#invite=/);
    } finally {
      await close();
    }
    const plain = await app({ email: false });
    try {
      const r = await plain.go('POST', '/admin/people', { email: 'sam@example.com' }, plain.admin);
      assert.equal(r.body.invite.sent, false);
      assert.equal(r.body.invite.error, undefined);
      assert.match(r.body.invite.link, /^https:\/\/gnomon\.example\.com\/account\/register#invite=[A-Z0-9]{10}$/);
      assert.equal(r.body.email, false);
    } finally {
      await plain.close();
    }
  });

  test('invitations last as long as the admin says (14 days by default), show as expired after, and can be sent again', async (t) => {
    const ctx = await app();
    const { store, outbox, go, close } = ctx;
    let admin = ctx.admin;
    try {
      assert.equal((await go('GET', '/admin/people', undefined, admin)).body.inviteDays, 14);
      assert.equal((await go('PUT', '/admin/registration', { inviteDays: 0 }, admin)).status, 422);
      assert.equal((await go('PUT', '/admin/registration', { inviteDays: 3 }, admin)).body.inviteDays, 3);
      t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
      const r = await go('POST', '/admin/people', { email: 'sam@example.com' }, admin);
      const days = (Date.parse(r.body.invite.expiresAt) - Date.now()) / 86_400_000;
      assert.ok(Math.abs(days - 3) < 0.01, `valid for 3 days, got ${days}`);
      const code = inviteIn(outbox[0]);
      t.mock.timers.tick(3 * 86_400_000 + 1000);
      assert.equal((await go('GET', `/account/invite/${code}`)).status, 404, 'expired');
      admin = (await go('POST', '/admin/login', { email: 'boss@example.com', password: 'boss password 1' })).body.token; // the old session ran out too
      const sam = (await go('GET', '/admin/people', undefined, admin)).body.people.find((x: any) => x.email === 'sam@example.com');
      assert.equal(sam.status, 'invited');
      assert.ok(Date.parse(sam.inviteExpiresAt) < Date.now(), 'the People page sees it ran out');
      const again = await go('POST', `/admin/people/${sam.id}/invite`, undefined, admin);
      assert.equal(again.body.invite.sent, true);
      assert.equal(outbox.length, 2);
      assert.ok(Date.parse(again.body.people.find((x: any) => x.id === sam.id).inviteExpiresAt) > Date.now());
      assert.equal((await go('GET', `/account/invite/${code}`)).status, 404, 'the old link stays dead');
      assert.equal((await go('GET', `/account/invite/${inviteIn(outbox[1])}`)).status, 200);
      assert.equal(store.inviteDays(), 3);
    } finally {
      t.mock.timers.reset();
      await close();
    }
  });

  test('invitePeople takes a list: new people are invited, duplicates and existing accounts are reported', async () => {
    const store = new Store(':memory:');
    store.updatePerson(store.ownerId, { email: 'boss@example.com' });
    const sent: Mail[] = [];
    const results = await invitePeople({ store, transport: async (m) => void sent.push(m), baseUrl: 'https://gnomon.example.com/', server: 'Acme', inviter: 'Alex', lang: 'en' }, [
      { email: 'a@example.com', name: 'A' },
      { email: 'B@example.com', role: 'admin' },
      { email: 'a@example.com' },
      { email: 'boss@example.com' },
      { email: 'not an email' },
    ]);
    assert.deepEqual(results.map((r) => [r.email, r.sent, r.error ?? null]), [
      ['a@example.com', true, null],
      ['b@example.com', true, null],
      ['boss@example.com', false, 'There’s already an account with this email'],
      ['not an email', false, 'Not an email address'],
    ]);
    assert.deepEqual(sent.map((m) => m.to), ['a@example.com', 'b@example.com']);
    assert.equal(store.personByEmail('b@example.com')!.role, 'admin');
    assert.ok(sent[0].text.includes('https://gnomon.example.com/account/register#invite='));
    store.close();
  });
});

describe('password reset', () => {
  test('the same answer for every email; only a real account gets a link, which works once, and the new password signs in', async () => {
    const { outbox, go, nextMail, close } = await app();
    try {
      assert.equal((await go('GET', '/account/config')).body.email, true);
      const known = await go('POST', '/account/forgot', { email: 'Boss@Example.com' });
      const unknown = await go('POST', '/account/forgot', { email: 'nobody@example.com' });
      assert.deepEqual([known.status, known.body], [unknown.status, unknown.body], 'no account probing');
      assert.equal(known.status, 202);
      const m = await nextMail(1);
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(outbox.length, 1, 'nothing for an unknown email');
      assert.equal(m.to, 'boss@example.com');
      assert.match(m.text, /^https:\/\/gnomon\.example\.com\/account\/reset#token=[\w-]{40,}$/m);
      const token = tokenIn(m);
      assert.deepEqual((await go('POST', '/account/reset/check', { token })).body, { email: 'boss@example.com' });
      assert.equal((await go('POST', '/account/reset', { token, password: 'short' })).status, 422);
      const done = await go('POST', '/account/reset', { token, password: 'a brand new password' });
      assert.equal(done.status, 200);
      assert.ok(done.body.token, 'signed in on that page');
      assert.equal((await go('POST', '/account/reset', { token, password: 'another new password' })).status, 404, 'works once');
      assert.equal((await go('POST', '/account/reset/check', { token })).status, 404);
      assert.equal((await go('POST', '/account/login', { email: 'boss@example.com', password: 'boss password 1' })).status, 401);
      assert.equal((await go('POST', '/account/login', { email: 'boss@example.com', password: 'a brand new password' })).status, 201);
    } finally {
      await close();
    }
  });

  test('a link is valid for 30 minutes, and a newer password ends older links', async (t) => {
    const { go, nextMail, close } = await app();
    try {
      t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
      await go('POST', '/account/forgot', { email: 'boss@example.com' });
      const first = tokenIn(await nextMail(1));
      await go('POST', '/account/forgot', { email: 'boss@example.com' });
      const second = tokenIn(await nextMail(2));
      t.mock.timers.tick(29 * 60_000);
      assert.equal((await go('POST', '/account/reset/check', { token: first })).status, 200);
      assert.equal((await go('POST', '/account/reset', { token: second, password: 'new password one' })).status, 200);
      assert.equal((await go('POST', '/account/reset', { token: first, password: 'new password two' })).status, 404, 'using one ends the others');
      await go('POST', '/account/forgot', { email: 'boss@example.com' });
      const third = tokenIn(await nextMail(3));
      t.mock.timers.tick(30 * 60_000 + 1000);
      assert.equal((await go('POST', '/account/reset', { token: third, password: 'new password three' })).status, 404, 'expired after 30 minutes');
    } finally {
      t.mock.timers.reset();
      await close();
    }
  });

  test('other devices stay signed in unless the person ticks the box', async () => {
    const { go, nextMail, close } = await app();
    try {
      const mac = (await go('POST', '/account/device', { email: 'boss@example.com', password: 'boss password 1', client: 'mac' })).body.key;
      await go('POST', '/account/forgot', { email: 'boss@example.com' });
      await go('POST', '/account/reset', { token: tokenIn(await nextMail(1)), password: 'new password one' });
      assert.equal((await go('GET', '/state', undefined, mac)).status, 200, 'still signed in');
      await go('POST', '/account/forgot', { email: 'boss@example.com' });
      const r = await go('POST', '/account/reset', { token: tokenIn(await nextMail(2)), password: 'new password two', signOutOthers: true });
      assert.equal((await go('GET', '/state', undefined, mac)).status, 401, 'signed out');
      assert.equal((await go('GET', '/account/me', undefined, r.body.token)).status, 200, 'this page stays signed in');
    } finally {
      await close();
    }
  });

  test('rate limits, disabled and invited people, and a server without email', async () => {
    const { store, outbox, go, admin, close } = await app();
    try {
      // At most 3 emails an hour per account, silently.
      for (let i = 0; i < 5; i++) assert.equal((await go('POST', '/account/forgot', { email: 'boss@example.com' }, undefined, { 'X-Forwarded-For': `203.0.113.${i}` })).status, 202);
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(outbox.length, 3);
      // 5 requests per address in 15 minutes, then 429 whatever the email.
      for (let i = 0; i < 5; i++) await go('POST', '/account/forgot', { email: `x${i}@example.com` });
      assert.equal((await go('POST', '/account/forgot', { email: 'nobody@example.com' })).status, 429);
      // Invited and disabled people get nothing.
      const sam = (await go('POST', '/admin/people', { email: 'sam@example.com' }, admin)).body.invite.personId;
      const kim = store.addPerson({ email: 'kim@example.com', name: 'Kim', status: 'disabled' });
      const before = outbox.length;
      for (const email of ['sam@example.com', 'kim@example.com']) assert.equal((await go('POST', '/account/forgot', { email }, undefined, { 'X-Forwarded-For': '198.51.100.1' })).status, 202);
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(outbox.length, before);
      assert.equal((await go('POST', `/admin/people/${sam}/reset`, undefined, admin)).status, 422);
      assert.equal((await go('POST', `/admin/people/${kim.id}/reset`, undefined, admin)).status, 422);
    } finally {
      await close();
    }
    const plain = await app({ email: false });
    try {
      assert.equal((await plain.go('GET', '/account/config')).body.email, false);
      assert.equal((await plain.go('POST', '/account/forgot', { email: 'boss@example.com' })).status, 503);
      assert.equal((await plain.go('POST', `/admin/people/${plain.store.ownerId}/reset`, undefined, plain.admin)).status, 422);
    } finally {
      await plain.close();
    }
    // Email set up but no public address: links would have to trust the request's Host header, so nothing goes out.
    const noUrl = await app({ publicUrl: '' });
    try {
      assert.equal((await noUrl.go('GET', '/account/config')).body.email, false);
      assert.equal((await noUrl.go('POST', '/account/forgot', { email: 'boss@example.com' })).status, 503);
    } finally {
      await noUrl.close();
    }
  });

  test('an admin sends a reset link to the person’s own email; a failure says why', async () => {
    const { outbox, go, admin, failNext, close } = await app();
    try {
      await go('PUT', '/admin/registration', { mode: 'open' }, admin);
      await go('POST', '/account/register', { name: 'Cara', email: 'cara@example.com', password: 'cara password 1' });
      const cara = (await go('GET', '/admin/people', undefined, admin)).body.people.find((x: any) => x.email === 'cara@example.com');
      const r = await go('POST', `/admin/people/${cara.id}/reset`, undefined, admin);
      assert.equal(r.status, 200);
      assert.equal(r.body.resetSentTo, 'cara@example.com');
      assert.ok(!JSON.stringify(r.body).includes('#token='), 'the admin never sees the link');
      assert.equal(outbox.at(-1)!.to, 'cara@example.com');
      failNext('Microsoft Graph refused the email (500).');
      const f = await go('POST', `/admin/people/${cara.id}/reset`, undefined, admin);
      assert.equal(f.status, 422);
      assert.match(f.body.message, /Graph refused/);
    } finally {
      await close();
    }
  });
});
