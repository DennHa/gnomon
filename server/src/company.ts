// Company setup (docs/company-setup.md): the settings an admin enters in the setup wizard, the Float and Personio
// credentials (encrypted at rest), connection tests, and the macOS settings profile for Iru.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './store';
import { graphTransport, plainAddress, smtpTransport, type EmailConfig, type Transport } from './mail';

// ---- Secrets ------------------------------------------------------------------------------------

/**
 * The key that encrypts tokens in the database: GNOMON_SECRET_KEY (any long string, e.g. a Docker secret), or else a
 * random key file next to the database. The file is fine for a single server but sits with the data it protects, so
 * the wizard recommends the environment variable.
 */
export function loadSecretKey(dataDir: string): { key: Buffer; source: 'env' | 'file' } {
  const env = process.env.GNOMON_SECRET_KEY?.trim();
  if (env) return { key: createHash('sha256').update(env).digest(), source: 'env' };
  const file = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  return { key: createHash('sha256').update(fs.readFileSync(file, 'utf8').trim()).digest(), source: 'file' };
}

function encrypt(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(key: Buffer, stored: string): string | undefined {
  const [v, iv, tag, data] = stored.split(':');
  if (v !== 'v1') return undefined;
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return undefined; // wrong key (e.g. GNOMON_SECRET_KEY changed): the admin enters the token again
  }
}

// ---- Settings -----------------------------------------------------------------------------------

export type Rules = {
  /** Whether the Mac app may switch on its local REST API. */
  allowLocalApi: boolean;
  /** Whether the opt-in activity trail is offered on Macs. */
  allowActivityTrail: boolean;
  /** Hide personal setup on Macs (integrations guide, token fields); the company server is used instead. */
  managed: boolean;
  /** The phone web app on this server. */
  phoneApp: boolean;
};

export type CompanyConfig = {
  setupDone: boolean;
  checklist: { https: boolean; signedApp: boolean; companyLogin: boolean; integrations: boolean; macManagement: boolean };
  company: { name: string; publicUrl: string; timezone: string; dailyTargetHours: number; language: 'system' | 'en' | 'de' };
  float: { tested?: string; people?: number };
  personio: { tested?: string; people?: number; absenceTypes?: { id: string; name: string; unit?: string }[]; dayOffTypes?: string[] };
  /** How the server sends email (Settings → Email); the password or client secret is a secret of its own. */
  email?: EmailConfig & { tested?: string };
  rules: Rules;
  /** Where /latest hands out the Mac app from: the official GitHub release, or an upload (see releases.ts). */
  macApp: { source: 'github' | 'upload' };
  audit: { at: string; what: string }[];
};

