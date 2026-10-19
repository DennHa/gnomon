// Gnomon on the phone: Today (attendance, timer, entries), Week, and this device.
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError, getKey, setKey, setUnauthorizedHandler, type Activity, type Entry, type Project, type State, type Workday } from './api';
import { t } from './i18n';
import { Icon, type IconName } from './icons';
import jsQR from 'jsqr';
import qrcode from 'qrcode-generator';
import { addDays, atTime, dayKey, entryMs, fmtClock, fmtDay, fmtHM, fmtTime, mondayOf, parseMinutes, toTimeInput } from './time';
import './styles.css';

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Re-run `fn` when the app comes back to the foreground and every 30 s while visible (the Mac may change things too). */
function useRefresh(fn: () => void) {
  useEffect(() => {
    fn();
    const onVisible = () => document.visibilityState === 'visible' && fn();
    document.addEventListener('visibilitychange', onVisible);
    const id = setInterval(() => document.visibilityState === 'visible' && fn(), 30_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(id);
    };
  }, [fn]);
}

const errorText = (e: unknown) => (e instanceof ApiError && e.status === 0 ? t('offline') : e instanceof Error ? e.message : String(e));

// ---- App shell -----------------------------------------------------------------------------------

/** A pairing link (scanned QR code) looks like https://gnomon.example.com/#pair=ABCD-EFGH. Read it once, then hide it. */
const PAIR_FROM_LINK = (() => {
  const m = location.hash.match(/pair=([A-Za-z0-9-]{8,10})/);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  return m?.[1] ?? null;
})();
let pairLinkUsed = false;
let handoverPrepared = false;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as { standalone?: boolean }).standalone);

type Tab = 'today' | 'clock' | 'week' | 'device';
const TABS: [Tab, IconName, string][] = [
  ['clock', 'schedule', t('clockTab')],
  ['today', 'timer', t('timerTab')],
  ['week', 'calendar_view_week', t('week')],
  ['device', 'devices', t('device')],
];

