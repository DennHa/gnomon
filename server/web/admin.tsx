// The setup wizard (/setup) and the Admin page (/admin) for a company's Gnomon server (docs/company-setup.md).
// Access: the one-time code in the link (#code=…) is traded for a short session, kept in this tab only.
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import qrcode from 'qrcode-generator';
import { Icon, type IconName } from './icons';
import './styles.css';
import './admin.css';

// ---- Texts (English and German, by browser language) ----------------------------------------------

const EN = {
  title: 'Gnomon setup',
  adminTitle: 'Gnomon admin',
  signingIn: 'Opening the setup…',
  noLink: 'Open the link from the server log (setup) or create one with gnomon-admin admin-link (later changes).',
  linkFailed: 'This link didn’t work: {error}',
  step: 'Step {n} of {total}',
  next: 'Next',
  back: 'Back',
  skip: 'Skip for now',
  save: 'Save',
  saved: 'Saved',
  test: 'Test and save',
  testing: 'Testing…',
  disconnect: 'Disconnect',
  connectedSet: 'Connected',
  // 0
  beforeTitle: 'Before you start',
  beforeIntro: 'A quick checklist, so nothing surprises you halfway through. Only the first item is required; you can come back for the rest.',
  ckHttps: 'An HTTPS address for this server',
  ckHttpsWhy: 'Phones and Macs only talk to the server over HTTPS, for example gnomon.example.com.',
  ckSigned: 'A signed and notarized Gnomon app (Apple Developer ID)',
  ckSignedWhy:
    'macOS only runs apps from outside the App Store without questions when they’re signed with an Apple Developer ID (99 € a year) and notarized by Apple. Mac management tools such as Iru expect that too. Without it, a test with a few people works (each allows the app once); a rollout doesn’t. Use the official signed build, or sign it with your company’s own ID on a Mac.',
  ckLogin: 'A company login (Microsoft, Google, Okta…)',
  ckLoginWhy: 'Coming in a later version. Until then, people connect with a personal invitation link that you create here.',
  ckIntegrations: 'Admin access to Float and Personio',
  ckIntegrationsWhy: 'Only admins can create their API tokens. Without them, people enter plans and days off by hand.',
  ckMdm: 'Mac management (Iru or similar)',
  ckMdmWhy: 'Installs the app and its settings on every Mac. Without it, people install the app themselves and connect with their link.',
  // 1
  companyTitle: 'Your company',
  companyName: 'Company name',
  companyNameHint: 'Shown in the settings profile, e.g. “Gnomon (Acme)”.',
  publicUrl: 'This server’s address',
  publicUrlHint: 'The HTTPS address people reach it at.',
  publicUrlMismatch: 'You’re looking at this page through a different address ({here}). Check that the one above is the one people use.',
  timezone: 'Time zone',
  timezoneHint: 'Decides which day an entry belongs to.',
  target: 'Default daily target (hours)',
  targetHint: 'People can change their own work schedule later.',
  language: 'Default language',
  langSystem: 'Like the Mac',
  // 2
  signInTitle: 'Sign-in',
  signInSoon: 'Company sign-in (Microsoft, Google, Okta and other OpenID Connect logins) comes in a later version. For now, people connect with a personal invitation link from the last step.',
  // 3
  floatTitle: 'Float (optional)',
  floatIntro: 'Imports each person’s planned projects and time off. Gnomon only reads. The token is encrypted on this server and never sent to Macs or phones.',
  floatToken: 'Float API token',
  floatTokenHint: 'Float → Account Settings → Integrations (account owners and admins only).',
  floatOk: 'Connected · {n} people in Float',
  // 4
  personioTitle: 'Personio (optional)',
  personioIntro: 'Imports approved vacation, sick days and other absences as days off. Gnomon only reads. The credentials are encrypted on this server.',
  clientId: 'Client ID',
  clientSecret: 'Client secret',
  personioHint: 'Personio → Settings → API credentials, with read access to employees and absences.',
  personioOk: 'Connected · {n} people',
  personioMore: 'Connected · more than {n} people',
  dayOffTypes: 'These absence types become days off:',
  hourly: 'by the hour, entered by hand',
  // 6
  rulesTitle: 'Rules',
  rulesIntro: 'What Gnomon may do on your people’s Macs. In Germany, talk to the works council and data protection before rolling out a time-tracking tool.',
  rManaged: 'Hide personal setup on Macs',
  rManagedWhy: 'Float, Personio and server connections are handled here; people don’t see token fields.',
  rApi: 'Allow the local API on Macs',
  rApiWhy: 'Lets other programs on a Mac read and change its times. Off unless someone needs it.',
  rTrail: 'Offer the activity trail',
  rTrailWhy: 'An opt-in memory aid: which app was in front, once a minute. It never leaves the Mac.',
  rPhone: 'Phone web app on this server',
  rPhoneWhy: 'People can clock in and track from their phone at this address.',
  // 7
  rolloutTitle: 'Roll-out',
  rolloutIntro: 'Two files, and a checklist for your Mac management.',
  profile: 'Settings profile',
  profileWhy: 'Connects Gnomon to this server and applies your rules. It contains addresses and switches only, no tokens.',
  download: 'Download Gnomon.mobileconfig',
  needUrl: 'Enter the server’s address in step 2 first.',
  app: 'The app',
  appRelease: 'Gnomon {version} is ready to download from this server.',
  appDownload: 'Download Gnomon.dmg',
  appNone: 'No app has been published on this server yet. Put the signed Gnomon .dmg and its version.json into the releases folder (GNOMON_RELEASES_DIR), or download the official build.',
  appSigned: 'Use a build signed with an Apple Developer ID and notarized; otherwise Macs will block it.',
  iruTitle: 'In Iru (or your Mac management)',
  iru1: 'Add Gnomon.dmg as a custom app.',
  iru2: 'Add Gnomon.mobileconfig as a custom profile.',
  iru3: 'Assign both to one test Mac first and check that Gnomon opens and shows “Managed by your company”.',
  iru4: 'Then assign them to everyone.',
  // 8
  doneTitle: 'Done',
  doneIntro: 'The server is set up. The setup link from the log no longer works; for later changes, run gnomon-admin admin-link.',
  finish: 'Finish setup',
  finished: 'Setup finished',
  summary: 'Summary',
  sCompany: 'Company',
  sFloat: 'Float',
  sPersonio: 'Personio',
  sRules: 'Managed Macs',
  sKey: 'Token encryption',
  keyEnv: 'key from GNOMON_SECRET_KEY',
  keyFile: 'key file in the data folder. Better: set GNOMON_SECRET_KEY.',
  yes: 'yes',
  no: 'no',
  notSet: 'not connected',
  inviteTitle: 'Invite people',
  inviteIntro: 'Until company sign-in exists, each person gets a personal link. It works once and for 7 days, on a Mac (paste it in Settings → Connections) or a phone (scan it).',
  inviteName: 'Name or device',
  invite: 'Create link',
  copy: 'Copy',
  copied: 'Copied',
  history: 'Recent changes',
  devicesTitle: 'Devices',
  devicesIntro: 'Everything connected to this server. Rename a device, let it open this page, or disconnect it.',
  devMac: 'Mac',
  devPhone: 'Phone',
  devWeb: 'Browser',
  devUnknown: 'Device',
  devLastSeen: 'last seen {when}',
  devNever: 'not used yet',
  devSince: 'connected {date}',
  devJustNow: 'just now',
  devMinutes: '{n} min ago',
  devHours: '{n} h ago',
  devDays: '{n} days ago',
  devAdmin: 'Can open this page',
  devRename: 'Rename',
  devSave: 'Save',
  devDisconnect: 'Disconnect',
  devConfirm: 'Disconnect {name}? It stops syncing right away and needs a new code to connect again.',
  devNone: 'Nothing is connected yet.',
  addTitle: 'Add a device',
  addIntro: 'Scan the code with the phone’s camera, or open this server on the new device and type the code. It works once, for 10 minutes.',
  addName: 'Name, e.g. iPhone',
  addButton: 'Show code',
  addValid: 'Valid until {time}',
  setupGroup: 'Company setup',
};
type Key = keyof typeof EN;
const DE: Record<Key, string> = {
  title: 'Gnomon einrichten',
  adminTitle: 'Gnomon-Verwaltung',
  signingIn: 'Einrichtung wird geöffnet…',
  noLink: 'Öffne den Link aus dem Server-Log (Einrichtung) oder erzeuge einen mit gnomon-admin admin-link (spätere Änderungen).',
  linkFailed: 'Dieser Link hat nicht funktioniert: {error}',
  step: 'Schritt {n} von {total}',
  next: 'Weiter',
  back: 'Zurück',
  skip: 'Jetzt überspringen',
  save: 'Speichern',
  saved: 'Gespeichert',
  test: 'Testen und speichern',
  testing: 'Teste…',
  disconnect: 'Trennen',
  connectedSet: 'Verbunden',
  beforeTitle: 'Bevor du startest',
  beforeIntro: 'Eine kurze Checkliste, damit dich unterwegs nichts überrascht. Nur der erste Punkt ist Pflicht; den Rest kannst du später nachholen.',
  ckHttps: 'Eine HTTPS-Adresse für diesen Server',
  ckHttpsWhy: 'Handys und Macs sprechen nur über HTTPS mit dem Server, zum Beispiel gnomon.example.com.',
  ckSigned: 'Eine signierte und notarisierte Gnomon-App (Apple-Developer-ID)',
  ckSignedWhy:
    'macOS startet Apps von außerhalb des App Store nur ohne Nachfrage, wenn sie mit einer Apple-Developer-ID (99 € im Jahr) signiert und von Apple notarisiert sind. Mac-Verwaltungen wie Iru erwarten das auch. Ohne geht ein Test mit wenigen Leuten (jede Person erlaubt die App einmal), aber kein Rollout. Nimm die offizielle signierte Version oder signiere sie auf einem Mac mit der ID deiner Firma.',
  ckLogin: 'Ein Firmen-Login (Microsoft, Google, Okta…)',
  ckLoginWhy: 'Kommt in einer späteren Version. Bis dahin verbinden sich alle mit einem persönlichen Einladungslink, den du hier erstellst.',
  ckIntegrations: 'Admin-Zugang zu Float und Personio',
  ckIntegrationsWhy: 'Nur Admins können die API-Tokens erstellen. Ohne sie tragen alle Planung und freie Tage selbst ein.',
  ckMdm: 'Mac-Verwaltung (Iru oder ähnlich)',
  ckMdmWhy: 'Installiert App und Einstellungen auf jedem Mac. Ohne installieren alle die App selbst und verbinden sich mit ihrem Link.',
  companyTitle: 'Deine Firma',
  companyName: 'Firmenname',
  companyNameHint: 'Erscheint im Einstellungsprofil, z. B. „Gnomon (Acme)“.',
  publicUrl: 'Adresse dieses Servers',
  publicUrlHint: 'Die HTTPS-Adresse, unter der alle ihn erreichen.',
  publicUrlMismatch: 'Du siehst diese Seite über eine andere Adresse ({here}). Prüf, ob die oben die richtige für alle ist.',
  timezone: 'Zeitzone',
  timezoneHint: 'Entscheidet, zu welchem Tag ein Eintrag gehört.',
  target: 'Standard-Tagessoll (Stunden)',
  targetHint: 'Jede Person kann ihre Arbeitszeit später selbst anpassen.',
  language: 'Standardsprache',
  langSystem: 'Wie der Mac',
  signInTitle: 'Anmeldung',
  signInSoon: 'Die Anmeldung mit dem Firmen-Login (Microsoft, Google, Okta und andere OpenID-Connect-Logins) kommt in einer späteren Version. Bis dahin verbinden sich alle mit einem persönlichen Einladungslink aus dem letzten Schritt.',
  floatTitle: 'Float (optional)',
  floatIntro: 'Übernimmt für jede Person die geplanten Projekte und Abwesenheiten. Gnomon liest nur. Der Token wird auf diesem Server verschlüsselt und nie an Macs oder Handys geschickt.',
  floatToken: 'Float-API-Token',
  floatTokenHint: 'Float → Account Settings → Integrations (nur für Account-Inhaber und Admins).',
  floatOk: 'Verbunden · {n} Personen in Float',
  personioTitle: 'Personio (optional)',
  personioIntro: 'Übernimmt genehmigten Urlaub, Krankheit und andere Abwesenheiten als freie Tage. Gnomon liest nur. Die Zugangsdaten werden auf diesem Server verschlüsselt.',
  clientId: 'Client-ID',
  clientSecret: 'Client-Secret',
  personioHint: 'Personio → Einstellungen → API-Zugangsdaten, mit Lesezugriff auf Mitarbeitende und Abwesenheiten.',
  personioOk: 'Verbunden · {n} Personen',
  personioMore: 'Verbunden · mehr als {n} Personen',
  dayOffTypes: 'Diese Abwesenheitsarten werden zu freien Tagen:',
  hourly: 'stundenweise, wird selbst eingetragen',
  rulesTitle: 'Regeln',
  rulesIntro: 'Was Gnomon auf den Macs deiner Leute darf. In Deutschland vor der Einführung eines Zeiterfassungs-Tools mit Betriebsrat und Datenschutz sprechen.',
  rManaged: 'Persönliche Einrichtung auf Macs ausblenden',
  rManagedWhy: 'Float, Personio und Server-Verbindung laufen hier; niemand sieht Token-Felder.',
  rApi: 'Lokale API auf Macs erlauben',
  rApiWhy: 'Andere Programme auf einem Mac können dessen Zeiten lesen und ändern. Aus, außer jemand braucht es.',
  rTrail: 'Aktivitätsspur anbieten',
  rTrailWhy: 'Eine freiwillige Gedächtnisstütze: welche App vorne war, einmal pro Minute. Sie verlässt den Mac nie.',
  rPhone: 'Handy-Web-App auf diesem Server',
  rPhoneWhy: 'Alle können sich unter dieser Adresse auch per Handy einstempeln und Zeiten erfassen.',
  rolloutTitle: 'Verteilen',
  rolloutIntro: 'Zwei Dateien und eine Checkliste für deine Mac-Verwaltung.',
  profile: 'Einstellungsprofil',
  profileWhy: 'Verbindet Gnomon mit diesem Server und setzt deine Regeln. Es enthält nur Adressen und Schalter, keine Tokens.',
  download: 'Gnomon.mobileconfig herunterladen',
  needUrl: 'Trag zuerst in Schritt 2 die Adresse des Servers ein.',
  app: 'Die App',
  appRelease: 'Gnomon {version} liegt auf diesem Server zum Herunterladen bereit.',
  appDownload: 'Gnomon.dmg herunterladen',
  appNone: 'Auf diesem Server liegt noch keine App. Leg die signierte Gnomon-.dmg und ihre version.json in den Releases-Ordner (GNOMON_RELEASES_DIR) oder lade die offizielle Version herunter.',
  appSigned: 'Nimm eine mit Apple-Developer-ID signierte und notarisierte Version, sonst blockieren die Macs sie.',
  iruTitle: 'In Iru (oder deiner Mac-Verwaltung)',
  iru1: 'Gnomon.dmg als eigene App hinzufügen.',
  iru2: 'Gnomon.mobileconfig als eigenes Profil hinzufügen.',
  iru3: 'Beides zuerst einem Test-Mac zuweisen und prüfen, dass Gnomon startet und „Von deiner Firma verwaltet“ zeigt.',
  iru4: 'Dann allen zuweisen.',
  doneTitle: 'Fertig',
  doneIntro: 'Der Server ist eingerichtet. Der Einrichtungslink aus dem Log funktioniert nicht mehr; für spätere Änderungen gnomon-admin admin-link ausführen.',
  finish: 'Einrichtung abschließen',
  finished: 'Einrichtung abgeschlossen',
  summary: 'Übersicht',
  sCompany: 'Firma',
  sFloat: 'Float',
  sPersonio: 'Personio',
  sRules: 'Verwaltete Macs',
  sKey: 'Token-Verschlüsselung',
  keyEnv: 'Schlüssel aus GNOMON_SECRET_KEY',
  keyFile: 'Schlüsseldatei im Datenordner. Besser: GNOMON_SECRET_KEY setzen.',
  yes: 'ja',
  no: 'nein',
  notSet: 'nicht verbunden',
  inviteTitle: 'Leute einladen',
  inviteIntro: 'Bis es den Firmen-Login gibt, bekommt jede Person einen persönlichen Link. Er funktioniert einmal und 7 Tage lang, auf dem Mac (in Einstellungen → Verbindungen einfügen) oder am Handy (scannen).',
  inviteName: 'Name oder Gerät',
  invite: 'Link erstellen',
  copy: 'Kopieren',
  copied: 'Kopiert',
  history: 'Letzte Änderungen',
  devicesTitle: 'Geräte',
  devicesIntro: 'Alles, was mit diesem Server verbunden ist. Ein Gerät umbenennen, diese Seite öffnen lassen oder trennen.',
  devMac: 'Mac',
  devPhone: 'Handy',
  devWeb: 'Browser',
  devUnknown: 'Gerät',
  devLastSeen: 'zuletzt aktiv {when}',
  devNever: 'noch nicht benutzt',
  devSince: 'verbunden am {date}',
  devJustNow: 'gerade eben',
  devMinutes: 'vor {n} Min.',
  devHours: 'vor {n} Std.',
  devDays: 'vor {n} Tagen',
  devAdmin: 'Darf diese Seite öffnen',
  devRename: 'Umbenennen',
  devSave: 'Sichern',
  devDisconnect: 'Trennen',
  devConfirm: '{name} trennen? Es synchronisiert sofort nicht mehr und braucht zum Wiederverbinden einen neuen Code.',
  devNone: 'Noch nichts verbunden.',
  addTitle: 'Gerät hinzufügen',
  addIntro: 'Den Code mit der Handykamera scannen, oder auf dem neuen Gerät diesen Server öffnen und den Code eintippen. Er gilt einmal, 10 Minuten lang.',
  addName: 'Name, z. B. iPhone',
  addButton: 'Code zeigen',
  addValid: 'Gültig bis {time}',
  setupGroup: 'Firmen-Einrichtung',
};
const L = /^de\b/i.test(navigator.language) ? DE : EN;
const t = (k: Key, vars: Record<string, string | number> = {}) => L[k].replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? ''));

