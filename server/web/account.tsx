// Everyone's own account on a Gnomon server (docs/accounts-design.md, section 3), separate from the Admin page:
// /account/register signs up (with an invitation link, or as the server allows); /account is your name, email,
// password and devices; /account/forgot and /account/reset set a new password by email. Nobody else's data, no settings. Sessions stay in this tab only.
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon } from './icons';
import './styles.css';
import './admin.css';

const EN = {
  title: 'Your Gnomon account',
  registerTitle: 'Create your account',
  registerIntro: 'One account for Gnomon on your Mac, your phone and the web.',
  inviteFor: 'Invitation for {email}',
  inviteBad: 'This invitation is wrong, used or expired. Ask for a new one.',
  inviteOnly: 'This server only takes invited people. Ask its admin for an invitation link.',
  approvalNote: 'An admin approves new accounts on this server before they work.',
  name: 'Your name',
  email: 'Email',
  password: 'Password',
  passwordNew: 'New password',
  passwordRepeat: 'Repeat it',
  passwordHint: 'At least 10 characters.',
  mismatch: 'The two passwords don’t match.',
  create: 'Create account',
  pending: 'Thanks! Your account waits for an admin’s approval. You’ll be able to sign in once it’s approved.',
  ready: 'Your account is ready.',
  readyMac: 'On your Mac: open Gnomon, choose “With an account” (or Settings → Account) and sign in with this email and password.',
  readyPhone: 'On your phone: open this server’s address in the browser and sign in the same way.',
  toAccount: 'Go to your account',
  signInTitle: 'Sign in',
  signIn: 'Sign in',
  noAccount: 'No account yet?',
  register: 'Create one',
  you: 'You',
  save: 'Save',
  saved: 'Saved.',
  emailChange: 'To change your email, enter your password too.',
  currentPassword: 'Current password',
  passwordTitle: 'Password',
  devicesTitle: 'Your devices',
  devicesNone: 'No device signed in yet.',
  lastSeen: 'last seen {when}',
  never: 'not used yet',
  remove: 'Sign out',
  removeConfirm: 'Sign {name} out? It stops syncing until you sign in on it again.',
  signOut: 'Sign out of this page',
  everywhere: 'Sign out everywhere',
  everywhereConfirm: 'Sign out of every device and browser? You’ll have to sign in again everywhere.',
  admin: 'Open the Admin page',
  noServer: 'No server? Gnomon also works on a Mac alone, or you can run your own.',
  mac: 'Mac',
  phone: 'Phone',
  web: 'Browser',
  forgot: 'Forgot your password?',
  forgotTitle: 'Reset your password',
  forgotIntro: 'Enter your account’s email. We’ll send you a link to set a new password.',
  forgotSend: 'Send link',
  forgotSent: 'If there’s an account for {email}, a link is on its way. It works once, for 30 minutes. Check your spam folder too.',
  backToSignIn: 'Back to sign in',
  resetTitle: 'Set a new password',
  resetFor: 'For {email}',
  resetBad: 'This link is wrong, used or expired.',
  resetAgain: 'Ask for a new link',
  resetOthers: 'Also sign out on all my other devices',
  resetOthersHint: 'Do this if someone else might know your old password.',
  resetSave: 'Save new password',
  resetDone: 'Your new password is set.',
};
type Key = keyof typeof EN;
const DE: Record<Key, string> = {
  title: 'Dein Gnomon-Konto',
  registerTitle: 'Konto anlegen',
  registerIntro: 'Ein Konto für Gnomon auf deinem Mac, deinem Handy und im Web.',
  inviteFor: 'Einladung für {email}',
  inviteBad: 'Diese Einladung ist falsch, schon benutzt oder abgelaufen. Bitte um eine neue.',
  inviteOnly: 'Dieser Server nimmt nur eingeladene Personen auf. Bitte die Verwaltung um einen Einladungslink.',
  approvalNote: 'Neue Konten auf diesem Server werden erst nach Freigabe durch die Verwaltung aktiv.',
  name: 'Dein Name',
  email: 'E-Mail',
  password: 'Passwort',
  passwordNew: 'Neues Passwort',
  passwordRepeat: 'Wiederholen',
  passwordHint: 'Mindestens 10 Zeichen.',
  mismatch: 'Die beiden Passwörter stimmen nicht überein.',
  create: 'Konto anlegen',
  pending: 'Danke! Dein Konto wartet auf die Freigabe. Sobald es freigegeben ist, kannst du dich anmelden.',
  ready: 'Dein Konto ist bereit.',
  readyMac: 'Auf deinem Mac: Gnomon öffnen, „Mit Konto“ wählen (oder Einstellungen → Konto) und mit dieser E-Mail und diesem Passwort anmelden.',
  readyPhone: 'Auf deinem Handy: die Adresse dieses Servers im Browser öffnen und genauso anmelden.',
  toAccount: 'Zu deinem Konto',
  signInTitle: 'Anmelden',
  signIn: 'Anmelden',
  noAccount: 'Noch kein Konto?',
  register: 'Anlegen',
  you: 'Du',
  save: 'Sichern',
  saved: 'Gesichert.',
  emailChange: 'Um deine E-Mail zu ändern, gib auch dein Passwort ein.',
  currentPassword: 'Aktuelles Passwort',
  passwordTitle: 'Passwort',
  devicesTitle: 'Deine Geräte',
  devicesNone: 'Noch kein Gerät angemeldet.',
  lastSeen: 'zuletzt aktiv {when}',
  never: 'noch nicht benutzt',
  remove: 'Abmelden',
  removeConfirm: '{name} abmelden? Es synchronisiert nicht mehr, bis du dich dort wieder anmeldest.',
  signOut: 'Von dieser Seite abmelden',
  everywhere: 'Überall abmelden',
  everywhereConfirm: 'Von allen Geräten und Browsern abmelden? Du musst dich überall neu anmelden.',
  admin: 'Verwaltung öffnen',
  noServer: 'Kein Server? Gnomon funktioniert auch allein auf dem Mac, oder du betreibst einen eigenen.',
  mac: 'Mac',
  phone: 'Handy',
  web: 'Browser',
  forgot: 'Passwort vergessen?',
  forgotTitle: 'Passwort zurücksetzen',
  forgotIntro: 'Gib die E-Mail deines Kontos ein. Wir senden dir einen Link für ein neues Passwort.',
  forgotSend: 'Link senden',
  forgotSent: 'Falls es ein Konto für {email} gibt, ist ein Link unterwegs. Er funktioniert einmal, 30 Minuten lang. Schau auch im Spam-Ordner nach.',
  backToSignIn: 'Zurück zur Anmeldung',
  resetTitle: 'Neues Passwort festlegen',
  resetFor: 'Für {email}',
  resetBad: 'Dieser Link ist falsch, schon benutzt oder abgelaufen.',
  resetAgain: 'Neuen Link anfordern',
  resetOthers: 'Auch auf allen anderen Geräten abmelden',
  resetOthersHint: 'Mach das, wenn jemand anderes dein altes Passwort kennen könnte.',
  resetSave: 'Neues Passwort sichern',
  resetDone: 'Dein neues Passwort ist gesetzt.',
};
const L = /^de\b/i.test(navigator.language) ? DE : EN;
const t = (k: Key, vars: Record<string, string> = {}) => L[k].replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');

