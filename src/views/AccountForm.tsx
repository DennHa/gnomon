// Signing in to a Gnomon account, or creating one (docs/accounts-design.md, section 3). Used by the first screen and
// by Settings → Account. The server's address comes from the company profile when there is one; otherwise it's asked,
// with a hint for people without a server. A pairing code from another device stays as a third way.
import { useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../icons';
import { t, type MsgKey } from '../i18n';

const ERRORS = ['bad_url', 'unreachable', 'wrong_login', 'invite_only', 'invalid_code', 'no_code'];
const errorText = (code: string) => (ERRORS.includes(code) ? t(`acc.err.${code}` as MsgKey) : code);

export default function AccountForm({ onDone }: { onDone: () => void }) {
  const { profile, refreshServer } = useStore();
  const preset = profile?.serverUrl;
  const [mode, setMode] = useState<'signin' | 'register' | 'code'>('signin');
  const [url, setUrl] = useState(preset ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // An invitation link (https://server/account/register#invite=CODE) carries the server too.
  const fromLink = (() => {
    try {
      const u = new URL(invite.trim());
      return u.hash.includes('invite=') ? u.origin : null;
    } catch {
      return null;
    }
  })();
  const server = preset ?? fromLink ?? url;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'register' && password !== repeat) return setError(t('acc.mismatch'));
    if (mode === 'register' && password.length < 10) return setError(t('acc.short'));
    setBusy(true);
    const r =
      mode === 'signin'
        ? await window.api.serverSignIn(server, email, password)
        : mode === 'register'
          ? await window.api.serverRegister({ url: server, invite: invite.trim() || undefined, name, email, password })
          : await window.api.serverConnect(url, code);
    setBusy(false);
    if (!r.ok) return setError(errorText(r.error));
    setError(null);
    if ('pending' in r && r.pending) return setPending(true);
    await refreshServer(); // starts the first sync
    onDone();
  };

  // A forgotten password is reset on the server's account page, in the browser (the link comes by email).
  const forgot = () => {
    const base = server.trim().replace(/\/+$/, '');
    window.api.openLink(`${/^https?:\/\//i.test(base) ? base : `https://${base}`}/account/forgot`);
  };

  if (pending) return <p className="acc-note">{t('acc.pending')}</p>;
  const tab = (m: typeof mode, label: MsgKey) => (
    <button type="button" className={mode === m ? 'active' : ''} onClick={() => (setMode(m), setError(null))}>
      {t(label)}
    </button>
  );
  return (
    <form className="acc-form" onSubmit={submit}>
      <div className="segmented">
        {tab('signin', 'acc.signIn')}
        {tab('register', 'acc.register')}
      </div>
      {!preset && mode !== 'code' && !fromLink && (
        <label className="field">
          <span>{t('acc.server')}</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://gnomon.example.com" spellCheck={false} />
        </label>
      )}
      {mode === 'register' && (
        <>
          <label className="field">
            <span>{t('acc.invite')}</span>
            <input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder={t('acc.invitePlaceholder')} spellCheck={false} />
          </label>
          <label className="field">
            <span>{t('acc.name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
        </>
      )}
      {mode !== 'code' && (
        <>
          <label className="field">
            <span>{t('acc.email')}</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </label>
          <label className="field">
            <span>{t('acc.password')}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
          </label>
        </>
      )}
      {mode === 'register' && (
        <label className="field">
          <span>{t('acc.repeat')}</span>
          <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
        </label>
      )}
      {mode === 'code' && (
        <>
          <label className="field">
            <span>{t('acc.server')}</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://gnomon.example.com" spellCheck={false} />
          </label>
          <label className="field">
            <span>{t('acc.code')}</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH" spellCheck={false} />
          </label>
        </>
      )}
      {error && <p className="error small">{error}</p>}
      <div className="add-row">
        <button className="btn primary" disabled={busy || !server.trim() || (mode === 'code' ? !code.trim() : !email.trim() || !password || (mode === 'register' && !name.trim()))}>
          <Icon name="login" size={18} /> {busy ? t('acc.busy') : t(mode === 'register' ? 'acc.create' : mode === 'code' ? 'acc.connect' : 'acc.signIn')}
        </button>
        {mode === 'signin' && (
          <button type="button" className="link-btn muted small" disabled={!server.trim()} onClick={forgot}>
            {t('acc.forgot')}
          </button>
        )}
        {mode !== 'code' && (
          <button type="button" className="link-btn muted small" onClick={() => (setMode('code'), setError(null))}>
            {t('acc.useCode')}
          </button>
        )}
      </div>
      {!preset && <p className="muted small">{t('acc.noServer')}</p>}
    </form>
  );
}