// ---- API ----------------------------------------------------------------------------------------

type Config = {
  setupDone: boolean;
  checklist: Record<'https' | 'signedApp' | 'companyLogin' | 'integrations' | 'macManagement', boolean>;
  company: { name: string; publicUrl: string; timezone: string; dailyTargetHours: number; language: 'system' | 'en' | 'de' };
  float: { tested?: string; people?: number };
  personio: { tested?: string; people?: number; absenceTypes?: { id: string; name: string; unit?: string }[]; dayOffTypes?: string[] };
  rules: Record<'managed' | 'allowLocalApi' | 'allowActivityTrail' | 'phoneApp', boolean>;
  audit: { at: string; what: string }[];
};
type State = { config: Config; secrets: { float: boolean; personio: boolean }; keySource: 'env' | 'file'; release: { version: string; size: number } | null; devices: number };

let token = '';
try {
  token = sessionStorage.getItem('gnomon.admin') ?? '';
} catch {
  /* private mode */
}
async function call<T = State>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/admin${path}`, {
    method,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || res.statusText);
  return json as T;
}

// ---- Pieces ---------------------------------------------------------------------------------------

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="a-field">
      <span className="a-label">{label}</span>
      {children}
      {hint && <span className="a-hint">{hint}</span>}
    </label>
  );
}

function Toggle({ on, onChange, label, why }: { on: boolean; onChange: (v: boolean) => void; label: string; why: string }) {
  return (
    <label className="a-check">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>{label}</strong>
        <span className="a-hint">{why}</span>
      </span>
    </label>
  );
}

function Qr({ text }: { text: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return <img className="a-qr" alt="" src={qr.createDataURL(5, 2)} />;
}

const saveFile = (name: string, content: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ---- Screens --------------------------------------------------------------------------------------

type Ctx = { s: State; setS: (s: State) => void; err: string | null; setErr: (e: string | null) => void };

function Before({ s, setS }: Ctx) {
  const c = s.config.checklist;
  const set = async (k: keyof Config['checklist'], v: boolean) => setS(await call('PUT', '/config', { checklist: { [k]: v } }));
  const items: [keyof Config['checklist'], Key, Key, IconName][] = [
    ['https', 'ckHttps', 'ckHttpsWhy', 'lock'],
    ['signedApp', 'ckSigned', 'ckSignedWhy', 'verified_user'],
    ['companyLogin', 'ckLogin', 'ckLoginWhy', 'group'],
    ['integrations', 'ckIntegrations', 'ckIntegrationsWhy', 'link'],
    ['macManagement', 'ckMdm', 'ckMdmWhy', 'apartment'],
  ];
  return (
    <>
      <p className="a-intro">{t('beforeIntro')}</p>
      <div className="a-list">
        {items.map(([k, label, why, icon]) => (
          <label key={k} className={`a-item ${c[k] ? 'done' : ''}`}>
            <input type="checkbox" checked={c[k]} onChange={(e) => set(k, e.target.checked)} />
            <Icon name={icon} size={22} />
            <span>
              <strong>{t(label)}</strong>
              <span className="a-hint">{t(why)}</span>
            </span>
          </label>
        ))}
      </div>
    </>
  );
}

function CompanyStep({ s, setS, setErr }: Ctx) {
  const [v, setV] = useState(s.config.company);
  const [saved, setSaved] = useState(false);
  const here = location.origin;
  const save = async () => {
    try {
      setS(await call('PUT', '/config', { company: v }));
      setErr(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    if (!v.publicUrl && here.startsWith('https://')) setV({ ...v, publicUrl: here });
  }, []);
  return (
    <>
      <Field label={t('companyName')} hint={t('companyNameHint')}>
        <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Acme" />
      </Field>
      <Field label={t('publicUrl')} hint={t('publicUrlHint')}>
        <input value={v.publicUrl} onChange={(e) => setV({ ...v, publicUrl: e.target.value })} placeholder="https://gnomon.example.com" spellCheck={false} />
      </Field>
      {v.publicUrl && v.publicUrl.replace(/\/$/, '') !== here && <p className="a-warn">{t('publicUrlMismatch', { here })}</p>}
      <div className="a-row">
        <Field label={t('timezone')} hint={t('timezoneHint')}>
          <input value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} spellCheck={false} />
        </Field>
        <Field label={t('target')} hint={t('targetHint')}>
          <input type="number" min={1} max={24} step={0.25} value={v.dailyTargetHours} onChange={(e) => setV({ ...v, dailyTargetHours: Number(e.target.value) || 8 })} />
        </Field>
        <Field label={t('language')}>
          <select value={v.language} onChange={(e) => setV({ ...v, language: e.target.value as Config['company']['language'] })}>
            <option value="system">{t('langSystem')}</option>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </Field>
      </div>
      <button className="primary a-save" onClick={save}>
        {saved ? t('saved') : t('save')}
      </button>
    </>
  );
}

function SignIn() {
  return <p className="a-intro">{t('signInSoon')}</p>;
}

function FloatStep({ s, setS, setErr }: Ctx) {
  const [tok, setTok] = useState('');
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    try {
      setS(await call('POST', '/float', { token: tok }));
      setTok('');
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <>
      <p className="a-intro">{t('floatIntro')}</p>
      {s.secrets.float ? (
        <div className="a-ok">
          <Icon name="check_circle" /> {t('floatOk', { n: s.config.float.people ?? 0 })}
          <span className="spacer" />
          <button className="soft" onClick={async () => setS(await call('DELETE', '/float'))}>
            {t('disconnect')}
          </button>
        </div>
      ) : (
        <>
          <Field label={t('floatToken')} hint={t('floatTokenHint')}>
            <input type="password" value={tok} onChange={(e) => setTok(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <button className="primary a-save" disabled={!tok.trim() || busy} onClick={test}>
            {busy ? t('testing') : t('test')}
          </button>
        </>
      )}
    </>
  );
}

function PersonioStep({ s, setS, setErr }: Ctx) {
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const p = s.config.personio;
  const test = async () => {
    setBusy(true);
    try {
      const r = await call<State & { morePeople?: boolean }>('POST', '/personio', { clientId: id, clientSecret: secret });
      setMore(Boolean(r.morePeople));
      setS(r);
      setId('');
      setSecret('');
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  const toggleType = async (typeId: string, on: boolean) => {
    const cur = new Set(p.dayOffTypes ?? []);
    if (on) cur.add(typeId);
    else cur.delete(typeId);
    setS(await call('PUT', '/config', { personio: { dayOffTypes: [...cur] } }));
  };
  return (
    <>
      <p className="a-intro">{t('personioIntro')}</p>
      {s.secrets.personio ? (
        <>
          <div className="a-ok">
            <Icon name="check_circle" /> {t(more ? 'personioMore' : 'personioOk', { n: p.people ?? 0 })}
            <span className="spacer" />
            <button className="soft" onClick={async () => setS(await call('DELETE', '/personio'))}>
              {t('disconnect')}
            </button>
          </div>
          {Boolean(p.absenceTypes?.length) && (
            <div className="a-types">
              <span className="a-label">{t('dayOffTypes')}</span>
              {p.absenceTypes!.map((ty) => (
                <label key={ty.id} className="a-type">
                  <input type="checkbox" disabled={ty.unit === 'HOUR'} checked={!!p.dayOffTypes?.includes(ty.id)} onChange={(e) => toggleType(ty.id, e.target.checked)} />
                  {ty.name}
                  {ty.unit === 'HOUR' && <span className="a-hint"> · {t('hourly')}</span>}
                </label>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="a-row">
            <Field label={t('clientId')}>
              <input value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label={t('clientSecret')}>
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
          </div>
          <p className="a-hint">{t('personioHint')}</p>
          <button className="primary a-save" disabled={!id.trim() || !secret.trim() || busy} onClick={test}>
            {busy ? t('testing') : t('test')}
          </button>
        </>
      )}
    </>
  );
}

function RulesStep({ s, setS }: Ctx) {
  const r = s.config.rules;
  const set = async (k: keyof Config['rules'], v: boolean) => setS(await call('PUT', '/config', { rules: { [k]: v } }));
  return (
    <>
      <p className="a-intro">{t('rulesIntro')}</p>
      <div className="a-list">
        <Toggle on={r.managed} onChange={(v) => set('managed', v)} label={t('rManaged')} why={t('rManagedWhy')} />
        <Toggle on={r.allowLocalApi} onChange={(v) => set('allowLocalApi', v)} label={t('rApi')} why={t('rApiWhy')} />
        <Toggle on={r.allowActivityTrail} onChange={(v) => set('allowActivityTrail', v)} label={t('rTrail')} why={t('rTrailWhy')} />
        <Toggle on={r.phoneApp} onChange={(v) => set('phoneApp', v)} label={t('rPhone')} why={t('rPhoneWhy')} />
      </div>
    </>
  );
}

function Rollout({ s, setErr }: Ctx) {
  const url = s.config.company.publicUrl;
  const profile = async () => {
    try {
      const r = await call<{ filename: string; profile: string }>('GET', '/profile');
      saveFile(r.filename, r.profile, 'application/x-apple-aspen-config');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <>
      <p className="a-intro">{t('rolloutIntro')}</p>
      <div className="a-card">
        <strong>{t('profile')}</strong>
        <span className="a-hint">{t('profileWhy')}</span>
        {url ? (
          <button className="primary a-save" onClick={profile}>
            <Icon name="download" size={18} /> {t('download')}
          </button>
        ) : (
          <p className="a-warn">{t('needUrl')}</p>
        )}
      </div>
      <div className="a-card">
        <strong>{t('app')}</strong>
        {s.release ? (
          <>
            <span className="a-hint">{t('appRelease', { version: s.release.version })}</span>
            <a className="primary a-save a-btn" href="/latest/download">
              <Icon name="download" size={18} /> {t('appDownload')}
            </a>
          </>
        ) : (
          <span className="a-hint">{t('appNone')}</span>
        )}
        <p className="a-warn">{t('appSigned')}</p>
      </div>
      <div className="a-card">
        <strong>{t('iruTitle')}</strong>
        <ol>
          <li>{t('iru1')}</li>
          <li>{t('iru2')}</li>
          <li>{t('iru3')}</li>
          <li>{t('iru4')}</li>
        </ol>
      </div>
    </>
  );
}

function Invite({ s }: Ctx) {
  const [name, setName] = useState('');
  const [link, setLink] = useState<{ name: string; code: string; link: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="a-card">
      <strong>{t('inviteTitle')}</strong>
      <span className="a-hint">{t('inviteIntro')}</span>
      <div className="a-inline">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('inviteName')} />
        <button className="primary" onClick={async () => setLink(await call('POST', '/invite', { name }))}>
          <Icon name="link" size={18} /> {t('invite')}
        </button>
      </div>
      {link && (
        <div className="a-invite">
          {link.link && <Qr text={link.link} />}
          <div>
            <strong>{link.name}</strong>
            <code>{link.link ?? link.code}</code>
            <button
              className="soft"
              onClick={() => {
                navigator.clipboard?.writeText(link.link ?? link.code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? t('copied') : t('copy')}
            </button>
          </div>
        </div>
      )}
      {!s.config.company.publicUrl && <p className="a-warn">{t('needUrl')}</p>}
    </div>
  );
}

function Done(ctx: Ctx) {
  const { s, setS } = ctx;
  const c = s.config;
  const rows: [Key, string][] = [
    ['sCompany', [c.company.name, c.company.publicUrl].filter(Boolean).join(' · ') || '—'],
    ['sFloat', ctx.s.secrets.float ? t('floatOk', { n: c.float.people ?? 0 }) : t('notSet')],
    ['sPersonio', ctx.s.secrets.personio ? t('personioOk', { n: c.personio.people ?? 0 }) : t('notSet')],
    ['sRules', t(c.rules.managed ? 'yes' : 'no')],
    ['sKey', t(s.keySource === 'env' ? 'keyEnv' : 'keyFile')],
  ];
  return (
    <>
      <p className="a-intro">{t('doneIntro')}</p>
      <div className="a-card">
        <strong>{t('summary')}</strong>
        <dl className="a-summary">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{t(k)}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {!c.setupDone ? (
          <button className="primary a-save" onClick={async () => setS(await call('POST', '/finish'))}>
            <Icon name="rocket_launch" size={18} /> {t('finish')}
          </button>
        ) : (
          <div className="a-ok">
            <Icon name="check_circle" /> {t('finished')}
          </div>
        )}
      </div>
      <Invite {...ctx} />
      {c.audit.length > 0 && (
        <div className="a-card">
          <strong>{t('history')}</strong>
          <ul className="a-audit">
            {c.audit.slice(0, 8).map((a) => (
              <li key={a.at + a.what}>
                <span className="a-hint">{new Date(a.at).toLocaleString()}</span> {a.what}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}


// ---- Devices (the Admin page's first section) -----------------------------------------------------

type Device = { id: string; name: string; createdAt: string; lastSeenAt: string | null; client?: string | null; admin?: boolean };

/** Mac, phone or browser: from how it connected, or guessed from the name for devices from before that was recorded. */
const kindOf = (d: Device): 'mac' | 'phone' | 'web' | null =>
  (d.client as 'mac' | 'phone' | 'web' | null) ?? (/mac|book|imac/i.test(d.name) ? 'mac' : /phone|handy|pixel|android|ipad/i.test(d.name) ? 'phone' : null);
const KIND: Record<string, [IconName, Key]> = { mac: ['laptop_mac', 'devMac'], phone: ['mobile', 'devPhone'], web: ['language', 'devWeb'] };

function ago(iso: string | null): string {
  if (!iso) return t('devNever');
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  const when = min < 2 ? t('devJustNow') : min < 60 ? t('devMinutes', { n: min }) : min < 48 * 60 ? t('devHours', { n: Math.round(min / 60) }) : t('devDays', { n: Math.round(min / 1440) });
  return t('devLastSeen', { when });
}

function DeviceRow({ d, setDevices, setErr }: { d: Device; setDevices: (l: Device[]) => void; setErr: (e: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.name);
  const [icon, label] = KIND[kindOf(d) ?? ''] ?? ['devices', 'devUnknown'];
  const run = async (method: string, body?: unknown) => {
    try {
      setErr(null);
      setDevices((await call<{ devices: Device[] }>(method, `/devices/${d.id}`, body)).devices);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <li className="a-device">
      <span className="a-device-icon" title={t(label)}>
        <Icon name={icon} size={22} />
      </span>
      <div className="a-device-main">
        {editing ? (
          <form className="a-inline" onSubmit={(e) => (e.preventDefault(), run('PATCH', { name }).then(() => setEditing(false)))}>
            <input value={name} autoFocus maxLength={60} onChange={(e) => setName(e.target.value)} />
            <button className="primary">{t('devSave')}</button>
          </form>
        ) : (
          <strong>{d.name}</strong>
        )}
        <span className="a-hint">
          {t(label)} · {ago(d.lastSeenAt)} · {t('devSince', { date: new Date(d.createdAt).toLocaleDateString() })}
        </span>
        <label className="a-device-admin">
          <input type="checkbox" checked={Boolean(d.admin)} onChange={(e) => run('PATCH', { admin: e.target.checked })} /> {t('devAdmin')}
        </label>
      </div>
      <div className="a-device-actions">
        {!editing && (
          <button className="soft" title={t('devRename')} onClick={() => setEditing(true)}>
            <Icon name="edit" size={18} />
          </button>
        )}
        <button className="soft danger" title={t('devDisconnect')} onClick={() => confirm(t('devConfirm', { name: d.name })) && run('DELETE')}>
          <Icon name="link_off" size={18} /> {t('devDisconnect')}
        </button>
      </div>
    </li>
  );
}

function AddDevice({ s }: Ctx) {
  const [name, setName] = useState('');
  const [code, setCode] = useState<{ name: string; code: string; expiresAt: string } | null>(null);
  // The phone app connects by itself when opened with #pair=CODE (scanning the QR code does exactly that).
  const base = (s.config.company.publicUrl || location.origin).replace(/\/+$/, '');
  const link = code ? `${base}/#pair=${code.code}` : '';
  return (
    <div className="a-card">
      <strong>
        <Icon name="qr_code_2" size={18} /> {t('addTitle')}
      </strong>
      <span className="a-hint">{t('addIntro')}</span>
      <form className="a-inline" onSubmit={async (e) => (e.preventDefault(), setCode(await call('POST', '/pair', { name })))}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('addName')} maxLength={60} />
        <button className="primary">{t('addButton')}</button>
      </form>
      {code && (
        <div className="a-invite">
          <Qr text={link} />
          <div>
            <strong>{code.name}</strong>
            <code className="a-code">{code.code}</code>
            <span className="a-hint">{t('addValid', { time: new Date(code.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Devices(ctx: Ctx) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  useEffect(() => {
    call<{ devices: Device[] }>('GET', '/devices').then((r) => setDevices(r.devices), (e) => ctx.setErr((e as Error).message));
  }, []);
  return (
    <>
      <p className="a-intro">{t('devicesIntro')}</p>
      {devices && devices.length === 0 && <p className="a-hint">{t('devNone')}</p>}
      {devices && devices.length > 0 && (
        <ul className="a-devices">
          {devices.map((d) => (
            <DeviceRow key={d.id} d={d} setDevices={setDevices} setErr={ctx.setErr} />
          ))}
        </ul>
      )}
      <AddDevice {...ctx} />
    </>
  );
}

// ---- App ------------------------------------------------------------------------------------------

type Section = { key: string; title: Key; icon: IconName; view: (ctx: Ctx) => ReactNode };
const DEVICES: Section = { key: 'devices', title: 'devicesTitle', icon: 'devices', view: (c) => <Devices {...c} /> };
const STEPS: Section[] = [
  { key: 'before', title: 'beforeTitle', icon: 'check_circle', view: (c) => <Before {...c} /> },
  { key: 'company', title: 'companyTitle', icon: 'apartment', view: (c) => <CompanyStep {...c} /> },
  { key: 'signin', title: 'signInTitle', icon: 'group', view: () => <SignIn /> },
  { key: 'float', title: 'floatTitle', icon: 'link', view: (c) => <FloatStep {...c} /> },
  { key: 'personio', title: 'personioTitle', icon: 'link', view: (c) => <PersonioStep {...c} /> },
  { key: 'rules', title: 'rulesTitle', icon: 'lock', view: (c) => <RulesStep {...c} /> },
  { key: 'rollout', title: 'rolloutTitle', icon: 'download', view: (c) => <Rollout {...c} /> },
  { key: 'done', title: 'doneTitle', icon: 'rocket_launch', view: (c) => <Done {...c} /> },
];

function App() {
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const admin = location.pathname.startsWith('/admin');
  // The Admin page opens on the devices; the company setup follows as its own group.
  const SECTIONS = admin ? [DEVICES, ...STEPS] : STEPS;
  const offset = admin ? 1 : 0;

  useEffect(() => {
    // Trade the one-time code from the link for a session, then take the code out of the address bar.
    const code = new URLSearchParams(location.hash.slice(1)).get('code');
    (async () => {
      try {
        if (code) {
          history.replaceState(null, '', location.pathname);
          const r = await call<State & { token: string }>('POST', '/session', { code });
          token = r.token;
          try {
            sessionStorage.setItem('gnomon.admin', token);
          } catch {
            /* this tab only */
          }
          setS(r);
          if (r.config.setupDone && !admin) setStep(STEPS.length - 1);
        } else if (token) setS(await call('GET', '/state'));
        else setFatal(t('noLink'));
      } catch (e) {
        setFatal(code ? t('linkFailed', { error: (e as Error).message }) : t('noLink'));
      }
    })();
  }, []);

  useEffect(() => {
    document.title = t(admin ? 'adminTitle' : 'title');
  }, []);

  if (fatal)
    return (
      <main className="a-page">
        <h1>{t(admin ? 'adminTitle' : 'title')}</h1>
        <p className="a-warn">{fatal}</p>
      </main>
    );
  if (!s)
    return (
      <main className="a-page">
        <p className="a-hint">{t('signingIn')}</p>
      </main>
    );

  const ctx: Ctx = { s, setS, err, setErr };
  const cur = SECTIONS[step];
  const isStep = step >= offset;
  return (
    <main className="a-page">
      <header className="a-head">
        <img src="/icon-192.png" alt="" width={44} height={44} />
        <div>
          <h1>{t(admin || s.config.setupDone ? 'adminTitle' : 'title')}</h1>
          <span className="a-hint">{s.config.company.name || s.config.company.publicUrl || location.host}</span>
        </div>
      </header>
      <div className="a-body">
        <nav className="a-steps">
          {SECTIONS.map((st, i) => (
            <Fragment key={st.key}>
              {admin && i === offset && <span className="a-group">{t('setupGroup')}</span>}
              <button className={`a-step ${i === step ? 'on' : ''} ${i < step && i >= offset ? 'past' : ''}`} onClick={() => (setStep(i), setErr(null))}>
                <span className="a-num">{i < offset ? <Icon name={st.icon} size={14} /> : i - offset + 1}</span>
                {t(st.title)}
              </button>
            </Fragment>
          ))}
        </nav>
        <section className="a-panel">
          {isStep && <span className="a-hint">{t('step', { n: step - offset + 1, total: STEPS.length })}</span>}
          <h2>
            <Icon name={cur.icon} size={24} /> {t(cur.title)}
          </h2>
          {err && (
            <p className="a-error">
              <Icon name="warning" size={18} /> {err}
            </p>
          )}
          {cur.view(ctx)}
          <footer className="a-foot">
            {step > offset && (
              <button className="soft" onClick={() => (setStep(step - 1), setErr(null))}>
                <Icon name="arrow_back" size={18} /> {t('back')}
              </button>
            )}
            <span className="spacer" />
            {isStep && step < SECTIONS.length - 1 && (
              <button className="primary" onClick={() => (setStep(step + 1), setErr(null))}>
                {['float', 'personio'].includes(cur.key) && !s.secrets[cur.key as 'float' | 'personio'] ? t('skip') : t('next')} <Icon name="arrow_forward" size={18} />
              </button>
            )}
          </footer>
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