type Me = { me: { id: string; name: string; email: string | null; role: 'admin' | 'member' }; devices: { id: string; name: string; client: string | null; lastSeenAt: string | null }[] };

let token = '';
try {
  token = sessionStorage.getItem('gnomon.account') ?? '';
} catch {
  /* private mode */
}
const keep = (v: string) => {
  token = v;
  try {
    if (v) sessionStorage.setItem('gnomon.account', v);
    else sessionStorage.removeItem('gnomon.account');
  } catch {
    /* this tab only */
  }
};
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/account${path}`, {
    method,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message || res.statusText), { status: res.status });
  return json as T;
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => void (document.title = title), [title]);
  return (
    <main className="a-page a-account">
      <header className="a-head">
        <img src="/icon-192.png" alt="" width={44} height={44} />
        <div>
          <h1>{title}</h1>
          <span className="a-hint">{location.host}</span>
        </div>
      </header>
      {children}
    </main>
  );
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="a-field">
      <span className="a-label">{label}</span>
      {children}
      {hint && <span className="a-hint">{hint}</span>}
    </label>
  );
}
const Err = ({ e }: { e: string | null }) =>
  e ? (
    <p className="a-error">
      <Icon name="warning" size={18} /> {e}
    </p>
  ) : null;

// ---- /account/register ------------------------------------------------------------------------

function Register() {
  const invite = new URLSearchParams(location.hash.slice(1)).get('invite') ?? '';
  const [mode, setMode] = useState<'invite' | 'approval' | 'open' | null>(null);
  const [invited, setInvited] = useState<{ email: string | null; name: string } | null>(null);
  const [bad, setBad] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'ready' | 'pending' | null>(null);
  useEffect(() => {
    call<{ registration: 'invite' | 'approval' | 'open' }>('GET', '/config').then((c) => setMode(c.registration), () => setMode('invite'));
    if (invite)
      call<{ email: string | null; name: string }>('GET', `/invite/${encodeURIComponent(invite)}`).then(
        (r) => (setInvited(r), setName(r.name)),
        () => setBad(true),
      );
  }, []);
  if (done)
    return (
      <Page title={t('registerTitle')}>
        <section className="a-panel">
          {done === 'pending' ? (
            <p className="a-intro">{t('pending')}</p>
          ) : (
            <>
              <div className="a-ok">
                <Icon name="check_circle" /> {t('ready')}
              </div>
              <ol className="a-steps-list">
                <li>{t('readyMac')}</li>
                <li>{t('readyPhone')}</li>
              </ol>
              <a className="primary a-button" href="/account">
                {t('toAccount')}
              </a>
            </>
          )}
        </section>
      </Page>
    );
  const closed = !invite && mode === 'invite';
  return (
    <Page title={t('registerTitle')}>
      <form
        className="a-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          if (a.length < 10) return setErr(t('passwordHint'));
          if (a !== b) return setErr(t('mismatch'));
          setBusy(true);
          try {
            const r = await call<{ pending?: boolean; token?: string }>('POST', '/register', { invite: invite || undefined, name, email: invited?.email ?? email, password: a });
            if (r.token) keep(r.token);
            setDone(r.pending ? 'pending' : 'ready');
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="a-intro">{t('registerIntro')}</p>
        {bad && <p className="a-warn">{t('inviteBad')}</p>}
        {closed && <p className="a-warn">{t('inviteOnly')}</p>}
        {!invite && mode === 'approval' && <p className="a-hint">{t('approvalNote')}</p>}
        <Err e={err} />
        {!bad && !closed && mode && (
          <>
            {invited?.email ? (
              <div className="a-card">
                <span className="a-hint">{t('inviteFor', { email: invited.email })}</span>
              </div>
            ) : (
              <Field label={t('email')}>
                <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            )}
            <Field label={t('name')}>
              <input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('password')} hint={t('passwordHint')}>
              <input type="password" autoComplete="new-password" required value={a} onChange={(e) => setA(e.target.value)} />
            </Field>
            <Field label={t('passwordRepeat')}>
              <input type="password" autoComplete="new-password" required value={b} onChange={(e) => setB(e.target.value)} />
            </Field>
            <button className="primary a-save" disabled={busy}>
              {t('create')}
            </button>
          </>
        )}
        <p className="a-hint">{t('noServer')}</p>
      </form>
    </Page>
  );
}

// ---- /account ---------------------------------------------------------------------------------

function SignIn({ onIn }: { onIn: (m: Me) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Page title={t('title')}>
      <form
        className="a-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await call<Me & { token: string }>('POST', '/login', { email, password });
            keep(r.token);
            onIn(r);
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        <h2>
          <Icon name="lock" size={22} /> {t('signInTitle')}
        </h2>
        <Err e={err} />
        <Field label={t('email')}>
          <input type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('password')}>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <footer className="a-foot">
          <span className="a-hint">
            <a href="/account/forgot">{t('forgot')}</a>
            <br />
            {t('noAccount')} <a href="/account/register">{t('register')}</a>
          </span>
          <span className="spacer" />
          <button className="primary">{t('signIn')}</button>
        </footer>
      </form>
    </Page>
  );
}

// ---- /account/forgot and /account/reset ---------------------------------------------------------

function Forgot() {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Page title={t('forgotTitle')}>
      <form
        className="a-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await call('POST', '/forgot', { email });
            setErr(null);
            setSent(email.trim());
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {sent ? (
          <div className="a-ok">
            <Icon name="check_circle" /> {t('forgotSent', { email: sent })}
          </div>
        ) : (
          <>
            <p className="a-intro">{t('forgotIntro')}</p>
            <Err e={err} />
            <Field label={t('email')}>
              <input type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </>
        )}
        <footer className="a-foot">
          <a className="a-hint" href="/account">
            {t('backToSignIn')}
          </a>
          <span className="spacer" />
          {!sent && (
            <button className="primary" disabled={busy}>
              {t('forgotSend')}
            </button>
          )}
        </footer>
      </form>
    </Page>
  );
}

// The token comes in the link's #fragment (never sent to the server in a URL); it's taken out of the address bar at once.
const RESET_TOKEN = /^\/account\/reset\/?$/.test(location.pathname) ? (new URLSearchParams(location.hash.slice(1)).get('token') ?? '') : '';
if (RESET_TOKEN) history.replaceState(null, '', location.pathname);

function Reset() {
  const [email, setEmail] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [others, setOthers] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!RESET_TOKEN) return setBad(true);
    call<{ email: string }>('POST', '/reset/check', { token: RESET_TOKEN }).then(
      (r) => setEmail(r.email),
      () => setBad(true),
    );
  }, []);
  if (bad)
    return (
      <Page title={t('resetTitle')}>
        <section className="a-panel">
          <p className="a-warn">{t('resetBad')}</p>
          <a className="primary a-button" href="/account/forgot">
            {t('resetAgain')}
          </a>
        </section>
      </Page>
    );
  if (done)
    return (
      <Page title={t('resetTitle')}>
        <section className="a-panel">
          <div className="a-ok">
            <Icon name="check_circle" /> {t('resetDone')}
          </div>
          <a className="primary a-button" href="/account">
            {t('toAccount')}
          </a>
        </section>
      </Page>
    );
  return (
    <Page title={t('resetTitle')}>
      <form
        className="a-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          if (a.length < 10) return setErr(t('passwordHint'));
          if (a !== b) return setErr(t('mismatch'));
          setBusy(true);
          try {
            const r = await call<{ token: string }>('POST', '/reset', { token: RESET_TOKEN, password: a, signOutOthers: others });
            keep(r.token);
            setDone(true);
          } catch (e) {
            if ((e as { status?: number }).status === 404) setBad(true);
            else setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {email && <span className="a-hint">{t('resetFor', { email })}</span>}
        <Err e={err} />
        <Field label={t('passwordNew')} hint={t('passwordHint')}>
          <input type="password" autoComplete="new-password" autoFocus required value={a} onChange={(e) => setA(e.target.value)} />
        </Field>
        <Field label={t('passwordRepeat')}>
          <input type="password" autoComplete="new-password" required value={b} onChange={(e) => setB(e.target.value)} />
        </Field>
        <label className="a-check">
          <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} />
          <span>
            <strong>{t('resetOthers')}</strong>
            <span className="a-hint">{t('resetOthersHint')}</span>
          </span>
        </label>
        <button className="primary a-save" disabled={busy || !email}>
          {t('resetSave')}
        </button>
      </form>
    </Page>
  );
}

const ago = (iso: string | null) => {
  if (!iso) return t('never');
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return t('lastSeen', { when: min < 2 ? '·' : min < 60 ? `${min} min` : min < 2880 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d` });
};

