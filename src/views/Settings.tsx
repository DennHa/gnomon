import type React from 'react';
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { FloatConnect, PersonioConnect } from './integrations';
import { Icon, type IconName } from '../icons';
import type { Settings as S } from '../types';
import { dayKey, fmtDate, useNow } from '../time';
import { workStyleDefaults } from '../actions';
import { removeSchedule, SCHEDULE_PRESETS, scheduleOn, schedulesOf, setSchedule, SINCE_ALWAYS, weekTotal } from '../schedule';
import { accelFromEvent, DEFAULT_SHORTCUTS, prettyAccel, type LayoutMap } from '../shortcuts';
import { LANGUAGE_NAMES, locale, resolveLanguage, t, type MsgKey } from '../i18n';
import qrcode from 'qrcode-generator';

/** "Recording · 47 minutes today", so you can see the trail is working. */
function TrailStatus() {
  const { data } = useStore();
  const [minutes, setMinutes] = useState<number | null>(null);
  const tick = useNow(60_000);
  useEffect(() => {
    window.api.trailGet(dayKey(new Date())).then((spans) =>
      setMinutes(spans.reduce((s, x) => s + (Number(x.end.slice(0, 2)) * 60 + Number(x.end.slice(3))) - (Number(x.start.slice(0, 2)) * 60 + Number(x.start.slice(3))) + 1, 0)),
    );
  }, [tick]);
  const clockedIn = data.workdays.some((w) => w.date === dayKey(new Date()) && !w.end && !w.off);
  return (
    <p className="small trail-status">
      <span className={`att-dot-inline ${clockedIn ? 'on' : ''}`} />
      {minutes ? t('trail.status', { n: minutes }) : clockedIn ? t('trail.status', { n: 0 }) : t('trail.statusOff')}
    </p>
  );
}

// The keyboard layout (German QWERTZ, US…), so a recorded key is the one printed on it. Chromium only.
let layoutMap: LayoutMap | undefined;
(navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<LayoutMap> } }).keyboard
  ?.getLayoutMap()
  .then((m) => (layoutMap = m))
  .catch(() => {});

