// The web app's sign-in page: email and password of the account on this server.
import { useState, type FormEvent } from 'react';
import { t, useLanguage } from '../i18n';
import { signIn } from './bridge';
import logo from '../assets/app-icon.png';

export default function SignIn({ onSignedIn, unreachable = false }: { onSignedIn: () => void; unreachable?: boolean }) {
  useLanguage('system');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(unreachable ? t('web.offline') : null);
  const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      onSignedIn();
    } catch (err) {
      setError((err as Error).message === 'unreachable' ? t('web.offline') : (err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="web-signin">
      <form className="card web-signin-card" onSubmit={submit}>
        <img src={logo} alt="" width={56} height={56} />
        <h2>{t('web.title')}</h2>
        <p className="muted small">{t('web.intro')}</p>
        <label className="field">
          <span>{t('acc.email')}</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>{t('acc.password')}</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary big" type="submit" disabled={busy}>
          {busy ? t('acc.busy') : t('acc.signIn')}
        </button>
        <p className="small web-signin-links">
          {/* TODO: password reset is being built (email server, step 3 of docs/accounts-design.md); keep this link
              in step with the route it ends up on. */}
          <a href="/account/reset">{t('web.forgot')}</a>
          <a href="/account/register">{t('web.noAccount')}</a>
        </p>
        {phone && (
          <p className="small web-signin-links">
            {t('web.phone')} <a href="/">{t('web.openPhone')}</a>
          </p>
        )}
      </form>
    </main>
  );
}
