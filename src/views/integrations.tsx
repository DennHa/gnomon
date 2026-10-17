// Connect flows for Float and Personio, shared by Settings and the first-launch guide (Onboarding).
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { fetchPeople, type FloatPerson } from '../float';
import { findPerson } from '../personio';
import { Icon } from '../icons';
import type { Settings as S } from '../types';
import { locale, t } from '../i18n';

/** Token → choose yourself → synced. `showIntro` is off in the guide, which explains Float in its own words. */
export function FloatConnect({ showIntro = true }: { showIntro?: boolean }) {
  const { data, update, floatSync, runFloatSync } = useStore();
  const s = data.settings;
  const [hasToken, setHasToken] = useState(false);
  const [token, setToken] = useState('');
  const [people, setPeople] = useState<FloatPerson[] | null>(null);
  const [status, setStatus] = useState<{ busy?: boolean; error?: string }>({});
  const set = (p: Partial<S>) => update((d) => ({ ...d, settings: { ...d.settings, ...p } }));

  useEffect(() => {
    window.api.floatHasToken().then(setHasToken);
  }, []);

  const loadPeople = async () => {
    setStatus({ busy: true });
    try {
      setPeople(await fetchPeople());
      setStatus({});
    } catch (err) {
      setStatus({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  const connect = async () => {
    await window.api.floatSetToken(token);
    setToken('');
    setHasToken(true);
    await loadPeople();
  };

  const choosePerson = (id: number) => {
    const p = people?.find((x) => x.people_id === id);
    if (!p) return;
    set({ floatPersonId: p.people_id, floatPersonName: p.name, floatEmail: p.email ?? undefined, floatRegionId: p.region_id ?? undefined, floatLastSync: undefined });
    setPeople(null);
    // Give the settings update a moment to land before syncing with the new person.
    setTimeout(runFloatSync, 50);
  };

  const disconnect = async () => {
    if (!confirm(t('float.disconnectConfirm'))) return;
    await window.api.floatSetToken(null);
    setHasToken(false);
    setPeople(null);
    update((d) => ({
      ...d,
      plan: [],
      workdays: d.workdays.filter((w) => w.offSource !== 'float'),
      settings: { ...d.settings, floatPersonId: undefined, floatPersonName: undefined, floatEmail: undefined, floatRegionId: undefined, floatLastSync: undefined },
    }));
  };

  return (
    <>
      {!hasToken ? (
        <>
          {showIntro && <p className="muted">{t('float.intro')}</p>}
          <form className="add-row" onSubmit={(e) => (e.preventDefault(), token.trim() && connect())}>
            <input type="password" placeholder={t('float.tokenPlaceholder')} value={token} onChange={(e) => setToken(e.target.value)} />
            <button className="btn primary" type="submit" disabled={!token.trim()}>
              {t('float.connect')}
            </button>
          </form>
        </>
      ) : !s.floatPersonId || people ? (
        <>
          <p className="muted">{t('float.whoAreYou')}</p>
          {!people && !status.busy && (
            <button className="btn" onClick={loadPeople}>
              {t('float.loadPeople')}
            </button>
          )}
          {people && (
            <label className="field">
              <span>{t('float.youAre')}</span>
              <select value={s.floatPersonId ?? ''} onChange={(e) => choosePerson(Number(e.target.value))}>
                <option value="" disabled>
                  {t('float.chooseYourself')}
                </option>
                {people.map((p) => (
                  <option key={p.people_id} value={p.people_id}>
                    {p.name}
                    {p.email ? ` (${p.email})` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="link" onClick={disconnect}>
            {t('float.disconnect')}
          </button>
        </>
      ) : (
        <>
          <p>
            {t('float.connectedAs')}
            <strong>{s.floatPersonName}</strong>.{' '}
            <button className="link" onClick={loadPeople}>
              {t('float.change')}
            </button>{' '}
            ·{' '}
            <button className="link" onClick={disconnect}>
              {t('float.disconnect')}
            </button>
          </p>
          <div className="add-row">
            <button className="btn primary" onClick={runFloatSync} disabled={floatSync.busy}>
              {t(floatSync.busy ? 'float.syncing' : 'float.syncNow')}
            </button>
            <span className="muted small">
              {floatSync.message ?? (s.floatLastSync ? t('float.lastSync', { date: new Date(s.floatLastSync).toLocaleString(locale()) }) : t('float.notSynced'))}
            </span>
          </div>
          <p className="muted small">{t('float.autoSync')}</p>
        </>
      )}
      {status.busy && <p className="muted small">{t('float.loadingPeople')}</p>}
      {(status.error || floatSync.error) && <p className="error">{status.error ?? floatSync.error}</p>}
    </>
  );
}

/** Client ID + secret + your email → the matching Personio person → absences synced as days off. */
export function PersonioConnect({ showIntro = true }: { showIntro?: boolean }) {
  const { data, update, personioSync, runPersonioSync } = useStore();
  const s = data.settings;
  const [hasCreds, setHasCreds] = useState(false);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [email, setEmail] = useState(s.personioEmail ?? s.floatEmail ?? '');
  const [status, setStatus] = useState<{ busy?: boolean; error?: string }>({});

  useEffect(() => {
    window.api.personioHasCredentials().then(setHasCreds);
  }, []);

  const connect = async () => {
    setStatus({ busy: true });
    try {
      if (clientId.trim() && secret.trim()) {
        await window.api.personioSetCredentials({ clientId, clientSecret: secret });
        setHasCreds(true);
        setClientId('');
        setSecret('');
      }
      const person = await findPerson(email);
      if (!person) return setStatus({ error: t('personio.notFound', { email: email.trim() }) });
      update((d) => ({
        ...d,
        settings: { ...d.settings, personioEmail: email.trim(), personioPersonId: person.id, personioPersonName: person.name, personioLastSync: undefined },
      }));
      setStatus({});
      setTimeout(runPersonioSync, 50);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Rejected credentials are dropped again, so the fields come back to fix them.
      if (message === t('personio.badCredentials')) {
        await window.api.personioSetCredentials(null);
        setHasCreds(false);
      }
      setStatus({ error: message });
    }
  };

  const disconnect = async () => {
    if (!confirm(t('personio.disconnectConfirm'))) return;
    await window.api.personioSetCredentials(null);
    setHasCreds(false);
    update((d) => ({
      ...d,
      workdays: d.workdays.filter((w) => w.offSource !== 'personio'),
      settings: { ...d.settings, personioPersonId: undefined, personioPersonName: undefined, personioLastSync: undefined },
    }));
  };

  const connected = hasCreds && s.personioPersonId;
  return (
    <>
      {showIntro && !connected && <p className="muted">{t('personio.intro')}</p>}
      {!connected ? (
        <form className="stack-form" onSubmit={(e) => (e.preventDefault(), connect())}>
          <p className="muted small">{t('personio.adminHint')}</p>
          {!hasCreds && (
            <>
              <label className="field">
                <span>{t('personio.clientId')}</span>
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} spellCheck={false} autoComplete="off" />
              </label>
              <label className="field">
                <span>{t('personio.clientSecret')}</span>
                <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
              </label>
            </>
          )}
          <label className="field">
            <span>{t('personio.email')}</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" spellCheck={false} />
          </label>
          <div className="add-row">
            <button className="btn primary" type="submit" disabled={status.busy || !email.includes('@') || (!hasCreds && (!clientId.trim() || !secret.trim()))}>
              <Icon name="link" size={18} /> {t(status.busy ? 'personio.connecting' : 'personio.connect')}
            </button>
            {hasCreds && (
              <button className="link" type="button" onClick={disconnect}>
                {t('personio.disconnect')}
              </button>
            )}
          </div>
        </form>
      ) : (
        <>
          <p>
            {t('personio.connectedAs')}
            <strong>{s.personioPersonName}</strong>
            {s.personioEmail ? <span className="muted"> ({s.personioEmail})</span> : null}.{' '}
            <button className="link" onClick={disconnect}>
              {t('personio.disconnect')}
            </button>
          </p>
          <div className="add-row">
            <button className="btn primary" onClick={runPersonioSync} disabled={personioSync.busy}>
              {t(personioSync.busy ? 'personio.syncing' : 'personio.syncNow')}
            </button>
            <span className="muted small">
              {personioSync.message ?? (s.personioLastSync ? t('float.lastSync', { date: new Date(s.personioLastSync).toLocaleString(locale()) }) : t('float.notSynced'))}
            </span>
          </div>
          <p className="muted small">{t('personio.autoSync')}</p>
        </>
      )}
      {(status.error || personioSync.error) && <p className="error">{status.error ?? personioSync.error}</p>}
    </>
  );
}

/** Weblog's API isn't known yet: an honest placeholder, no fake integration. */
export function WeblogInfo() {
  return (
    <div className="soon-box">
      <span className="soon-badge">
        <Icon name="hourglass_top" size={16} /> {t('onb.weblogSoon')}
      </span>
      <p className="small">{t('onb.weblogSoonText')}</p>
      <button className="btn small" onClick={() => window.api.openFeedback()}>
        <Icon name="mail" size={16} /> {t('onb.weblogFeedback')}
      </button>
    </div>
  );
}