/** A field that records a shortcut: click it, press keys. Shows whether macOS let Gnomon register it. */
function ShortcutField({
  value,
  ok,
  conflict,
  onChange,
  modifiersOnly,
}: {
  value: string;
  ok?: boolean;
  conflict?: boolean;
  onChange: (accel: string) => void;
  modifiersOnly?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const stop = () => {
    setRecording(false);
    window.api.suspendShortcuts(false);
  };
  useEffect(() => () => window.api.suspendShortcuts(false), []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    if (e.key === 'Escape') return stop();
    if (e.key === 'Backspace' || e.key === 'Delete') {
      onChange('');
      return stop();
    }
    const accel = accelFromEvent(e, layoutMap);
    if (accel === 'needs-modifier') return setHint(t('sc.needModifier'));
    if (accel === 'unsupported') return setHint(t('sc.unsupported'));
    if (!accel) return;
    // For "projects 1–9" only the modifiers count; the digit is added per project.
    onChange(modifiersOnly ? accel.split('+').slice(0, -1).join('+') : accel);
    setHint(null);
    stop();
  };

  const status = !value ? 'off' : conflict ? 'dup' : ok === false ? 'taken' : ok ? 'ok' : '';
  return (
    <span className="sc-field">
      <button
        className={`sc-key ${recording ? 'recording' : ''}`}
        onClick={() => {
          setRecording(true);
          setHint(null);
          window.api.suspendShortcuts(true);
        }}
        onBlur={stop}
        onKeyDown={onKeyDown}
        title={t('sc.record')}
      >
        {recording ? t('sc.recording') : value ? (modifiersOnly ? `${prettyAccel(`${value}+1`).slice(0, -1)}1…9` : prettyAccel(value)) : t('sc.off')}
      </button>
      {value && !recording && (
        <button className="icon-btn" title={t('sc.clear')} onClick={() => onChange('')}>
          <Icon name="close" size={16} />
        </button>
      )}
      <span className={`sc-status ${status}`}>
        {recording ? hint ?? '' : status === 'ok' ? t('sc.ok') : status === 'taken' ? t('sc.taken') : status === 'dup' ? t('sc.duplicate') : ''}
      </span>
    </span>
  );
}

function ShortcutEditor() {
  const { data, update } = useStore();
  const sc = data.settings.shortcuts;
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const set = (patch: Partial<typeof sc>) => update((d) => ({ ...d, settings: { ...d.settings, shortcuts: { ...d.settings.shortcuts, ...patch } } }));
  // Registration happens in the main process after the next menu-bar update; read the result shortly after.
  useEffect(() => {
    const t1 = setTimeout(() => window.api.shortcutStatus().then(setStatus), 1200);
    return () => clearTimeout(t1);
  }, [sc]);
  const used = [sc.quick, sc.stopResume, sc.breakToggle].filter(Boolean);
  const dup = (a: string) => used.filter((x) => x === a).length > 1;
  const rows: { key: 'quick' | 'stopResume' | 'breakToggle'; label: string }[] = [
    { key: 'quick', label: t('set.scQuick') },
    { key: 'stopResume', label: t('set.scStop') },
    { key: 'breakToggle', label: t('set.scBreak') },
  ];
  return (
    <div className="sc-editor">
      {rows.map((r) => (
        <div key={r.key} className="sc-row">
          <span>{r.label}</span>
          <ShortcutField value={sc[r.key]} ok={status[sc[r.key]]} conflict={dup(sc[r.key])} onChange={(v) => set({ [r.key]: v })} />
        </div>
      ))}
      <div className="sc-row">
        <span>
          {t('sc.projectsMod')}
          <span className="muted small field-hint">{t('sc.projectsHint')}</span>
        </span>
        <ShortcutField value={sc.projects} ok={sc.projects ? status[`${sc.projects}+1`] : undefined} modifiersOnly onChange={(v) => set({ projects: v })} />
      </div>
      <button className="btn ghost small" onClick={() => set({ ...DEFAULT_SHORTCUTS })}>
        <Icon name="restart_alt" size={16} /> {t('sc.reset')}
      </button>
    </div>
  );
}

const SERVER_ERRORS = ['bad_url', 'no_code', 'invalid_code', 'unreachable', 'unauthorized', 'not_connected'];
const serverError = (code: string) => (SERVER_ERRORS.includes(code) ? t(`srv.err.${code}` as MsgKey) : code);

function ServerSettings() {
  const { serverSync, runServerSync, refreshServer } = useStore();
  const [status, setStatus] = useState<{ connected: boolean; url?: string; name?: string } | null>(null);
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ code: string; svg: string; expiresAt: string } | null>(null);

  useEffect(() => {
    window.api.serverStatus().then(setStatus);
  }, []);

  // A pasted pairing link (https://…/#pair=ABCD-EFGH, from the server log or a phone) carries both address and code.
  const link = (() => {
    try {
      const u = new URL(code.trim());
      const c = u.hash.match(/pair=([A-Za-z0-9-]{8,10})/)?.[1];
      return c ? { url: u.origin, code: c } : null;
    } catch {
      return null;
    }
  })();

  const connect = async () => {
    setBusy(true);
    const r = await window.api.serverConnect(link?.url ?? url, link?.code ?? code);
    setBusy(false);
    if (!r.ok) return setError(serverError(r.error));
    setError(null);
    setCode('');
    setStatus(r);
    await refreshServer(); // starts the first sync
  };

  const disconnect = async () => {
    if (!confirm(t('srv.disconnectConfirm'))) return;
    setStatus(await window.api.serverDisconnect());
    setInvite(null);
    await refreshServer();
  };

  const connectPhone = async () => {
    const r = await window.api.serverPairCode('iPhone');
    if (!r.ok) return setError(serverError(r.error));
    setError(null);
    const qr = qrcode(0, 'M');
    qr.addData(r.link);
    qr.make();
    setInvite({ code: r.code, expiresAt: r.expiresAt, svg: qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }) });
  };

  if (!status) return null;
  return (
    <section className="card">
      <h3>{t('srv.title')}</h3>
      <p className="muted small">{t('srv.intro')}</p>
      {!status.connected ? (
        <>
          <label className="field">
            <span>{t('srv.url')}</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://gnomon.example.com" spellCheck={false} />
          </label>
          <label className="field">
            <span>{t('srv.code')}</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH" spellCheck={false} />
          </label>
          <p className="muted small">{t('srv.codeHint')}</p>
          <div className="add-row">
            <button className="btn" onClick={connect} disabled={busy || !code.trim() || (!link && !url.trim())}>
              <Icon name="sync" size={18} /> {busy ? t('srv.connecting') : t('srv.connect')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="small">{t('srv.connectedAs', { url: status.url ?? '', name: status.name ?? '' })}</p>
          <p className="muted small">{t('srv.syncIntro')}</p>
          <div className="add-row">
            <button className="btn ghost small" onClick={() => void runServerSync()} disabled={serverSync.busy}>
              <Icon name="sync" size={16} /> {serverSync.busy ? t('srv.syncing') : t('srv.syncNow')}
            </button>
            {serverSync.at && !serverSync.busy && <span className="muted small">{t('srv.syncedAt', { time: new Date(serverSync.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })}</span>}
          </div>
          {serverSync.error && <p className="error small">{t('srv.syncFailed', { error: SERVER_ERRORS.includes(serverSync.error) ? serverError(serverSync.error) : serverSync.error })}</p>}
          {invite && (
            <div className="server-invite">
              <div className="qr" dangerouslySetInnerHTML={{ __html: invite.svg }} />
              <div>
                <p className="invite-code">{invite.code}</p>
                <p className="muted small">{t('srv.scan', { time: new Date(invite.expiresAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })}</p>
              </div>
            </div>
          )}
          <div className="add-row">
            <button className="btn" onClick={connectPhone}>
              <Icon name="add" size={18} /> {invite ? t('srv.newCode') : t('srv.connectPhone')}
            </button>
            <button className="btn ghost small" onClick={disconnect}>
              {t('srv.disconnect')}
            </button>
          </div>
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

function ApiSettings() {
  const { data, update } = useStore();
  const s = data.settings;
  const set = (p: Partial<S>) => update((d) => ({ ...d, settings: { ...d.settings, ...p } }));
  const [hasKey, setHasKey] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [status, setStatus] = useState<{ running: boolean; address: { address: string; port: number } | null }>({ running: false, address: null });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.apiHasKey().then(setHasKey);
    return window.api.onApiError(setError);
  }, []);
  useEffect(() => {
    setError(null);
    const t = setTimeout(() => window.api.apiStatus().then(setStatus), 400);
    return () => clearTimeout(t);
  }, [s.apiEnabled, s.apiPort, s.apiLan]);

  const generate = async () => {
    if (hasKey && !confirm(t('api.newKeyConfirm'))) return;
    setNewKey(await window.api.apiGenerateKey());
    setHasKey(true);
  };

  return (
    <section className="card">
      <h3>API</h3>
      <p className="muted small">
        {t('api.intro')}
      </p>
      <label className="check-row">
        <input type="checkbox" checked={s.apiEnabled} onChange={(e) => set({ apiEnabled: e.target.checked })} />
        {t('api.enable')}
      </label>
      {s.apiEnabled && (
        <>
          <label className="field">
            <span>{t('api.port')}</span>
            <input type="number" min={1024} max={65535} value={s.apiPort} onChange={(e) => set({ apiPort: Math.min(65535, Math.max(1024, Number(e.target.value) || 7799)) })} />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={s.apiLan} onChange={(e) => set({ apiLan: e.target.checked })} />
            {t('api.lan')}
          </label>
          {s.apiLan && <p className="small neg">{t('api.lanWarning')}</p>}
          <p className="small">
            {status.running ? (
              <>
                <span className="pos">{t('api.running')}</span>
                {t('api.at')}
                <code>http://{s.apiLan ? t('api.thisMacIp') : '127.0.0.1'}:{s.apiPort}/api/v1</code>
              </>
            ) : (
              <span className="muted">{t('api.starting')}</span>
            )}
          </p>
          {error && <p className="error small">{error}</p>}
          <div className="add-row">
            <button className="btn" onClick={generate}>
              <Icon name="sync" size={18} /> {t(hasKey ? 'api.newKey' : 'api.createKey')}
            </button>
            {!hasKey && <span className="muted small">{t('api.noKey')}</span>}
          </div>
          {newKey && (
            <div className="key-box">
              <code>{newKey}</code>
              <button className="btn small" onClick={() => navigator.clipboard.writeText(newKey)}>
                {t('api.copy')}
              </button>
              <p className="muted small">{t('api.shownOnce')}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

type SettingsTab = 'general' | 'tracking' | 'menubar' | 'connections' | 'labs';
const TABS: { id: SettingsTab; icon: IconName; label: MsgKey }[] = [
  { id: 'general', icon: 'tune', label: 'set.tab.general' },
  { id: 'tracking', icon: 'timer', label: 'set.tab.tracking' },
  { id: 'menubar', icon: 'keyboard', label: 'set.tab.menubar' },
  { id: 'connections', icon: 'hub', label: 'set.tab.connections' },
  { id: 'labs', icon: 'science', label: 'set.tab.labs' },
];
const TAB_KEY = 'gnomon.settingsTab';

/** Opens on "settings@connections" etc. if linked, otherwise on the tab used last (per Mac, best effort). */
function initialTab(): SettingsTab {
  const fromHash = window.location.hash.split('@')[1];
  if (TABS.some((x) => x.id === fromHash)) return fromHash as SettingsTab;
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (TABS.some((x) => x.id === saved)) return saved as SettingsTab;
  } catch {
    /* storage unavailable: start on General */
  }
  return 'general';
}

/** Highlight colours; the full light/dark palettes are the [data-accent] rules in styles.css. */
const ACCENTS: { id: NonNullable<S['accent']>; color: string }[] = [
  { id: 'sun', color: '#f5b400' },
  { id: 'blue', color: '#03a9f4' },
  { id: 'green', color: '#2e9e5b' },
  { id: 'purple', color: '#7c5cff' },
  { id: 'coral', color: '#f0643c' },
];

/** Work schedule: hours per weekday, in periods that start on a date (see src/schedule.ts). */
function WorkScheduleCard() {
  const { data, update } = useStore();
  const s = data.settings;
  const periods = schedulesOf(data);
  const current = scheduleOn(data, dayKey(new Date())).from;
  const [adding, setAdding] = useState(false);
  const [from, setFrom] = useState(() => dayKey(new Date()));
  // Monday 1 Jan 2024 … Sunday 7 Jan 2024, for localized weekday names.
  const weekdays = Array.from({ length: 7 }, (_, i) => fmtDate(`2024-01-0${i + 1}`, { weekday: 'short' }));
  const setDay = (periodFrom: string, hours: number[], i: number, v: string) =>
    update((d) => setSchedule(d, periodFrom, hours.map((h, j) => (j === i ? Number(v.replace(',', '.')) || 0 : h))));

  return (
    <section className="card">
      <h3>{t('sched.title')}</h3>
      <p className="muted small section-hint">{t('sched.hint')}</p>
      <div className="sched-list">
        {[...periods].reverse().map((p) => (
          <div key={p.from} className={`sched ${p.from === current ? 'current' : ''}`}>
            <div className="sched-head">
              <strong>{p.from === SINCE_ALWAYS ? t('sched.always') : t('sched.since', { date: fmtDate(p.from, { day: 'numeric', month: 'short', year: 'numeric' }) })}</strong>
              {p.from === current && <span className="badge">{t('sched.current')}</span>}
              {p.source === 'personio' && <span className="badge">Personio</span>}
              <span className="muted">{t('sched.perWeek', { hours: String(weekTotal(p.hours)).replace('.', locale().startsWith('de') ? ',' : '.') })}</span>
              <span className="spacer" />
              {periods.length > 1 && p.from !== periods[0].from && (
                <button className="icon-btn" title={t('sched.remove')} onClick={() => update((d) => removeSchedule(d, p.from))}>
                  <Icon name="delete" size={18} />
                </button>
              )}
            </div>
            <div className="sched-days">
              {weekdays.map((name, i) => (
                <label key={name} className={p.hours[i] ? '' : 'free'}>
                  <span>{name}</span>
                  <input type="number" min={0} max={24} step={0.25} value={p.hours[i]} onChange={(e) => setDay(p.from, p.hours, i, e.target.value)} />
                </label>
              ))}
            </div>
            <div className="sched-presets">
              {SCHEDULE_PRESETS.map((pr) => (
                <button key={pr.id} className={`chip-btn ${pr.hours.join() === p.hours.join() ? 'active' : ''}`} onClick={() => update((d) => setSchedule(d, p.from, pr.hours))}>
                  {t(`sched.preset.${pr.id}`)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {adding ? (
        <div className="add-row sched-add">
          <span>{t('sched.from')}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <button
            className="btn primary"
            disabled={!from}
            onClick={() => {
              update((d) => setSchedule(d, from, scheduleOn(d, from).hours));
              setAdding(false);
            }}
          >
            {t('sched.add')}
          </button>
          <button className="btn ghost" onClick={() => setAdding(false)}>
            {t('sched.cancel')}
          </button>
        </div>
      ) : (
        <button className="btn ghost small" onClick={() => setAdding(true)}>
          <Icon name="add" size={18} /> {t('sched.change')}
        </button>
      )}
      <label className="check-row sched-count">
        <input type="checkbox" checked={Boolean(s.countAllScheduledDays)} onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, countAllScheduledDays: e.target.checked } }))} />
        <span>
          {t('sched.countAll')}
          <span className="muted small field-hint">{t('sched.countAllHint')}</span>
        </span>
      </label>
    </section>
  );
}

export default function Settings() {
  const { data, update, profile } = useStore();
  const s = data.settings;
  const set = (p: Partial<S>) => update((d) => ({ ...d, settings: { ...d.settings, ...p } }));
  const labs = s.labs ?? Boolean(s.daylightUnlocked);
  const [tab, setTab] = useState<SettingsTab>(() => {
    const first = initialTab();
    return first === 'labs' && !labs ? 'general' : first;
  });
  const choose = (id: SettingsTab) => {
    setTab(id);
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="page narrow settings-page">
      <nav className="settings-tabs" role="tablist">
        {TABS.filter((x) => x.id !== 'labs' || labs).map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={`settings-tab ${tab === x.id ? 'active' : ''}`} onClick={() => choose(x.id)}>
            <Icon name={x.icon} size={18} />
            {t(x.label)}
          </button>
        ))}
      </nav>

      {tab === 'labs' && labs && (
        <section className="card">
          <h3>
            <Icon name="science" size={20} /> {t('set.tab.labs')}
          </h3>
          <p className="muted small section-hint">{t('labs.hint')}</p>
          <div className="labs-row">
            <span>
              <strong>{t('set.morning')}</strong>
              <span className="muted small field-hint">{t('labs.morningHint')}</span>
            </span>
            <button className="btn" onClick={() => window.dispatchEvent(new Event('gnomon:morning-preview'))}>
              <Icon name="wb_sunny" size={18} /> {t('labs.morningShow')}
            </button>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={Boolean(s.daylight)} onChange={(e) => set({ daylight: e.target.checked })} />
            <span>
              {t('set.daylight')}
              <span className="muted small field-hint">{t('set.daylightHint')}</span>
            </span>
          </label>
          <div className="labs-row">
            <span>
              <strong>{t('tour.open')}</strong>
              <span className="muted small field-hint">{t('tour.openHint')}</span>
            </span>
            <button className="btn" onClick={() => set({ tourDone: false })}>
              <Icon name="waving_hand" size={18} /> {t('tour.open')}
            </button>
          </div>
          <div className="labs-row">
            <span className="muted small">{t('labs.hideHint')}</span>
            <button className="btn ghost" onClick={() => (set({ labs: false }), choose('general'))}>
              <Icon name="visibility_off" size={18} /> {t('labs.hide')}
            </button>
          </div>
        </section>
      )}

      {tab === 'general' && (
        <>
          <section className="card">
            <h3>{t('set.you')}</h3>
        <label className="field">
          <span>{t('set.language')}</span>
          <select value={s.language} onChange={(e) => set({ language: e.target.value as S['language'] })}>
            <option value="system">{t('set.langSystem', { name: LANGUAGE_NAMES[resolveLanguage('system')] })}</option>
            <option value="en">{LANGUAGE_NAMES.en}</option>
            <option value="de">{LANGUAGE_NAMES.de}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('set.appearance')}</span>
          <select value={s.appearance ?? 'system'} onChange={(e) => set({ appearance: e.target.value as S['appearance'] })}>
            <option value="system">{t('set.appearance.system')}</option>
            <option value="light">{t('set.appearance.light')}</option>
            <option value="dark">{t('set.appearance.dark')}</option>
          </select>
        </label>
        <div className="field">
          <span>{t('set.accent')}</span>
          <span className="accent-swatches" role="radiogroup" aria-label={t('set.accent')}>
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={(s.accent ?? 'sun') === a.id}
                className={`swatch ${(s.accent ?? 'sun') === a.id ? 'active' : ''}`}
                style={{ background: a.color }}
                title={t(`set.accent.${a.id}`)}
                onClick={() => set({ accent: a.id })}
              />
            ))}
          </span>
        </div>
        <label className="field">
          <span>
            {t('set.userName')}
            <span className="muted small field-hint">{t('set.userNameHint')}</span>
          </span>
          <input value={s.userName ?? ''} placeholder={t('set.userNamePlaceholder')} onChange={(e) => set({ userName: e.target.value || undefined })} />
        </label>
        <label className="field">
          <span>
            {t('set.balanceStart')}
            <span className="muted small field-hint">{t('set.balanceHint')}</span>
          </span>
          <span className="balance-fields">
            <input
              type="number"
              step={0.25}
              value={s.balanceStartHours}
              onChange={(e) => set({ balanceStartHours: Number(e.target.value) || 0 })}
              aria-label={t('set.balanceStart')}
            />
            {t('set.balanceDate')}
            <input type="date" value={s.balanceStartDate ?? ''} onChange={(e) => set({ balanceStartDate: e.target.value || undefined })} />
          </span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={s.billableEnabled} onChange={(e) => set({ billableEnabled: e.target.checked })} />
          {t('set.billable')}
        </label>
          </section>
          <WorkScheduleCard />
          <section className="card onb-entry">
            <span className="onb-entry-text">
              <strong>{t('tour.open')}</strong>
              <span className="muted small">{t('tour.openHint')}</span>
            </span>
            <button className="btn" onClick={() => set({ tourDone: false })}>
              <Icon name="waving_hand" size={18} /> {t('tour.open')}
            </button>
          </section>
        </>
      )}

      {tab === 'tracking' && (
        <>
          <section className="card">
            <h3>{t('set.clockIn')}</h3>
        <label className="field">
          <span>
            {t('style.setting')}
            <span className="muted small field-hint">{t('style.settingHint')}</span>
          </span>
          <select value={s.workStyle ?? ''} onChange={(e) => e.target.value && set(workStyleDefaults(e.target.value as 'clock' | 'live'))}>
            {!s.workStyle && <option value="">—</option>}
            <option value="clock">{t('style.clock')}</option>
            <option value="live">{t('style.live')}</option>
          </select>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={s.activitiesEnabled !== false} onChange={(e) => set({ activitiesEnabled: e.target.checked })} />
          <span>
            {t('set.activities')}
            <span className="muted small field-hint">{t('set.activitiesHint')}</span>
          </span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={s.morningWelcome !== false} onChange={(e) => set({ morningWelcome: e.target.checked })} />
          <span>
            {t('set.morning')}
            <span className="muted small field-hint">{t('set.morningHint')}</span>
          </span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={s.reminders !== false} onChange={(e) => set({ reminders: e.target.checked })} />
          <span>
            {t('rem.setting')}
            <span className="muted small field-hint">{t(s.workStyle === 'clock' ? 'rem.settingClock' : 'rem.settingLive')}</span>
          </span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={s.autoStartDay} onChange={(e) => set({ autoStartDay: e.target.checked })} />
          {t('set.autoStartDay')}
        </label>
        <label className="check-row">
          <input type="checkbox" checked={s.startDayWithTimer} onChange={(e) => set({ startDayWithTimer: e.target.checked })} />
          {t('set.startDayWithTimer')}
        </label>
          </section>
          <section className="card">
            <h3>{t('set.accurate')}</h3>
        <label className="field">
          <span>{t('set.idleAsk')}</span>
          <select value={s.idleMinutes} onChange={(e) => set({ idleMinutes: Number(e.target.value) })}>
            <option value={0}>{t('set.never')}</option>
            {[5, 10, 15, 30].map((n) => (
              <option key={n} value={n}>
                {t('set.minutes', { n })}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={s.autoStopMidnight} onChange={(e) => set({ autoStopMidnight: e.target.checked })} />
          {t('set.autoStop')}
        </label>
        <label className="check-row">
          <input type="checkbox" checked={s.reviewOnLeave} onChange={(e) => set({ reviewOnLeave: e.target.checked })} />
          {t('set.reviewOnLeave')}
        </label>
        {profile?.allowActivityTrail === false ? (
          <p className="muted small">{t('managed.trailOff')}</p>
        ) : (
          <>
            <label className="check-row">
              <input type="checkbox" checked={s.activityTrail} onChange={(e) => set({ activityTrail: e.target.checked })} />
              {t('set.trail')}
            </label>
            {s.activityTrail && <TrailStatus />}
          </>
        )}
        <p className="muted small">
          {t('set.trailInfo')}{' '}
          <button className="link" onClick={() => confirm(t('set.deleteTrailConfirm')) && window.api.trailClear()}>
            {t('set.deleteTrail')}
          </button>
        </p>
          </section>
        </>
      )}

      {tab === 'menubar' && (
        <section className="card">
        <label className="field">
          <span>{t('set.nextToIcon')}</span>
          <select value={s.menuBarLabel} onChange={(e) => set({ menuBarLabel: e.target.value as S['menuBarLabel'] })}>
            <option value="task">{t('set.labelTask')}</option>
            <option value="task-time">{t('set.labelTaskTime')}</option>
            <option value="workday">{t('set.labelWorkday')}</option>
            <option value="time">{t('set.labelTime')}</option>
            <option value="none">{t('set.labelNone')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('set.iconColor')}</span>
          <select value={s.menuBarColor} onChange={(e) => set({ menuBarColor: e.target.value as S['menuBarColor'] })}>
            <option value="project">{t('set.colorProject')}</option>
            <option value="activity">{t('set.colorActivity')}</option>
            <option value="mono">{t('set.colorMono')}</option>
          </select>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={s.shortcutsEnabled} onChange={(e) => set({ shortcutsEnabled: e.target.checked })} />
          {t('set.shortcuts')}
        </label>
        {/* Always visible, so you can see and change them; dimmed while switched off. */}
        {!s.shortcutsEnabled && <p className="muted small sc-off-note">{t('sc.offNote')}</p>}
        <div className={s.shortcutsEnabled ? undefined : 'sc-off'}>
          <ShortcutEditor />
        </div>
        <p className="muted small">
          {t('set.tip')}
        </p>
        </section>
      )}

      {tab === 'connections' && profile?.managed && (
        <>
          <section className="card managed-card">
            <span className="onb-icon">
              <Icon name="hub" size={26} />
            </span>
            <span className="onb-entry-text">
              <strong>{profile.companyName ? t('managed.titleNamed', { name: profile.companyName }) : t('managed.title')}</strong>
              <span className="muted small">{t('managed.text')}</span>
              {profile.serverUrl && (
                <span className="small">
                  {t('managed.server')}: <code>{profile.serverUrl}</code>
                </span>
              )}
            </span>
          </section>
          {/* Until company sign-in exists, a managed Mac connects with the invitation link from the Admin page. */}
          {profile.signIn !== 'oidc' && <ServerSettings />}
          {profile.allowLocalApi === false ? <p className="muted small">{t('managed.apiOff')}</p> : <ApiSettings />}
        </>
      )}

      {tab === 'connections' && !profile?.managed && (
        <>
      <section className="card onb-entry">
        <span className="onb-entry-text">
          <strong>{t('onb.open')}</strong>
          <span className="muted small">{t('onb.openHint')}</span>
        </span>
        <button className="btn" onClick={() => set({ onboardingDone: false })}>
          <Icon name="waving_hand" size={18} /> {t('onb.open')}
        </button>
      </section>
      <section className="card">
        <h3>Float</h3>
        <FloatConnect />
      </section>
      <section className="card">
        <h3>Personio</h3>
        <PersonioConnect />
      </section>
          <ServerSettings />
          {profile?.allowLocalApi === false ? <p className="muted small">{t('managed.apiOff')}</p> : <ApiSettings />}
        </>
      )}
    </div>
  );
}
