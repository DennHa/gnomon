// Sending email (docs/accounts-design.md, section 3b): invitations and password resets. Two ways out:
// - SMTP (Gmail with an app password, Hetzner, any provider): a small client of our own on node:net / node:tls with
//   TLS or STARTTLS and AUTH PLAIN/LOGIN, so the server needs no mail library.
// - Microsoft 365 through Microsoft Graph sendMail with an Entra app registration (client credentials), because
//   Microsoft is retiring basic-auth SMTP.
// Every send goes through a Transport, so tests use a fake one and nothing leaves the machine.
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';

/** What the admin enters under Settings → Email, without the secret (that's stored encrypted, see company.ts). */
export type EmailConfig =
  | { provider: 'smtp'; host: string; port: number; security: 'tls' | 'starttls' | 'none'; user: string; from: string }
  | { provider: 'graph'; tenantId: string; clientId: string; from: string };

/** One email: plain text plus simple HTML. `fromName` is the server's name. */
export type Mail = { to: string; subject: string; text: string; html: string; fromName: string };

/** Something that delivers an email, or throws a MailError that says in plain words what went wrong. */
export type Transport = (mail: Mail) => Promise<void>;

export class MailError extends Error {}

const TIMEOUT_MS = 20_000;

// ---- Building the message -------------------------------------------------------------------------

/** A header value with non-ASCII characters (umlauts in a German subject or a name) as RFC 2047 encoded words. */
const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const base64Lines = (s: string) => (Buffer.from(s, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
const quoteName = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? `"${s.replace(/["\\]/g, '')}"` : encodeWord(s));

/** The full MIME message (multipart/alternative: text, then HTML), with CRLF line ends. */
export function buildMessage(mail: Mail, from: string, date = new Date()): string {
  const boundary = `gnomon-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const domain = from.split('@')[1] || 'localhost';
  return [
    `From: ${quoteName(mail.fromName)} <${from}>`,
    `To: <${mail.to}>`,
    `Subject: ${encodeWord(mail.subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(mail.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(mail.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** An email address without anything that could break a header or an SMTP command. */
export function plainAddress(v: string): boolean {
  return /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]+$/.test(v) && v.length <= 200;
}

// ---- SMTP -----------------------------------------------------------------------------------------

/** Reads SMTP replies (one or more lines, "250-…" continues, "250 …" ends) from a socket that may be swapped for TLS. */
class SmtpConversation {
  private buf = '';
  private waiting: { resolve: (r: { code: number; text: string }) => void; reject: (e: Error) => void } | null = null;
  private failed: Error | null = null;
  private socket!: net.Socket;

  attach(socket: net.Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setTimeout(TIMEOUT_MS, () => this.fail(new MailError('The mail server stopped answering (timeout).')));
    socket.on('data', (chunk: string) => {
      this.buf += chunk;
      this.flush();
    });
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => this.fail(new MailError('The mail server closed the connection.')));
  }

  detach() {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('close');
    this.socket.setTimeout(0);
  }

  private fail(err: Error) {
    if (this.failed) return;
    this.failed = err;
    this.waiting?.reject(err);
    this.waiting = null;
  }

  private flush() {
    if (!this.waiting) return;
    const lines = this.buf.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const m = lines[i].match(/^(\d{3})([ -])(.*)$/);
      if (m && m[2] === ' ') {
        const text = lines.slice(0, i + 1).map((l) => l.slice(4)).join('\n');
        this.buf = lines.slice(i + 1).join('\r\n');
        const w = this.waiting;
        this.waiting = null;
        w.resolve({ code: Number(m[1]), text });
        return;
      }
    }
  }

  read(): Promise<{ code: number; text: string }> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.flush();
    });
  }

  /** Send a command and expect one of the given reply codes; otherwise a MailError from `explain`. */
  async cmd(line: string | null, ok: number[], explain: (code: number, text: string) => string) {
    if (line !== null) this.socket.write(`${line}\r\n`);
    const r = await this.read();
    if (!ok.includes(r.code)) throw new MailError(explain(r.code, r.text.split('\n')[0]));
    return r;
  }

  get raw() {
    return this.socket;
  }
}

