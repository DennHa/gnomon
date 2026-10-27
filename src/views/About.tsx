// Info & feedback: version and update check, then three tabs: What's new (CHANGELOG.md and the open-source projects
// used), What's coming (docs/ROADMAP.md as a board to vote, comment and suggest ideas on) and Feedback.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { Burst } from '../motion';
import { Icon, type IconName } from '../icons';
import { locale, t, type MsgKey } from '../i18n';
import type { FeedbackThread } from '../global';
import changelog from '../../CHANGELOG.md?raw';
import roadmapMd from '../../docs/ROADMAP.md?raw';
import { parseRoadmap, VOTABLE, type RoadmapBoard } from '../roadmap';
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

type Board = RoadmapBoard;
type Card = Board['sections'][number]['items'][number] | Board['suggestions'][number];

/** The roadmap that came with the app, for when there is no server to vote on (nothing to vote, comment or suggest). */
function localBoard(): Board {
  return { sections: parseRoadmap(roadmapMd).map((s) => ({ ...s, votable: VOTABLE.has(s.key), items: s.items.map((it) => ({ ...it, votes: 0, voted: false, comments: [] })) })), suggestions: [] };
}

const SECTION: Record<string, MsgKey> = { now: 'rm.sec.now', next: 'rm.sec.next', later: 'rm.sec.later', done: 'rm.sec.done', out: 'rm.sec.out' };
const sectionTitle = (s: { key: string; title: string }) => (SECTION[s.key] ? t(SECTION[s.key]) : s.title);

