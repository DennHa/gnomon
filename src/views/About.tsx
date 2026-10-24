// Info & feedback: version, update check, feedback, what's new (CHANGELOG.md, plus a link to the server's /roadmap) and
// the open-source projects used.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { Burst } from '../motion';
import { Icon } from '../icons';
import { locale, t } from '../i18n';
import type { FeedbackThread } from '../global';
import changelog from '../../CHANGELOG.md?raw';
import credits from '../credits.json';
import appIcon from '../assets/app-icon.png';
import { isWeb } from '../platform';

type Info = Awaited<ReturnType<Window['api']['appInfo']>>;
type Check = Awaited<ReturnType<Window['api']['checkUpdate']>>;

/** **bold** inside a line, as React nodes (no HTML from the file is ever injected). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>));
}

/** The version sections of CHANGELOG.md: "## 0.1.0 · date", a short line, then "- " bullets (continued on indented lines). */
function Changelog() {
  const sections = changelog.split(/^## /m).slice(1);
  return (
    <div className="changelog">
      {sections.map((sec) => {
        const [head, ...rest] = sec.split('\n');
        const items: string[] = [];
        const intro: string[] = [];
        for (const line of rest) {
          if (line.startsWith('- ')) items.push(line.slice(2));
          else if (/^\s+\S/.test(line) && items.length) items[items.length - 1] += ` ${line.trim()}`;
          else if (line.trim()) intro.push(line.trim());
        }
        return (
          <section key={head}>
            <h4>{head.trim()}</h4>
            {intro.length > 0 && <p className="muted">{inline(intro.join(' '))}</p>}
            <ul>
              {items.map((it) => (
                <li key={it}>{inline(it)}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Updates({ info }: { info: Info }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Check | null>(null);
  const check = async () => {
    setBusy(true);
    setResult(await window.api.checkUpdate());
    setBusy(false);
  };
  useEffect(() => {
    if (info.updateSource) check();
  }, [info.updateSource]);

  if (!info.updateSource) return <p className="muted small">{t('about.noSource')}</p>;
  return (
    <div className="about-update">
      {result?.ok && result.newer ? (
        <div className="update-box">
          <strong>{t('about.newer', { version: result.latest.version })}</strong>
          {result.latest.notes.length > 0 && (
            <ul>
              {result.latest.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <span className="add-row">
            {result.latest.download && (
              <button className="btn primary" onClick={() => window.api.openLink(result.latest.download!)}>
                <Icon name="arrow_forward" size={18} /> {t('about.download')}
              </button>
            )}
            {result.latest.page && (
              <button className="btn" onClick={() => window.api.openLink(result.latest.page!)}>
                {t('about.page')}
              </button>
            )}
          </span>
        </div>
      ) : (
        <span className="add-row">
          <button className="btn" onClick={check} disabled={busy}>
            <Icon name="sync" size={18} /> {busy ? t('about.checking') : t('about.check')}
          </button>
          {result?.ok && <span className="pos small">{t('about.upToDate')}</span>}
          {result && !result.ok && <span className="muted small">{t('about.failed', { error: result.error })}</span>}
        </span>
      )}
    </div>
  );
}

/**
 * Feedback as a small help desk: write here, it goes to the maker's Gnomon server, replies show up below (and as a
 * notification). Without a server to send to, the mail program opens instead.
 */
function FeedbackCard() {
  const { data } = useStore();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [text, setText] = useState('');
  const [withInfo, setWithInfo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threads, setThreads] = useState<FeedbackThread[]>([]);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const load = async () => {
    const list = await window.api.feedbackThreads();
    setThreads(list);
    // Showing them is reading them.
    for (const th of list) if (th.unread) void window.api.feedbackSeen(th.id, th.messages.filter((m) => m.author === 'admin').length);
  };
  useEffect(() => {
    window.api.feedbackAvailable().then((ok) => (setAvailable(ok), ok && void load()));
  }, []);
  const name = data.settings.userName?.trim();

  if (available === false)
    return (
      <section className="card onb-entry">
        <span className="onb-entry-text">
          <strong>{t('about.feedback')}</strong>
          <span className="muted small">{t('about.feedbackText')}</span>
        </span>
        <button className="btn" onClick={() => window.api.openFeedback()}>
          <Icon name="mail" size={18} /> {t('about.write')}
        </button>
      </section>
    );
  return (
    <section className="card feedback">
      <h3>{t('about.feedback')}</h3>
      <p className="muted small">{t('fb.intro')}</p>
      <textarea className="fb-text" rows={4} maxLength={5000} value={text} placeholder={t('fb.placeholder')} onChange={(e) => (setText(e.target.value), setSent(false))} />
      <div className="fb-row">
        <label className="check-row small">
          <input type="checkbox" checked={withInfo} onChange={(e) => setWithInfo(e.target.checked)} />
          <span>{name ? t('fb.withInfoName', { name }) : t('fb.withInfo')}</span>
        </label>
        <span className="spacer" />
        {sent && <span className="pos small">{t('fb.sent')}</span>}
        <button
          className="btn primary"
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            const r = await window.api.feedbackSend({ text, sender: name, withInfo });
            setBusy(false);
            if (!r.ok) return setError(r.error === 'unreachable' ? t('fb.offline') : r.error);
            setError(null);
            setText('');
            setSent(true);
            void load();
          }}
        >
          <Icon name="send" size={18} /> {t('fb.send')}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
      {threads.length > 0 && (
        <div className="fb-threads">
          <h4>{t('fb.yours')}</h4>
          {threads.map((th) => (
            <div key={th.id} className={`fb-thread ${th.unread ? 'unread' : ''}`}>
              {th.messages.map((m, i) => (
                <div key={i} className={`fb-msg ${m.author}`}>
                  <span className="fb-bubble">{m.text}</span>
                  <span className="muted small">
                    {m.author === 'admin' ? t('fb.answer') : t('fb.you')} · {new Date(m.at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
              {replyTo === th.id ? (
                <div className="fb-reply">
                  <textarea rows={2} maxLength={5000} autoFocus value={reply} onChange={(e) => setReply(e.target.value)} />
                  <button
                    className="btn small"
                    disabled={!reply.trim()}
                    onClick={async () => {
                      const r = await window.api.feedbackReply(th.id, reply);
                      if (!r.ok) return setError(r.error === 'unreachable' ? t('fb.offline') : r.error);
                      setReply('');
                      setReplyTo(null);
                      void load();
                    }}
                  >
                    <Icon name="send" size={16} /> {t('fb.send')}
                  </button>
                </div>
              ) : (
                <button className="link-btn small" onClick={() => (setReplyTo(th.id), setReply(''))}>
                  {th.status === 'done' ? t('fb.reopen') : t('fb.writeMore')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function About({ onOpenLabs }: { onOpenLabs: () => void }) {
  const { data, update } = useStore();
  const [info, setInfo] = useState<Info | null>(null);
  // Easter egg: five clicks on the icon within three seconds open Labs, the hidden Settings tab, and unlock Daylight
  // (switched on the first time). Labs hidden again? The same five clicks bring it back.
  const clicks = useRef<number[]>([]);
  const [unlocked, setUnlocked] = useState(0);
  const tapIcon = () => {
    const now = Date.now();
    clicks.current = [...clicks.current.filter((c) => now - c < 3000), now];
    const s = data.settings;
    if (clicks.current.length < 5 || (s.labs ?? s.daylightUnlocked)) return;
    update((d) => ({ ...d, settings: { ...d.settings, labs: true, daylightUnlocked: true, ...(!d.settings.daylightUnlocked && { daylight: true }) } }));
    setUnlocked(now);
  };
  useEffect(() => {
    window.api.appInfo().then(setInfo);
  }, []);

  return (
    <div className="page narrow about">
      <header className="about-head">
        <button className="about-icon" onClick={tapIcon} aria-label="Gnomon">
          <img src={appIcon} alt="" width={64} height={64} />
          <Burst trigger={unlocked} rays={14} style={{ left: 32, top: 32 }} />
        </button>
        <div>
          <h1>Gnomon</h1>
          <span className="muted">{info ? t('about.version', { version: info.version }) : ' '}</span>
        </div>
      </header>

      {unlocked > 0 && (
        <p className="egg" role="status">
          <strong>{t('egg.title')}</strong> {t('egg.text')}{' '}
          <button className="link-btn" onClick={onOpenLabs}>
            {t('egg.open')}
          </button>
        </p>
      )}

      {/* The web app is updated with the server; feedback goes through the Mac app. */}
      {!isWeb() && (
        <>
          <section className="card">
            <h3>{t('about.updates')}</h3>
            {info && <Updates info={info} />}
          </section>

          <FeedbackCard />
        </>
      )}

      <section className="card">
        <div className="card-head">
          <h3>{t('about.changes')}</h3>
          {info?.roadmap && (
            <button className="link-btn small" onClick={() => window.api.openLink(info.roadmap!)}>
              {t('about.coming')}
            </button>
          )}
        </div>
        <Changelog />
      </section>

      <section className="card">
        <h3>{t('about.credits')}</h3>
        <p className="muted small section-hint">{t('about.creditsHint')}</p>
        <div className="credits">
          {credits.map((c) => (
            <button key={c.name} className="credit" onClick={() => c.url && window.api.openLink(c.url)} disabled={!c.url}>
              <strong>{c.name}</strong>
              <span className="muted small">
                {c.version} · {c.license} · {t(`about.use.${c.use as 'app' | 'server' | 'build'}`)}
              </span>
            </button>
          ))}
        </div>
        {info && <p className="muted small">{t('about.tech', { electron: info.electron, chrome: info.chrome })}</p>}
      </section>
    </div>
  );
}