function connect(host: string, port: number, secure: boolean): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const opts = { host, port, servername: net.isIP(host) ? undefined : host };
    const s = secure ? tls.connect(opts) : net.connect(opts);
    const timer = setTimeout(() => (s.destroy(), reject(new MailError(`Couldn’t reach ${host}:${port} (timeout). Check the host and port, and that this server may connect out on that port.`))), TIMEOUT_MS);
    s.once(secure ? 'secureConnect' : 'connect', () => (clearTimeout(timer), s.removeAllListeners('error'), resolve(s)));
    s.once('error', (err) => (clearTimeout(timer), reject(err)));
  });
}

/** A Node network or TLS error in words an admin can act on. */
export function explainNetworkError(err: unknown, host: string, port: number): string {
  if (err instanceof MailError) return err.message;
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return `The mail server ${host} wasn’t found. Check the host name.`;
  if (e.code === 'ECONNREFUSED') return `${host} refused the connection on port ${port}. Check the port.`;
  if (e.code === 'ETIMEDOUT') return `Couldn’t reach ${host}:${port} (timeout). Check the host and port.`;
  if (e.code === 'ECONNRESET' || e.code === 'EPROTO' || /SSL|TLS|wrong version/i.test(e.message ?? ''))
    return `The secure connection to ${host}:${port} failed. Port 465 usually needs “TLS”, port 587 “STARTTLS”.`;
  if (/certificate|self.signed|CERT_/i.test(`${e.code ?? ''} ${e.message ?? ''}`)) return `The mail server’s certificate isn’t valid for ${host}.`;
  return `Sending failed: ${e.message ?? String(err)}`;
}

/** Deliver one email over SMTP. Port 465: TLS from the start; 587: STARTTLS (required, never falls back to plain). */
export function smtpTransport(cfg: Extract<EmailConfig, { provider: 'smtp' }>, password: string): Transport {
  return async (mail) => {
    // A password never goes out unencrypted, except to a relay on this machine.
    if (cfg.user && cfg.security === 'none' && !/^(localhost|127\.0\.0\.1|::1)$/.test(cfg.host)) throw new MailError('The password would go out unencrypted. Choose TLS or STARTTLS.');
    if (!plainAddress(mail.to)) throw new MailError(`${mail.to} isn’t an email address this server can send to.`);
    const conv = new SmtpConversation();
    let socket: net.Socket | undefined;
    try {
      socket = await connect(cfg.host, cfg.port, cfg.security === 'tls').catch((e) => {
        throw new MailError(explainNetworkError(e, cfg.host, cfg.port));
      });
      conv.attach(socket);
      const fail = (what: string) => (code: number, text: string) => `${what} (${code} ${text})`;
      await conv.cmd(null, [220], fail('The mail server didn’t greet us'));
      const name = os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
      let ehlo = await conv.cmd(`EHLO ${name}`, [250], fail('The mail server didn’t accept EHLO'));
      if (cfg.security === 'starttls') {
        if (!/^STARTTLS\b/im.test(ehlo.text)) throw new MailError(`${cfg.host} doesn’t offer STARTTLS on port ${cfg.port}. Try “TLS” (usually port 465).`);
        await conv.cmd('STARTTLS', [220], fail('STARTTLS was refused'));
        conv.detach();
        const plain = socket;
        socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
          const s = tls.connect({ socket: plain, servername: net.isIP(cfg.host) ? undefined : cfg.host, });
          s.once('secureConnect', () => (s.removeAllListeners('error'), resolve(s)));
          s.once('error', (e) => reject(new MailError(explainNetworkError(e, cfg.host, cfg.port))));
        });
        conv.attach(socket);
        ehlo = await conv.cmd(`EHLO ${name}`, [250], fail('The mail server didn’t accept EHLO after STARTTLS'));
      }
      if (cfg.user) {
        const authLine = ehlo.text.split('\n').find((l) => /^AUTH\b/i.test(l)) ?? '';
        const badLogin = (code: number, text: string) =>
          code === 535 || code === 534
            ? `The mail server didn’t accept the user name and password (${code}). For Gmail and Microsoft accounts with two-step sign-in, use an app password.`
            : `Signing in to the mail server failed (${code} ${text})`;
        if (/\bPLAIN\b/i.test(authLine) || !/\bLOGIN\b/i.test(authLine)) {
          await conv.cmd(`AUTH PLAIN ${Buffer.from(`\0${cfg.user}\0${password}`, 'utf8').toString('base64')}`, [235], badLogin);
        } else {
          await conv.cmd('AUTH LOGIN', [334], badLogin);
          await conv.cmd(Buffer.from(cfg.user, 'utf8').toString('base64'), [334], badLogin);
          await conv.cmd(Buffer.from(password, 'utf8').toString('base64'), [235], badLogin);
        }
      }
      await conv.cmd(`MAIL FROM:<${cfg.from}>`, [250], (code, text) => `The mail server refused the sender address ${cfg.from} (${code} ${text}). It usually has to be the account you sign in with, or an alias of it.`);
      await conv.cmd(`RCPT TO:<${mail.to}>`, [250, 251], (code, text) => `The mail server refused the recipient ${mail.to} (${code} ${text}).`);
      await conv.cmd('DATA', [354], fail('The mail server refused the message'));
      // Dot-stuffing: a line that starts with "." gets another one (base64 bodies never do, headers might).
      const body = buildMessage(mail, cfg.from).replace(/\r\n\./g, '\r\n..');
      conv.raw.write(body.endsWith('\r\n') ? body : `${body}\r\n`);
      await conv.cmd('.', [250], fail('The mail server refused the message'));
      await conv.cmd('QUIT', [221], () => '').catch(() => {}); // delivered already; a rude goodbye doesn't matter
    } finally {
      socket?.end();
      socket?.destroy();
    }
  };
}