/** One item on the board: title, the vote toggle and comments, which open with a click. */
function RoadmapCard({ it, live, call }: { it: Card; live: boolean; call: (method: 'PUT' | 'POST' | 'DELETE', path: string, body?: unknown) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const waiting = 'status' in it && it.status === 'waiting';
  return (
    <div className={`rm-item ${open ? 'open' : ''}`}>
      <button className="rm-title" onClick={() => setOpen(!open)} aria-expanded={open}>
        {it.title}
      </button>
      {(open || 'status' in it) && it.text && <p className="muted small rm-text">{it.text}</p>}
      {waiting ? (
        <p className="rm-row small">
          <span className="rm-waiting">{t('rm.waiting')}</span>
          <span className="muted">{t('rm.waitingHint')}</span>
        </p>
      ) : (
        live && (
          <div className="rm-row">
            <button className={`rm-vote ${it.voted ? 'on' : ''}`} aria-pressed={it.voted} onClick={() => call('PUT', `/roadmap/votes/${it.id}`, { on: !it.voted })}>
              <Icon name="thumb_up" size={14} /> {it.votes} · {t(it.voted ? 'rm.voted' : 'rm.vote')}
            </button>
            <button className="rm-count" onClick={() => setOpen(!open)} aria-label={t('rm.addComment')}>
              <Icon name="chat_bubble" size={14} /> {it.comments.length}
            </button>
          </div>
        )
      )}
      {open && live && !waiting && (
        <div className="rm-comments">
          {it.comments.map((c) => (
            <p key={c.id} className="small">
              <span className="muted">{c.mine ? t('rm.you') : c.name || t('rm.someone')}:</span> {c.text}
              {c.mine && (
                <button className="link-btn muted rm-remove" onClick={() => call('DELETE', `/roadmap/comments/${c.id}`)}>
                  {t('rm.remove')}
                </button>
              )}
            </p>
          ))}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (text.trim() && (await call('POST', '/roadmap/comments', { target: it.id, text, anonymous }))) setText('');
            }}
          >
            <input value={text} maxLength={1000} placeholder={t('rm.addComment')} onChange={(e) => setText(e.target.value)} />
            {text.trim() && (
              <span className="rm-row small">
                <label className="check-row">
                  <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> {t('rm.asSomeone')}
                </label>
                <span className="spacer" />
                <button className="btn small primary">
                  <Icon name="send" size={14} /> {t('fb.send')}
                </button>
              </span>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

/** Suggest an idea: a title and a sentence or two; it waits for the admin's OK before others see it. */
function SuggestForm({ call, done }: { call: (method: 'POST', path: string, body: unknown) => Promise<boolean>; done: () => void }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  return (
    <form
      className="rm-suggest"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await call('POST', '/roadmap/suggestions', { title, text, anonymous })) done();
      }}
    >
      <input autoFocus value={title} maxLength={80} placeholder={t('rm.ideaTitle')} onChange={(e) => setTitle(e.target.value)} />
      <textarea rows={2} value={text} maxLength={500} placeholder={t('rm.ideaText')} onChange={(e) => setText(e.target.value)} />
      <span className="rm-row small">
        <label className="check-row">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> {t('rm.asSomeone')}
        </label>
        <span className="spacer" />
        <button type="button" className="btn small" onClick={done}>
          {t('rm.cancel')}
        </button>
        <button className="btn small primary" disabled={!title.trim()}>
          <Icon name="send" size={14} /> {t('rm.sendIdea')}
        </button>
      </span>
    </form>
  );
}

/**
 * What's coming: the roadmap as a small board. Signed in to a Gnomon server (the Mac's connection, or the web app),
 * it's that server's roadmap with votes, comments and ideas; otherwise the one that came with the app, to read.
 */
function Roadmap() {
  const [board, setBoard] = useState<Board | null>(null);
  const [mode, setMode] = useState<'live' | 'local' | 'offline'>('live');
  const [suggest, setSuggest] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    window.api.roadmapCall('GET', '/roadmap/board').then((r) => {
      if (r.ok) return setBoard(r.board);
      setMode(r.error === 'not_connected' ? 'local' : 'offline');
      setBoard(localBoard());
    });
  }, []);
  const call = async (method: 'PUT' | 'POST' | 'DELETE', path: string, body?: unknown) => {
    const r = await window.api.roadmapCall(method, path, body);
    if (!r.ok) {
      setError(r.error === 'unreachable' ? t('fb.offline') : r.error);
      return false;
    }
    setError(null);
    setBoard(r.board);
    return true;
  };
  if (!board) return null;
  const live = mode === 'live';
  const cols = board.sections.filter((s) => s.votable && s.items.length);
  const notes = board.sections.filter((s) => s.votable && !s.items.length && s.intro);
  const more = board.sections.filter((s) => !s.votable && s.items.length);
  return (
    <section className="card roadmap">
      <div className="card-head">
        <p className="muted small rm-intro">{t(live ? 'rm.intro' : mode === 'local' ? 'rm.signIn' : 'rm.offline')}</p>
        {live && !suggest && (
          <button className="btn small" onClick={() => (setSuggest(true), setSent(false))}>
            <Icon name="lightbulb" size={16} /> {t('rm.suggest')}
          </button>
        )}
      </div>
      {suggest && <SuggestForm call={call} done={() => (setSuggest(false), setSent(true))} />}
      {sent && !suggest && <p className="pos small">{t('rm.ideaSent')}</p>}
      {error && <p className="error small">{error}</p>}
      {notes.map((s) => (
        <p key={s.key} className="small rm-note">
          <strong>{sectionTitle(s)}:</strong> <span className="muted">{s.intro}</span>
        </p>
      ))}
      <div className="rm-board">
        {cols.map((s) => (
          <div key={s.key} className="rm-col">
            <h4>{sectionTitle(s)}</h4>
            {s.items.map((it) => (
              <RoadmapCard key={it.id} it={it} live={live} call={call} />
            ))}
          </div>
        ))}
        {live && (
          <div className="rm-col">
            <h4>{t('rm.sec.ideas')}</h4>
            {board.suggestions.length ? board.suggestions.map((it) => <RoadmapCard key={it.id} it={it} live={live} call={call} />) : <p className="muted small">{t('rm.noIdeas')}</p>}
          </div>
        )}
      </div>
      {more.map((s) => (
        <details key={s.key} className="rm-more">
          <summary>
            {sectionTitle(s)} <span className="muted">· {s.items.length}</span>
          </summary>
          <ul>
            {s.items.map((it) => (
              <li key={it.id}>
                <strong>{it.title}.</strong> <span className="muted">{it.text}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}

type Tab = 'new' | 'coming' | 'feedback';
const TAB_KEY = 'gnomon.aboutTab';

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
  // The tab last open; a reply to your feedback opens Feedback. The web app has no Feedback (it goes through the Mac).
  const tabs: [Tab, MsgKey, IconName][] = [
    ['new', 'about.tabNew', 'campaign'],
    ['coming', 'about.tabComing', 'map'],
    ...(isWeb() ? [] : [['feedback', 'about.tabFeedback', 'feedback'] as [Tab, MsgKey, IconName]]),
  ];
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const v = localStorage.getItem(TAB_KEY) as Tab | null;
      return v && tabs.some(([id]) => id === v) ? v : 'new';
    } catch {
      return 'new';
    }
  });
  useEffect(() => {
    if (!isWeb()) window.api.feedbackUnread().then((n) => n > 0 && setTab('feedback'));
  }, []);
  const choose = (id: Tab) => {
    setTab(id);
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      /* storage unavailable: opens on What's new next time */
    }
  };

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
        <section className="card">
          <h3>{t('about.updates')}</h3>
          {info && <Updates info={info} />}
        </section>
      )}

      <nav className="settings-tabs about-tabs" role="tablist">
        {tabs.map(([id, label, icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`settings-tab ${tab === id ? 'active' : ''}`} onClick={() => choose(id)}>
            <Icon name={icon} size={18} /> {t(label)}
          </button>
        ))}
      </nav>

      {tab === 'coming' && <Roadmap />}
      {tab === 'feedback' && <FeedbackCard />}
      {tab === 'new' && (
        <>
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
        </>
      )}
    </div>
  );
}