function Account({ m, setM }: { m: Me; setM: (m: Me) => void }) {
  const [name, setName] = useState(m.me.name);
  const [email, setEmail] = useState(m.me.email ?? '');
  const [pw, setPw] = useState('');
  const [cur, setCur] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const run = async (fn: () => Promise<Me | void>, msg = t('saved')) => {
    try {
      setErr(null);
      const r = await fn();
      if (r) setM(r);
      setOk(msg);
    } catch (e) {
      setOk(null);
      setErr((e as Error).message);
    }
  };
  const emailChanged = email.trim().toLowerCase() !== (m.me.email ?? '');
  const kind = (c: string | null): Key => (c === 'mac' ? 'mac' : c === 'phone' ? 'phone' : 'web');
  return (
    <Page title={t('title')}>
      <section className="a-panel">
        <Err e={err} />
        {ok && (
          <div className="a-ok">
            <Icon name="check_circle" /> {ok}
          </div>
        )}
        <form className="a-card" onSubmit={(e) => (e.preventDefault(), void run(() => call<Me>('PATCH', '/me', { name, email, ...(emailChanged && { password: pw }) })))}>
          <strong>
            <Icon name="person" size={18} /> {t('you')}
          </strong>
          <div className="a-row">
            <Field label={t('name')}>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('email')}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
          {emailChanged && (
            <Field label={t('password')} hint={t('emailChange')}>
              <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
          )}
          <button className="primary a-save">{t('save')}</button>
        </form>
        <form
          className="a-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (a.length < 10) return setErr(t('passwordHint'));
            if (a !== b) return setErr(t('mismatch'));
            void run(async () => {
              const r = await call<Me>('POST', '/password', { current: cur, password: a });
              setCur('');
              setA('');
              setB('');
              return r;
            });
          }}
        >
          <strong>
            <Icon name="lock" size={18} /> {t('passwordTitle')}
          </strong>
          <Field label={t('currentPassword')}>
            <input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
          </Field>
          <div className="a-row">
            <Field label={t('passwordNew')} hint={t('passwordHint')}>
              <input type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} />
            </Field>
            <Field label={t('passwordRepeat')}>
              <input type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
            </Field>
          </div>
          <button className="primary a-save" disabled={!cur || !a || !b}>
            {t('save')}
          </button>
        </form>
        <div className="a-card">
          <strong>
            <Icon name="devices" size={18} /> {t('devicesTitle')}
          </strong>
          {m.devices.length === 0 && <span className="a-hint">{t('devicesNone')}</span>}
          <ul className="a-devices">
            {m.devices.map((d) => (
              <li key={d.id} className="a-device">
                <span className="a-device-icon">
                  <Icon name={d.client === 'mac' ? 'laptop_mac' : d.client === 'phone' ? 'mobile' : 'language'} size={20} />
                </span>
                <div className="a-device-main">
                  <strong>{d.name}</strong>
                  <span className="a-hint">
                    {t(kind(d.client))} · {ago(d.lastSeenAt)}
                  </span>
                </div>
                <button className="soft" onClick={() => confirm(t('removeConfirm', { name: d.name })) && void run(() => call<Me>('DELETE', `/devices/${d.id}`))}>
                  {t('remove')}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <footer className="a-foot">
          {m.me.role === 'admin' && (
            <a className="soft a-button" href="/admin">
              <Icon name="lock" size={18} /> {t('admin')}
            </a>
          )}
          <span className="spacer" />
          <button
            className="soft danger"
            onClick={async () => {
              if (!confirm(t('everywhereConfirm'))) return;
              await call('POST', '/signout-everywhere').catch(() => {});
              keep('');
              location.replace('/account');
            }}
          >
            {t('everywhere')}
          </button>
          <button
            className="soft"
            onClick={async () => {
              await call('DELETE', '/session').catch(() => {});
              keep('');
              location.replace('/account');
            }}
          >
            {t('signOut')}
          </button>
        </footer>
      </section>
    </Page>
  );
}

function AccountApp() {
  const [m, setM] = useState<Me | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  useEffect(() => {
    document.title = t('title');
    const code = new URLSearchParams(location.hash.slice(1)).get('code');
    (async () => {
      try {
        if (code) {
          history.replaceState(null, '', location.pathname);
          const r = await call<Me & { token: string }>('POST', '/session', { code });
          keep(r.token);
          setM(r);
        } else if (token) setM(await call<Me>('GET', '/me'));
        else setNeedLogin(true);
      } catch {
        keep('');
        setNeedLogin(true);
      }
    })();
  }, []);
  if (m) return <Account m={m} setM={setM} />;
  if (needLogin) return <SignIn onIn={setM} />;
  return <Page title={t('title')}>{null}</Page>;
}

const route = location.pathname.replace(/\/+$/, '');
createRoot(document.getElementById('root')!).render(route === '/account/register' ? <Register /> : route === '/account/forgot' ? <Forgot /> : route === '/account/reset' ? <Reset /> : <AccountApp />);