// ---- Microsoft Graph --------------------------------------------------------------------------------

const LOGIN_BASE = () => process.env.GRAPH_LOGIN_BASE || 'https://login.microsoftonline.com';
const GRAPH_BASE = () => process.env.GRAPH_API_BASE || 'https://graph.microsoft.com';

/**
 * Deliver email through Microsoft Graph as the sender mailbox (POST /users/{from}/sendMail), with an app-only token
 * from the Entra app registration. Graph takes a single body, so it gets the HTML (the text is in it, too).
 */
export function graphTransport(cfg: Extract<EmailConfig, { provider: 'graph' }>, clientSecret: string): Transport {
  let cached: { token: string; until: number } | null = null;
  const token = async () => {
    if (cached && cached.until > Date.now()) return cached.token;
    let res: Response;
    try {
      res = await fetch(`${LOGIN_BASE()}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default' }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      throw new MailError('Microsoft couldn’t be reached from this server.');
    }
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      const code = body.error_description?.match(/AADSTS\d+/)?.[0];
      if (code === 'AADSTS90002' || code === 'AADSTS900023') throw new MailError('Microsoft doesn’t know this tenant ID. Copy the Directory (tenant) ID from the app registration’s overview.');
      if (code === 'AADSTS700016') throw new MailError('Microsoft doesn’t know this client ID in the tenant. Copy the Application (client) ID from the app registration’s overview.');
      if (code === 'AADSTS7000215' || code === 'AADSTS7000222') throw new MailError('Microsoft didn’t accept the client secret (wrong or expired). Create a new one and paste its Value, not its ID.');
      throw new MailError(`Microsoft didn’t accept the tenant ID, client ID or secret${code ? ` (${code})` : ''}.`);
    }
    cached = { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 300) * 1000 };
    return cached.token;
  };
  return async (mail) => {
    const message = {
      subject: mail.subject,
      body: { contentType: 'HTML', content: mail.html },
      toRecipients: [{ emailAddress: { address: mail.to } }],
      from: { emailAddress: { address: cfg.from, name: mail.fromName } },
    };
    let res: Response;
    try {
      res = await fetch(`${GRAPH_BASE()}/v1.0/users/${encodeURIComponent(cfg.from)}/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, saveToSentItems: false }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (err) {
      if (err instanceof MailError) throw err;
      throw new MailError('Microsoft Graph couldn’t be reached from this server.');
    }
    if (res.status === 202 || res.ok) return;
    const detail = ((await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }).error;
    if (res.status === 401) cached = null;
    if (res.status === 403 || detail?.code === 'ErrorAccessDenied')
      throw new MailError(`The app may not send as ${cfg.from}. Give it the Mail.Send application permission with admin consent, and check that the mailbox is in its access policy.`);
    if (res.status === 404 || detail?.code === 'ErrorInvalidUser' || detail?.code === 'MailboxNotEnabledForRESTAPI')
      throw new MailError(`Microsoft 365 has no mailbox ${cfg.from} (or it has no Exchange Online licence).`);
    throw new MailError(`Microsoft Graph refused the email (${res.status}${detail?.code ? ` ${detail.code}` : ''}).`);
  };
}
