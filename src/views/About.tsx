// Info & feedback: version, update check, feedback, what's new (CHANGELOG.md) and the open-source projects used.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { Burst } from '../motion';
import { Icon } from '../icons';
import { t } from '../i18n';
import changelog from '../../CHANGELOG.md?raw';
import credits from '../credits.json';
import appIcon from '../assets/app-icon.png';

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

export default function About() {
  const { data, update } = useStore();
  const [info, setInfo] = useState<Info | null>(null);
  // Easter egg: five clicks on the icon within three seconds unlock Daylight (and switch it on).
  const clicks = useRef<number[]>([]);
  const [unlocked, setUnlocked] = useState(0);
  const tapIcon = () => {
    const now = Date.now();
    clicks.current = [...clicks.current.filter((c) => now - c < 3000), now];
    if (clicks.current.length < 5 || data.settings.daylightUnlocked) return;
    update((d) => ({ ...d, settings: { ...d.settings, daylightUnlocked: true, daylight: true } }));
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
          <strong>{t('egg.title')}</strong> {t('egg.text')}
        </p>
      )}

      <section className="card">
        <h3>{t('about.updates')}</h3>
        {info && <Updates info={info} />}
      </section>

      <section className="card onb-entry">
        <span className="onb-entry-text">
          <strong>{t('about.feedback')}</strong>
          <span className="muted small">{t('about.feedbackText')}</span>
        </span>
        <button className="btn" onClick={() => window.api.openFeedback()}>
          <Icon name="mail" size={18} /> {t('about.write')}
        </button>
      </section>

      <section className="card">
        <h3>{t('about.changes')}</h3>
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