function App() {
  const [key, setKeyState] = useState(getKey);
  const [tab, setTab] = useState<Tab>('clock');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setKey(null);
      setKeyState(null);
    });
  }, []);

  // In Safari (not the home-screen app): prepare the hand-over to the home-screen app, which on iPhone gets its own
  // storage and would otherwise start unpaired. A fresh one-time code goes into the start address of the app.
  useEffect(() => {
    if (!key || isStandalone() || handoverPrepared) return;
    handoverPrepared = true;
    const name = /iPad/.test(navigator.userAgent) ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'Home screen';
    api.pairCode(`${name} (Home screen)`, 60).then(
      ({ code }) => {
        document.querySelector('link[rel="manifest"]')?.setAttribute('href', `/manifest.webmanifest?pair=${code}`);
        history.replaceState(null, '', `/#pair=${code}`);
      },
      () => {},
    );
  }, [key]);

  /** Run an action and show what went wrong instead of throwing. */
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }, []);

  if (!key)
    return (
      <Pair
        onPaired={(k) => {
          setKey(k);
          setKeyState(k);
          if (!isStandalone()) setNotice(t('pairedAddHome'));
        }}
      />
    );

  return (
    <div className="app">
      {error && (
        <button className="banner" onClick={() => setError(null)}>
          <Icon name="cloud_off" size={18} /> {error}
        </button>
      )}
      {notice && (
        <button className="banner info" onClick={() => setNotice(null)}>
          {notice}
        </button>
      )}
      <main>
        {tab === 'today' && <Today run={run} onOpenClock={() => setTab('clock')} />}
        {tab === 'clock' && <TimeClock run={run} />}
        {tab === 'week' && <Week run={run} />}
        {tab === 'device' && <DeviceView onSignOut={() => (setKey(null), setKeyState(null))} />}
      </main>
      <nav className="tabs">
        {TABS.map(([id, icon, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ---- Pairing ---------------------------------------------------------------------------------------

function Pair({ onPaired }: { onPaired: (key: string) => void }) {
  const [code, setCode] = useState(PAIR_FROM_LINK ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function pair(value: string, fromLink = false) {
    setBusy(true);
    try {
      if (/^(gnomon|punch)_/.test(value)) {
        await api.me(value); // a full device key: check it first
        onPaired(value);
      } else onPaired((await api.pair(value)).key);
    } catch (err) {
      setError(fromLink && err instanceof ApiError && err.status === 401 ? t('pairLinkFailed') : errorText(err));
      if (fromLink) setCode('');
    } finally {
      setBusy(false);
    }
  }

  // Opened from a scanned QR code: connect right away. (Codes work once, so never send it twice.)
  useEffect(() => {
    if (PAIR_FROM_LINK && !pairLinkUsed) {
      pairLinkUsed = true;
      void pair(PAIR_FROM_LINK, true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = code.trim();
    if (value) void pair(value);
  }

  return (
    <form className="pair" onSubmit={submit}>
      <div className="pair-logo">
        <Icon name="timer" size={40} />
      </div>
      <h1>{t('pairTitle')}</h1>
      <p className="muted">{t('pairHelp')}</p>
      <button type="button" className="primary big" onClick={() => setScanning(true)} disabled={busy}>
        <Icon name="qr_code_scanner" size={26} /> {t('scanQr')}
      </button>
      <p className="muted small">{t('orTypeCode')}</p>
      <input
        className="code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="ABCD-EFGH"
        autoCapitalize="characters"
        autoComplete="one-time-code"
        autoCorrect="off"
        spellCheck={false}
        aria-label={t('pairCode')}
      />
      <p className="muted small">{t('pairOrKey')}</p>
      {error && <p className="error">{error}</p>}
      <button className="soft big" disabled={busy || !code.trim()}>
        {t('pairButton')}
      </button>
      {scanning && (
        <Scanner
          onCode={(c) => {
            setScanning(false);
            setCode(c);
            void pair(c);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </form>
  );
}

/** Full-screen camera that reads a pairing QR code (a link with #pair=… or a bare code). */
function Scanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const done = useRef(onCode);
  done.current = onCode;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let stopped = false;
    let timer = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Chrome has a built-in reader; Safari doesn't, so jsQR decodes the frames there.
    type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const detector = BD ? new BD({ formats: ['qr_code'] }) : null;
    const found = (text: string) => {
      const m = text.match(/pair=([A-Za-z0-9]{4}-?[A-Za-z0-9]{4})/) ?? text.trim().match(/^([A-Za-z0-9]{4}-?[A-Za-z0-9]{4})$/);
      if (!m) return false;
      stopped = true;
      done.current(m[1].toUpperCase());
      return true;
    };
    const tick = async () => {
      if (stopped) return;
      const v = video.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        try {
          if (detector) {
            for (const r of await detector.detect(v)) if (found(r.rawValue)) return;
          } else if (ctx) {
            const w = Math.min(640, v.videoWidth);
            const h = Math.round((v.videoHeight * w) / v.videoWidth);
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(v, 0, 0, w, h);
            const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
            if (r && found(r.data)) return;
          }
        } catch {
          /* a frame that can't be read; try the next one */
        }
      }
      timer = window.setTimeout(tick, 200);
    };
    if (!navigator.mediaDevices?.getUserMedia) setError(t('noCamera'));
    else
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(
        (s) => {
          stream = s;
          if (stopped || !video.current) return s.getTracks().forEach((tr) => tr.stop());
          video.current.srcObject = s;
          void video.current.play().catch(() => {});
          void tick();
        },
        (e: unknown) => setError((e as { name?: string })?.name === 'NotAllowedError' ? t('cameraDenied') : t('noCamera')),
      );
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  return (
    <div className="scanner" role="dialog" aria-label={t('scanQr')}>
      <video ref={video} playsInline muted autoPlay />
      <div className="scan-frame" />
      <div className="scan-bottom">
        <p>{error ?? t('scanHelp')}</p>
        <button type="button" className="soft big" onClick={onClose}>
          <Icon name="close" /> {t('cancel')}
        </button>
      </div>
    </div>
  );
}

// ---- Today -----------------------------------------------------------------------------------------

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;
type Draft = { description: string; projectId?: string; activityId?: string };

function Today({ run, onOpenClock }: { run: Run; onOpenClock: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [recent, setRecent] = useState<Entry[]>([]);
  const [editing, setEditing] = useState<Entry | null>(null);
  const today = dayKey();

  const load = useCallback(() => {
    void run(async () => {
      const [s, list, older] = await Promise.all([api.state(), api.entries(today), api.entries(addDays(today, -14), addDays(today, -1))]);
      setState(s);
      setEntries(list);
      setRecent([...list, ...older]);
    });
  }, [run, today]);
  useRefresh(load);

  const act = (fn: () => Promise<unknown>) => run(fn).then(load);

  if (!state) return <div className="loading muted">…</div>;
  const projects = new Map(state.projects.map((p) => [p.id, p]));

  return (
    <>
      <header className="page-head">
        <h1>{fmtDay(today, { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
      </header>
      <ClockLine state={state} onClick={onOpenClock} />
      <TimerCard state={state} recent={recent} act={act} />
      <section className="card">
        <div className="card-head">
          <h2>{t('entries')}</h2>
          <span className="muted">{fmtHM(entries.reduce((s, e) => s + entryMs(e), 0))}</span>
        </div>
        {!entries.length && <p className="muted">{t('noEntries')}</p>}
        <ul className="entries">
          {entries.map((e) => (
            <li key={e.id}>
              <button onClick={() => setEditing(e)}>
                <span className="dot" style={{ background: (e.projectId && projects.get(e.projectId)?.color) || 'var(--muted)' }} />
                <span className="grow">
                  <span className="title">{e.description || e.project || t('untitled')}</span>
                  <span className="muted small">{[e.description && e.project, e.activity, `${fmtTime(e.start)}–${e.end ? fmtTime(e.end) : t('running')}`].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="num">{fmtHM(entryMs(e))}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {editing && <EditSheet entry={editing} projects={state.projects} activities={state.activities} onClose={() => setEditing(null)} act={act} />}
    </>
  );
}

/** Attendance status and worked time, counting on between refreshes while you're at work. */
function useAttendance(state: State) {
  const now = useNow(1000);
  const w = state.workday;
  const active = Boolean(w && !w.off && w.in && !w.out);
  let status = t('notClockedIn');
  if (w?.off) status = w.offReason || t('dayOff');
  else if (active && state.onBreak) status = t('onBreak');
  else if (active) status = t('atWorkSince', { t: fmtTime(w!.in!) });
  else if (w?.out) status = t('leftAt', { t: fmtTime(w.out) });
  const worked = w && !w.off ? w.workedMinutes * 60_000 + (active && !state.onBreak ? Math.max(0, now - Date.parse(state.serverTime)) : 0) : 0;
  const tone = active ? (state.onBreak ? 'warn' : 'ok') : '';
  return { w, active, status, worked, tone, target: state.dailyTargetHours * 3_600_000 };
}

/** One line on the Timer page; tap it to open the time clock. */
function ClockLine({ state, onClick }: { state: State; onClick: () => void }) {
  const { w, status, worked, tone } = useAttendance(state);
  return (
    <button className="clock-line" onClick={onClick}>
      <span className={`pill ${tone}`}>{status}</span>
      {w && !w.off && w.in && <span className="muted num">{fmtHM(worked)}</span>}
      <Icon name="chevron_right" size={18} />
    </button>
  );
}

// ---- Time clock ------------------------------------------------------------------------------------

function TimeClock({ run }: { run: Run }) {
  const [state, setState] = useState<State | null>(null);
  const today = dayKey();
  const load = useCallback(() => {
    void run(async () => setState(await api.state()));
  }, [run]);
  useRefresh(load);
  const act = (fn: () => Promise<unknown>) => run(fn).then(load);

  if (!state) return <div className="loading muted">…</div>;
  return <TimeClockView state={state} act={act} today={today} />;
}

function TimeClockView({ state, act, today }: { state: State; act: (fn: () => Promise<unknown>) => Promise<unknown>; today: string }) {
  const { w, active, status, worked, tone, target } = useAttendance(state);
  const hasDay = Boolean(w && !w.off && w.in);
  return (
    <>
      <header className="page-head">
        <h1>{fmtDay(today, { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
      </header>
      <section className="card clock-card">
        <span className={`pill ${tone}`}>{status}</span>
        <div className="clock">{fmtClock(worked)}</div>
        <p className="muted small center">
          {t('workedToday')} · {fmtHM(target)}
        </p>
        {hasDay && (
          <div className="progress">
            <div style={{ width: `${Math.min(100, (worked / target) * 100)}%` }} />
          </div>
        )}
        {!active ? (
          <button className="primary big" onClick={() => act(api.startDay)}>
            <Icon name="login" size={26} /> {w?.out ? t('resumeDay') : t('startDay')}
          </button>
        ) : (
          <div className="row">
            <button className={`soft big grow ${state.onBreak ? 'on' : ''}`} onClick={() => act(api.toggleBreak)}>
              <Icon name="coffee" size={26} /> {state.onBreak ? t('endBreak') : t('break')}
            </button>
            <button className="stop big grow" onClick={() => act(api.leave)}>
              <Icon name="logout" size={26} /> {t('leave')}
            </button>
          </div>
        )}
      </section>
      {hasDay && (
        // Re-created when the server's times change (after saving or a change on another device).
        <CorrectDay key={JSON.stringify([w!.in, w!.out, state.breaks])} state={state} act={act} today={today} />
      )}
    </>
  );
}

type BreakDraft = { start: string; end: string };

function CorrectDay({ state, act, today }: { state: State; act: (fn: () => Promise<unknown>) => Promise<unknown>; today: string }) {
  const w = state.workday!;
  const [tin, setTin] = useState(toTimeInput(w.in!));
  const [tout, setTout] = useState(w.out ? toTimeInput(w.out) : '');
  const [breaks, setBreaks] = useState<BreakDraft[]>(state.breaks.map((b) => ({ start: toTimeInput(b.start), end: b.end ? toTimeInput(b.end) : '' })));
  const [saved, setSaved] = useState(false);
  const original = JSON.stringify([toTimeInput(w.in!), w.out ? toTimeInput(w.out) : '', state.breaks.map((b) => [toTimeInput(b.start), b.end ? toTimeInput(b.end) : ''])]);
  const changed = JSON.stringify([tin, tout, breaks.map((b) => [b.start, b.end])]) !== original;
  const setBreak = (i: number, patch: Partial<BreakDraft>) => setBreaks(breaks.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  function addBreak() {
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    // Lunch at 12:00–12:30 when that fits the day; otherwise a break starting now (still running while at work).
    const lunch = tin <= '12:00' && hhmm >= '12:30' && (!tout || tout >= '12:30') && !breaks.some((b) => b.start === '12:00');
    setBreaks([...breaks, lunch ? { start: '12:00', end: '12:30' } : { start: hhmm, end: '' }]);
  }

  async function save() {
    await act(() => api.patchWorkday(today, { in: tin, ...(w.out ? { out: tout } : {}), breaks: breaks.map((b) => ({ start: b.start, end: b.end || null })) }));
    setSaved(true);
  }

  return (
    <section className="card correct">
      <h2>{t('correctDay')}</h2>
      <p className="muted small">{t('correctHint')}</p>
      <div className="row">
        <label className="grow">
          {t('in')}
          <input type="time" value={tin} onChange={(e) => setTin(e.target.value)} />
        </label>
        <label className="grow">
          {t('out')}
          {w.out ? <input type="time" value={tout} onChange={(e) => setTout(e.target.value)} /> : <span className="still">{t('stillHere')}</span>}
        </label>
      </div>
      <h3 className="small muted">{t('breaks')}</h3>
      {!breaks.length && <p className="muted small">{t('noBreaks')}</p>}
      {breaks.map((b, i) => (
        <div className="row" key={i}>
          <input className="grow" type="time" value={b.start} onChange={(e) => setBreak(i, { start: e.target.value })} aria-label={`${t('break')} ${i + 1} ${t('from')}`} />
          <span className="muted">–</span>
          {b.end || w.out ? (
            <input className="grow" type="time" value={b.end} onChange={(e) => setBreak(i, { end: e.target.value })} aria-label={`${t('break')} ${i + 1} ${t('to')}`} />
          ) : (
            <span className="still grow">{t('openBreak')}</span>
          )}
          <button className="icon-btn" onClick={() => setBreaks(breaks.filter((_, j) => j !== i))} aria-label={t('delete')}>
            <Icon name="delete" />
          </button>
        </div>
      ))}
      <div className="row">
        <button className="soft" onClick={addBreak}>
          <Icon name="add" /> {t('addBreak')}
        </button>
        <button className="primary grow" disabled={!changed || !tin} onClick={save}>
          {saved && !changed ? t('saved') : t('save')}
        </button>
      </div>
    </section>
  );
}

function TimerCard({ state, recent, act }: { state: State; recent: Entry[]; act: (fn: () => Promise<unknown>) => void }) {
  const now = useNow();
  const running = state.timer;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      return { description: '', ...JSON.parse(localStorage.getItem('gnomon.lastPick') ?? '{}') };
    } catch {
      return { description: '' };
    }
  });
  const remember = (d: Draft) => {
    try {
      localStorage.setItem('gnomon.lastPick', JSON.stringify({ projectId: d.projectId, activityId: d.activityId }));
    } catch {
      /* not important */
    }
  };
  const project = (id?: string | null) => state.projects.find((p) => p.id === id);
  // Correct for a phone clock that is a bit off: elapsed time is measured against the server's clock.
  const [skew] = useState(() => Date.parse(state.serverTime) - Date.now());

  /** Recent distinct things you did, to continue with one tap. */
  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: Entry[] = [];
    for (const e of [...recent].sort((a, b) => b.start.localeCompare(a.start))) {
      if (e.running) continue;
      const k = `${e.description}|${e.projectId}|${e.activityId}`;
      if (seen.has(k) || (!e.description && !e.projectId)) continue;
      seen.add(k);
      out.push(e);
      if (out.length === 4) break;
    }
    return out;
  }, [recent]);

  function start(d: Draft) {
    remember(d);
    act(() => api.start({ description: d.description.trim(), projectId: d.projectId, activityId: d.activityId }));
    setDraft({ ...d, description: '' });
  }

  async function newProject() {
    const name = window.prompt(t('newProjectName'))?.trim();
    if (!name) return;
    // Starting with a project name the server doesn't know creates the project.
    remember({ ...draft, projectId: undefined });
    act(() => api.start({ description: draft.description.trim(), project: name, activityId: draft.activityId }));
    setDraft({ description: '' });
  }

  if (running) {
    const p = project(running.projectId);
    return (
      <section className="card timer running" style={{ ['--tint' as string]: p?.color ?? 'var(--accent)' }}>
        <div className="timer-what">
          <span className="dot" style={{ background: p?.color ?? 'var(--muted)' }} />
          <span className="grow">
            <span className="title">{running.description || p?.name || t('untitled')}</span>
            <span className="muted small">{[running.description && p?.name, running.activity].filter(Boolean).join(' · ') || t('noProject')}</span>
          </span>
        </div>
        <div className="clock">{fmtClock(now + skew - Date.parse(running.start))}</div>
        <Chips items={state.activities} selected={running.activityId ?? undefined} onPick={(id) => id && id !== running.activityId && act(() => api.switchActivity(id))} />
        <button className="stop big" onClick={() => act(api.stop)}>
          <Icon name="stop" size={28} /> {t('stop')}
        </button>
      </section>
    );
  }

  return (
    <section className="card timer">
      <input className="what" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder={t('whatAreYouDoing')} enterKeyHint="go" onKeyDown={(e) => e.key === 'Enter' && start(draft)} />
      <Chips items={state.projects} selected={draft.projectId} onPick={(id) => setDraft({ ...draft, projectId: id })} extra={{ label: t('newProject'), onClick: newProject }} />
      <Chips items={state.activities} selected={draft.activityId} onPick={(id) => setDraft({ ...draft, activityId: id })} small />
      <button className="primary big" onClick={() => start(draft)}>
        <Icon name="play_arrow" size={28} /> {t('start')}
      </button>
      {suggestions.length > 0 && (
        <div className="recent">
          <h3 className="muted small">{t('recent')}</h3>
          {suggestions.map((e) => (
            <button key={e.id} className="recent-item" onClick={() => start({ description: e.description, projectId: e.projectId ?? undefined, activityId: e.activityId ?? undefined })}>
              <span className="dot" style={{ background: project(e.projectId)?.color ?? 'var(--muted)' }} />
              <span className="grow">
                <span className="title">{e.description || e.project || t('untitled')}</span>
                <span className="muted small">{[e.description && e.project, e.activity].filter(Boolean).join(' · ')}</span>
              </span>
              <Icon name="play_arrow" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** A row of tappable chips; tapping the selected chip clears it. */
function Chips({ items, selected, onPick, extra, small }: { items: (Project | Activity)[]; selected?: string; onPick: (id?: string) => void; extra?: { label: string; onClick: () => void }; small?: boolean }) {
  return (
    <div className={`chips ${small ? 'small' : ''}`}>
      {items.map((x) => (
        <button key={x.id} className={`chip ${selected === x.id ? 'on' : ''}`} style={{ ['--c' as string]: x.color }} onClick={() => onPick(selected === x.id ? undefined : x.id)}>
          <span className="dot" />
          {x.name}
        </button>
      ))}
      {extra && (
        <button className="chip ghost" onClick={extra.onClick}>
          <Icon name="add" size={18} /> {extra.label}
        </button>
      )}
    </div>
  );
}

function EditSheet({ entry, projects, activities, onClose, act }: { entry: Entry; projects: Project[]; activities: Activity[]; onClose: () => void; act: (fn: () => Promise<unknown>) => Promise<unknown> }) {
  const [description, setDescription] = useState(entry.description);
  const [projectId, setProjectId] = useState(entry.projectId ?? '');
  const [activityId, setActivityId] = useState(entry.activityId ?? '');
  const [from, setFrom] = useState(toTimeInput(entry.start));
  const [to, setTo] = useState(entry.end ? toTimeInput(entry.end) : '');

  async function save() {
    const patch: Record<string, unknown> = { description, start: atTime(entry.date, from) };
    if (projectId !== (entry.projectId ?? '')) patch.projectId = projectId || null;
    if (activityId !== (entry.activityId ?? '')) patch.activityId = activityId || null;
    if (!entry.running && to) patch.end = atTime(entry.date, to);
    await act(() => api.patchEntry(entry.id, patch));
    onClose();
  }

  async function remove() {
    if (!window.confirm(t('deleteConfirm'))) return;
    await act(() => api.deleteEntry(entry.id));
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('edit')}>
        <div className="card-head">
          <h2>{t('edit')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('cancel')}>
            <Icon name="close" />
          </button>
        </div>
        <label>
          {t('description')}
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          {t('project')}
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{t('noProject')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('activity')}
          <select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
            <option value="">–</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label className="grow">
            {t('from')}
            <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="grow">
            {t('to')}
            <input type="time" value={to} onChange={(e) => setTo(e.target.value)} disabled={entry.running} placeholder={t('running')} />
          </label>
        </div>
        <div className="row">
          <button className="danger" onClick={remove} aria-label={t('delete')}>
            <Icon name="delete" />
          </button>
          <button className="primary grow" onClick={save}>
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Week ------------------------------------------------------------------------------------------

function Week({ run }: { run: Run }) {
  const [monday, setMonday] = useState(() => mondayOf(dayKey()));
  const [data, setData] = useState<{ entries: Entry[]; workdays: Workday[]; projects: Project[]; activities: Activity[] } | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const sunday = addDays(monday, 6);
  const today = dayKey();

  const load = useCallback(() => {
    void run(async () => {
      const [entries, workdays, s] = await Promise.all([api.entries(monday, sunday), api.workdays(monday, sunday), api.state()]);
      setData({ entries, workdays, projects: s.projects, activities: s.activities });
    });
  }, [run, monday, sunday]);
  useRefresh(load);
  const act = (fn: () => Promise<unknown>) => run(fn).then(load);

  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const color = (id: string | null) => data?.projects.find((p) => p.id === id)?.color ?? 'var(--muted)';
  const byDay = (day: string) => data?.entries.filter((e) => e.date === day) ?? [];
  const max = Math.max(8 * 3_600_000, ...days.map((d) => byDay(d).reduce((s, e) => s + entryMs(e), 0)));
  const byProject = new Map<string, { name: string; ms: number; color: string }>();
  for (const e of data?.entries ?? []) {
    const k = e.projectId ?? '';
    const cur = byProject.get(k) ?? { name: e.project ?? t('noProject'), ms: 0, color: color(e.projectId) };
    cur.ms += entryMs(e);
    byProject.set(k, cur);
  }
  const total = [...byProject.values()].reduce((s, p) => s + p.ms, 0);
  const worked = data?.workdays.reduce((s, w) => s + w.workedMinutes * 60_000, 0) ?? 0;

  return (
    <>
      <header className="page-head week-head">
        <button className="icon-btn" onClick={() => setMonday(addDays(monday, -7))} aria-label="‹">
          <Icon name="chevron_left" />
        </button>
        <h1 className="grow">{monday === mondayOf(today) ? t('thisWeek') : `${fmtDay(monday, { day: 'numeric', month: 'short' })} – ${fmtDay(sunday, { day: 'numeric', month: 'short' })}`}</h1>
        <button className="icon-btn" onClick={() => setMonday(addDays(monday, 7))} aria-label="›">
          <Icon name="chevron_right" />
        </button>
      </header>
      <section className="card">
        <div className="totals">
          <div>
            <span className="muted small">{t('tracked')}</span>
            <strong>{fmtHM(total)}</strong>
          </div>
          <div>
            <span className="muted small">{t('worked')}</span>
            <strong>{fmtHM(worked)}</strong>
          </div>
        </div>
        <ul className="days">
          {days.map((day) => {
            const list = byDay(day);
            const ms = list.reduce((s, e) => s + entryMs(e), 0);
            const w = data?.workdays.find((x) => x.date === day);
            return (
              <li key={day} className={day === today ? 'today' : ''}>
                <button onClick={() => setOpenDay(day)}>
                  <span className="day-label">
                    {fmtDay(day, { weekday: 'short' })}
                    <span className="muted small"> {fmtDay(day, { day: 'numeric' })}</span>
                  </span>
                  <span className="bar">
                    {w?.off ? (
                      <span className="muted small">{w.offReason || t('dayOff')}</span>
                    ) : (
                      list.map((e) => <span key={e.id} style={{ width: `${(entryMs(e) / max) * 100}%`, background: color(e.projectId) }} />)
                    )}
                  </span>
                  <span className="num">{ms ? fmtHM(ms) : <Icon name="add" size={18} />}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {byProject.size > 0 && (
        <section className="card">
          <h2>{t('byProject')}</h2>
          <ul className="projects">
            {[...byProject.values()]
              .sort((a, b) => b.ms - a.ms)
              .map((p) => (
                <li key={p.name}>
                  <span className="dot" style={{ background: p.color }} />
                  <span className="grow">{p.name}</span>
                  <span className="num">{fmtHM(p.ms)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}
      {openDay && data && !editing && (
        <DaySheet day={openDay} entries={byDay(openDay)} workday={data.workdays.find((w) => w.date === openDay)} projects={data.projects} activities={data.activities} act={act} onEdit={setEditing} onClose={() => setOpenDay(null)} />
      )}
      {editing && data && <EditSheet entry={editing} projects={data.projects} activities={data.activities} onClose={() => setEditing(null)} act={act} />}
    </>
  );
}

/** One day after the fact: its entries, adding time as a duration, and attendance. */
function DaySheet(props: { day: string; entries: Entry[]; workday?: Workday; projects: Project[]; activities: Activity[]; act: (fn: () => Promise<unknown>) => Promise<unknown>; onEdit: (e: Entry) => void; onClose: () => void }) {
  const { day, entries, workday: w, projects, activities, act, onEdit, onClose } = props;
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [activityId, setActivityId] = useState('');
  const [duration, setDuration] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tin, setTin] = useState(w?.in ? toTimeInput(w.in) : '');
  const [tout, setTout] = useState(w?.out ? toTimeInput(w.out) : '');
  const [brk, setBrk] = useState(String(w?.breakMinutes ?? 30));
  const color = (id: string | null) => projects.find((p) => p.id === id)?.color ?? 'var(--muted)';

  async function add() {
    const minutes = parseMinutes(duration);
    if (!minutes || minutes > 1440) return setError(t('invalidDuration'));
    setError(null);
    await act(() => api.addEntry({ date: day, minutes, description: description.trim(), ...(projectId && { projectId }), ...(activityId && { activityId }) }));
    setDescription('');
    setDuration('');
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={day}>
        <div className="card-head">
          <h2>{fmtDay(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('cancel')}>
            <Icon name="close" />
          </button>
        </div>
        {entries.length > 0 && (
          <ul className="entries">
            {entries.map((e) => (
              <li key={e.id}>
                <button onClick={() => onEdit(e)}>
                  <span className="dot" style={{ background: color(e.projectId) }} />
                  <span className="grow">
                    <span className="title">{e.description || e.project || t('untitled')}</span>
                    <span className="muted small">{[e.description && e.project, e.activity].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="num">{fmtHM(entryMs(e))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <h3 className="small muted">{t('addTime')}</h3>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('description')} />
        <div className="row">
          <select className="grow" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label={t('project')}>
            <option value="">{t('noProject')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select className="grow" value={activityId} onChange={(e) => setActivityId(e.target.value)} aria-label={t('activity')}>
            <option value="">{t('activity')}</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <input className="grow" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder={t('durationHint')} aria-label={t('duration')} inputMode="decimal" />
          <button className="primary" onClick={add} disabled={!duration.trim()}>
            <Icon name="add" /> {t('addTime')}
          </button>
        </div>
        {error && <p className="error small">{error}</p>}
        <h3 className="small muted">{t('attendance')}</h3>
        <div className="row">
          <label className="grow">
            {t('in')}
            <input type="time" value={tin} onChange={(e) => setTin(e.target.value)} />
          </label>
          <label className="grow">
            {t('out')}
            <input type="time" value={tout} onChange={(e) => setTout(e.target.value)} />
          </label>
          <label className="grow">
            {t('breakMinutes')}
            <input inputMode="numeric" value={brk} onChange={(e) => setBrk(e.target.value)} />
          </label>
        </div>
        <div className="row">
          {w && (
            <button className="danger" onClick={() => act(() => api.deleteWorkday(day))} aria-label={t('clearDay')}>
              <Icon name="delete" />
            </button>
          )}
          <button className="soft grow" disabled={!tin} onClick={() => act(() => api.putWorkday(day, { in: tin, ...(tout && { out: tout }), breakMinutes: Number(brk) || 0 }))}>
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Device ----------------------------------------------------------------------------------------

function DeviceView({ onSignOut }: { onSignOut: () => void }) {
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<{ code: string; svg: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const key = getKey();
    if (key) api.me(key).then((d) => setName(d.name), () => {});
  }, []);

  async function newInvite() {
    try {
      const { code } = await api.pairCode('Device');
      const qr = qrcode(0, 'M');
      qr.addData(`${location.origin}/#pair=${code}`);
      qr.make();
      setInvite({ code, svg: qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) });
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <>
      <header className="page-head">
        <h1>{t('device')}</h1>
      </header>
      <section className="card">
        <p>{t('signedInAs', { name: name || '…' })}</p>
        <p className="muted small">
          {t('server')}: {location.host}
        </p>
        {!isStandalone() && <p className="muted small">{t('installHint')}</p>}
        <button
          className="soft"
          onClick={async () => {
            if (!window.confirm(t('signOutConfirm'))) return;
            await api.forgetDevice().catch(() => {}); // revoke the key on the server, then forget it here
            onSignOut();
          }}
        >
          <Icon name="logout" /> {t('signOut')}
        </button>
      </section>
      <section className="card">
        <h2>{t('connectDevice')}</h2>
        {invite ? (
          <>
            <div className="qr" dangerouslySetInnerHTML={{ __html: invite.svg }} />
            <p className="code-text">{invite.code}</p>
            <button className="soft" onClick={() => navigator.clipboard?.writeText(`${location.origin}/#pair=${invite.code}`)}>
              {t('copyLink')}
            </button>
            <p className="muted small">{t('connectHelp')}</p>
          </>
        ) : null}
        {error && <p className="error small">{error}</p>}
        <button className="soft" onClick={newInvite}>
          <Icon name="add" /> {invite ? t('newCode') : t('connectDevice')}
        </button>
      </section>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Not in the web demo (/example/phone): it runs on made-up data in the browser and must not replace the real app's cache.
if ('serviceWorker' in navigator && !(window as { gnomonDemo?: boolean }).gnomonDemo) navigator.serviceWorker.register('/sw.js').catch(() => {});