export const defaultConfig = (): CompanyConfig => ({
  setupDone: false,
  checklist: { https: false, signedApp: false, companyLogin: false, integrations: false, macManagement: false },
  company: { name: '', publicUrl: process.env.GNOMON_PUBLIC_URL?.trim().replace(/\/+$/, '') ?? '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, dailyTargetHours: 8, language: 'system' },
  float: {},
  personio: {},
  rules: { allowLocalApi: false, allowActivityTrail: true, managed: true, phoneApp: true },
  macApp: { source: 'github' },
  audit: [],
});

export class Company {
  constructor(
    private store: Store,
    private key: Buffer,
    readonly keySource: 'env' | 'file',
  ) {}

  get(): CompanyConfig {
    const raw = this.store.getMeta('company');
    const base = defaultConfig();
    if (!raw) return base;
    const c = JSON.parse(raw) as Partial<CompanyConfig>;
    return { ...base, ...c, checklist: { ...base.checklist, ...c.checklist }, company: { ...base.company, ...c.company }, rules: { ...base.rules, ...c.rules }, macApp: { ...base.macApp, ...c.macApp } };
  }

  save(c: CompanyConfig, what?: string) {
    // A short log of who changed what and when (never values); the admin is "admin" until sign-in exists.
    if (what) c.audit = [...c.audit, { at: new Date().toISOString(), what }].slice(-200);
    this.store.setMeta('company', JSON.stringify(c));
  }

  setSecret(name: SecretName, value: string | null) {
    this.store.setMeta(`secret:${name}`, value === null ? '' : encrypt(this.key, value));
  }

  hasSecret(name: SecretName): boolean {
    return Boolean(this.store.getMeta(`secret:${name}`));
  }

  secret(name: SecretName): string | undefined {
    const v = this.store.getMeta(`secret:${name}`);
    return v ? decrypt(this.key, v) : undefined;
  }

  /** How to send email as set up in Settings → Email, or undefined when it isn't (or the secret can't be read). */
  mailTransport(): Transport | undefined {
    const e = this.get().email;
    if (!e) return undefined;
    const secret = this.secret('email');
    if (e.provider === 'graph') return secret ? graphTransport(e, secret) : undefined;
    // An SMTP relay may need no password; one that has a user needs it.
    if (e.user && !secret) return undefined;
    return smtpTransport(e, secret ?? '');
  }
}

type SecretName = 'float' | 'personio' | 'email';

/**
 * Email settings from the Admin page, checked: the provider's fields with sensible values. The secret (SMTP password or
 * client secret) is returned apart, so it can be stored encrypted; empty means "keep the one that's stored".
 */
export function parseEmailSettings(u: Record<string, unknown>): { config: EmailConfig; secret: string } {
  const str = (k: string, max = 300) => (typeof u[k] === 'string' ? (u[k] as string).trim().slice(0, max) : '');
  const from = str('from', 200).toLowerCase();
  if (!plainAddress(from)) throw new Error('Enter the sender address, like gnomon@example.com');
  const secret = typeof u.secret === 'string' ? u.secret.slice(0, 1000) : '';
  if (u.provider === 'graph') {
    const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const tenantId = str('tenantId').toLowerCase();
    const clientId = str('clientId').toLowerCase();
    if (!guid.test(tenantId) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(tenantId)) throw new Error('Enter the Directory (tenant) ID from the app registration');
    if (!guid.test(clientId)) throw new Error('Enter the Application (client) ID from the app registration');
    return { config: { provider: 'graph', tenantId, clientId, from }, secret };
  }
  if (u.provider !== 'smtp') throw new Error('Choose SMTP or Microsoft 365');
  const host = str('host', 200).toLowerCase();
  if (!/^[a-z0-9.-]+$/i.test(host) && !/^\[?[0-9a-f:]+\]?$/i.test(host)) throw new Error('Enter the mail server’s host name, like smtp.example.com');
  const port = Number(u.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter the port: 465 for TLS, 587 for STARTTLS');
  const security = u.security === 'tls' || u.security === 'starttls' || u.security === 'none' ? u.security : port === 465 ? 'tls' : 'starttls';
  const user = str('user', 200);
  return { config: { provider: 'smtp', host, port, security, user, from }, secret };
}

/** Merge a partial update from the wizard into the config, accepting only known keys with sensible values. */
export function applyConfigUpdate(c: CompanyConfig, u: Record<string, unknown>): CompanyConfig {
  const next = structuredClone(c);
  const obj = (v: unknown) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const cl = obj(u.checklist);
  for (const k of Object.keys(next.checklist) as (keyof CompanyConfig['checklist'])[]) if (typeof cl[k] === 'boolean') next.checklist[k] = cl[k] as boolean;
  const co = obj(u.company);
  if (typeof co.name === 'string') next.company.name = co.name.trim().slice(0, 100);
  if (typeof co.publicUrl === 'string') {
    const v = co.publicUrl.trim();
    if (v && !/^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(v) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(v)) throw new Error('The address must start with https:// and contain only the host name');
    next.company.publicUrl = v.replace(/\/+$/, '');
  }
  if (typeof co.timezone === 'string') {
    try {
      new Intl.DateTimeFormat('en', { timeZone: co.timezone });
      next.company.timezone = co.timezone;
    } catch {
      throw new Error('Unknown time zone');
    }
  }
  if (typeof co.dailyTargetHours === 'number' && co.dailyTargetHours > 0 && co.dailyTargetHours <= 24) next.company.dailyTargetHours = co.dailyTargetHours;
  if (co.language === 'system' || co.language === 'en' || co.language === 'de') next.company.language = co.language;
  const r = obj(u.rules);
  for (const k of Object.keys(next.rules) as (keyof Rules)[]) if (typeof r[k] === 'boolean') next.rules[k] = r[k] as boolean;
  const m = obj(u.macApp);
  if (m.source === 'github' || m.source === 'upload') next.macApp.source = m.source;
  const p = obj(u.personio);
  if (Array.isArray(p.dayOffTypes)) next.personio.dayOffTypes = p.dayOffTypes.filter((x): x is string => typeof x === 'string').slice(0, 100);
  return next;
}

// ---- Connection tests ---------------------------------------------------------------------------

const FLOAT_API_BASE = () => process.env.FLOAT_API_BASE || 'https://api.float.com/v3';
const PERSONIO_API_BASE = () => process.env.PERSONIO_API_BASE || 'https://api.personio.de';

/** Read-only check of a Float API token: how many active people the account has. */
export async function testFloat(token: string): Promise<{ ok: true; people: number } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${FLOAT_API_BASE()}/people?active=1&per-page=1`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'Gnomon server (setup)' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Float didn’t accept this token.' };
    if (!res.ok) return { ok: false, error: `Float answered ${res.status}.` };
    const total = Number(res.headers.get('x-pagination-total-count'));
    const body = await res.json().catch(() => []);
    return { ok: true, people: Number.isFinite(total) && total > 0 ? total : Array.isArray(body) ? body.length : 0 };
  } catch {
    return { ok: false, error: 'Float couldn’t be reached from this server.' };
  }
}

/** Read-only check of Personio API credentials: people and absence types. */
export async function testPersonio(clientId: string, clientSecret: string): Promise<
  { ok: true; people: number; morePeople: boolean; absenceTypes: { id: string; name: string; unit?: string }[] } | { ok: false; error: string }
> {
  try {
    const base = PERSONIO_API_BASE();
    const tokenRes = await fetch(`${base}/v2/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    const tok = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tokenRes.ok || !tok.access_token) return { ok: false, error: 'Personio didn’t accept the client ID and secret.' };
    const get = async (p: string) => {
      const r = await fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
      if (r.status === 403) throw new Error('forbidden');
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as { _data?: unknown[]; _meta?: { links?: { next?: { href?: string } } } };
    };
    const persons = await get('/v2/persons?limit=50');
    const types = await get('/v2/absence-types?limit=100').catch(() => ({ _data: [] }));
    return {
      ok: true,
      people: persons._data?.length ?? 0,
      morePeople: Boolean(persons._meta?.links?.next?.href),
      absenceTypes: ((types._data ?? []) as { id: string; name: string; unit?: string }[]).map((t) => ({ id: String(t.id), name: String(t.name), unit: t.unit })),
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message === 'forbidden' ? 'The credentials work but can’t read employees or absences. Give them read access to both.' : 'Personio couldn’t be reached from this server.' };
  }
}

// ---- The settings profile for Iru -----------------------------------------------------------------

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const uuidFrom = (seed: string) => {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`.toUpperCase();
};

/**
 * A macOS configuration profile with Gnomon's managed settings (domain app.gnomon.timetracker). Addresses, switches
 * and defaults only, never secrets: people can read profiles on their Mac. Stable UUIDs, so re-downloading and
 * re-uploading to Iru replaces the profile instead of adding a second one.
 */
export function mobileconfig(c: CompanyConfig): string {
  const host = c.company.publicUrl.replace(/^https?:\/\//, '') || 'gnomon';
  const id = `app.gnomon.profile.${host.replace(/[^a-z0-9.-]/gi, '-')}`;
  const name = c.company.name ? `Gnomon (${c.company.name})` : 'Gnomon';
  const entry = (k: string, v: string | boolean | number) =>
    `      <key>${k}</key>\n      ${typeof v === 'boolean' ? (v ? '<true/>' : '<false/>') : typeof v === 'number' ? `<real>${v}</real>` : `<string>${xml(v)}</string>`}`;
  const settings = [
    entry('PayloadType', 'app.gnomon.timetracker'),
    entry('PayloadIdentifier', `${id}.settings`),
    entry('PayloadUUID', uuidFrom(`${id}.settings`)),
    `      <key>PayloadVersion</key>\n      <integer>1</integer>`,
    entry('serverUrl', c.company.publicUrl),
    entry('managed', c.rules.managed),
    // Until company sign-in exists, people connect with an invitation link from the Admin page.
    entry('signIn', 'invite'),
    entry('allowLocalApi', c.rules.allowLocalApi),
    entry('allowActivityTrail', c.rules.allowActivityTrail),
    entry('dailyTargetHours', c.company.dailyTargetHours),
    entry('language', c.company.language),
    ...(c.company.name ? [entry('companyName', c.company.name)] : []),
  ].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadDisplayName</key>
  <string>${xml(name)}</string>
  <key>PayloadDescription</key>
  <string>Connects Gnomon to ${xml(host)} and sets your company's rules.</string>
  <key>PayloadIdentifier</key>
  <string>${xml(id)}</string>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${uuidFrom(id)}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
  <key>PayloadContent</key>
  <array>
    <dict>
${settings}
    </dict>
  </array>
</dict>
</plist>
`;
}
