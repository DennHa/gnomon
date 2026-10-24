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
  loginTitle: 'Sign in',
  loginIntro: 'Enter this server’s admin password.',
  password: 'Password',
  signIn: 'Sign in',
  signOut: 'Sign out',
  noPassword: 'This server has no admin password yet. Open the admin page once from your Mac (Gnomon → Settings → Connections → Open server admin), or with the link from the server log, and set one there.',
  accountTitle: 'Admin password',
  pwIntro: 'With a password you sign in here directly, from any browser. At least 10 characters.',
  pwMissing: 'No password yet: set one so you can sign in here directly next time, without your Mac.',
  pwNew: 'New password',
  pwRepeat: 'Repeat it',
  pwSave: 'Save password',
  pwSaved: 'Saved. Next time, sign in here with it.',
  pwMismatch: 'The two passwords don’t match.',
  pwShort: 'At least 10 characters.',
  pwForgot: 'Forgot it? Open the admin page from your Mac once more (Settings → Connections → Open server admin) and set a new one.',
  pwIsSet: 'A password is set.',
  devUnused: 'unused',
  devCleanup: 'Remove {n} unused',
  devCleanupHint: 'Pairings not used for 30 days, or never used. Devices that may open this page stay.',
  devCleaned: 'Removed {n}.',
  addAuto: 'Names itself when it connects',
  fbTitle: 'Feedback',
  fbIntro: 'What people write from the app (Info & feedback). Your reply appears in their app.',
  fbNone: 'No feedback yet.',
  fbNew: 'New',
  fbOpen: 'Open',
  fbDone: 'Done',
  fbAnonymous: 'Someone',
  fbReplyPlaceholder: 'Write a reply…',
  fbSend: 'Send reply',
  fbYou: 'You',
  fbDelete: 'Delete',
  fbDeleteConfirm: 'Delete this conversation? The sender can’t see it any more either.',
  fbBack: 'All conversations',
  fbMessages: '{n} messages',
  manageGroup: 'Manage',
  settingsGroup: 'Settings',
  overviewTitle: 'Overview',
  rerunSetup: 'Run the setup again',
  backToSettings: 'Back to settings',
  ownerTitle: 'Your account',
  ownerIntro: 'Everything on this server so far is yours: your times, projects and devices. Which email belongs to your account? It finds you in Float and Personio later, and for the company login.',
  ownerEmail: 'Your email',
  ownerName: 'Your name',
  ownerSave: 'Save',
  peopleTitle: 'People',
  pIntro: 'Everyone with an account on this server, and their devices. Admins manage accounts here; nobody sees anyone’s times.',
  pInviteTitle: 'Invite someone',
  pInviteIntro: 'They get a link to create their account (name and password). Pass it on by message or email.',
  pEmail: 'Email',
  pName: 'Name (optional)',
  pMember: 'Member',
  pAdmin: 'Admin',
  pInvite: 'Invite',
  pInviteFor: 'Invitation for {email}',
  pInviteHow: 'Send them this link. It works once, until {date}.',
  pRegTitle: 'Who may create an account',
  pRegInvite: 'Invited only',
  pRegApproval: 'With approval',
  pRegOpen: 'Anyone',
  pRegInviteHint: 'Only people with an invitation link can sign up.',
  pRegApprovalHint: 'Anyone can sign up at /account/register; the account works once an admin approves it here.',
  pRegOpenHint: 'Anyone who knows this server’s address can sign up at /account/register.',
  pInvited: 'Invited',
  pPending: 'Waiting for approval',
  pActive: 'Active',
  pDisabled: 'Disabled',
  pYou: 'you',
  pApprove: 'Approve',
  pReinvite: 'New invitation link',
  pMakeAdmin: 'Make admin',
  pMakeMember: 'Make member',
  pDisable: 'Disable',
  pDisableConfirm: 'Disable {name}? They’re signed out of every device at once and can’t sign in until enabled again.',
  pEnable: 'Enable',
  pRemove: 'Remove',
  pRemoveConfirm: 'Remove {name} with all their times and devices? This can’t be undone.',
  loginEmailless: 'This server’s first account has no email yet: leave the email empty and use the password.',
  emailTitle: 'Email',
  emailIntro: 'For invitations and password resets. Without email, invitations are links you pass on by hand, and nobody can reset a forgotten password themselves.',
  emailSmtp: 'SMTP',
  emailGraph: 'Microsoft 365',
  emailSmtpHint: 'Any mail provider: Gmail (with an app password), Hetzner, your company’s mail server.',
  emailGraphHint: 'Through an app registration in Microsoft Entra, because Microsoft is turning off SMTP sign-in with a password. The steps are in the server guide (server/README.md).',
  emailHost: 'Mail server',
  emailPort: 'Port',
  emailSecurity: 'Security',
  emailTls: 'TLS (usually port 465)',
  emailStarttls: 'STARTTLS (usually port 587)',
  emailNone: 'None (only for a relay on this machine)',
  emailUser: 'User name',
  emailPassword: 'Password',
  emailTenant: 'Directory (tenant) ID',
  emailClient: 'Application (client) ID',
  emailSecret: 'Client secret (its Value)',
  emailFrom: 'Sender address',
  emailFromHint: 'Emails come from this address, with “{name}” as the sender name.',
  emailFromGraphHint: 'The mailbox the app sends as, for example a shared mailbox. “{name}” is the sender name.',
  emailSecretKept: 'Stored. Leave empty to keep it.',
  emailTestTo: 'Send a test email to',
  emailTest: 'Send a test email',
  emailSending: 'Sending…',
  emailTestOk: 'Sent to {to}. Check the inbox, and the spam folder.',
  emailReady: 'Email works. Last successful test: {when}.',
  emailUntested: 'Saved. Send a test email to check that it works.',
  emailNoUrl: 'Enter the server’s address under Company first: the links in emails point to it.',
  emailOff: 'Turn off email',
  emailOffConfirm: 'Turn off email? Invitations become links to pass on by hand, and nobody can reset their password.',
  pInviteIntroEmail: 'They get an email with a link to create their account (name and password).',
  pInviteSent: 'Invitation sent to {email}. The link works once, until {date}.',
  pInviteFailed: 'The email didn’t go out: {error} Pass on this link instead.',
  pExpired: 'Invitation expired',
  pInvitedUntil: 'Invitation valid until {date}',
  pResend: 'Send invitation again',
  pReset: 'Send password reset',
  pResetConfirm: 'Send {name} an email with a link to set a new password? It works once, for 30 minutes.',
  pResetSent: 'Sent {email} a link to set a new password.',
  pInviteDays: 'Invitations are valid for',
  pDays: 'days',
  loginForgot: 'Forgot your password?',
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
  loginTitle: 'Anmelden',
  loginIntro: 'Gib das Admin-Passwort dieses Servers ein.',
  password: 'Passwort',
  signIn: 'Anmelden',
  signOut: 'Abmelden',
  noPassword: 'Dieser Server hat noch kein Admin-Passwort. Öffne die Verwaltung einmal von deinem Mac aus (Gnomon → Einstellungen → Verbindungen → Server-Verwaltung öffnen) oder mit dem Link aus dem Server-Log und lege dort eins fest.',
  accountTitle: 'Admin-Passwort',
  pwIntro: 'Mit einem Passwort meldest du dich hier direkt an, aus jedem Browser. Mindestens 10 Zeichen.',
  pwMissing: 'Noch kein Passwort: Lege eins fest, dann meldest du dich nächstes Mal direkt hier an, ohne deinen Mac.',
  pwNew: 'Neues Passwort',
  pwRepeat: 'Wiederholen',
  pwSave: 'Passwort sichern',
  pwSaved: 'Gesichert. Melde dich nächstes Mal hier damit an.',
  pwMismatch: 'Die beiden Passwörter stimmen nicht überein.',
  pwShort: 'Mindestens 10 Zeichen.',
  pwForgot: 'Vergessen? Öffne die Verwaltung noch einmal von deinem Mac aus (Einstellungen → Verbindungen → Server-Verwaltung öffnen) und lege ein neues fest.',
  pwIsSet: 'Ein Passwort ist festgelegt.',
  devUnused: 'unbenutzt',
  devCleanup: '{n} unbenutzte entfernen',
  devCleanupHint: 'Verbindungen, die 30 Tage oder nie benutzt wurden. Geräte, die diese Seite öffnen dürfen, bleiben.',
  devCleaned: '{n} entfernt.',
  addAuto: 'Benennt sich beim Verbinden selbst',
  fbTitle: 'Feedback',
  fbIntro: 'Was Leute aus der App schreiben (Info & Feedback). Deine Antwort erscheint in ihrer App.',
  fbNone: 'Noch kein Feedback.',
  fbNew: 'Neu',
  fbOpen: 'Offen',
  fbDone: 'Erledigt',
  fbAnonymous: 'Jemand',
  fbReplyPlaceholder: 'Antwort schreiben …',
  fbSend: 'Antwort senden',
  fbYou: 'Du',
  fbDelete: 'Löschen',
  fbDeleteConfirm: 'Dieses Gespräch löschen? Auch der Absender sieht es dann nicht mehr.',
  fbBack: 'Alle Gespräche',
  fbMessages: '{n} Nachrichten',
  manageGroup: 'Verwalten',
  settingsGroup: 'Einstellungen',
  overviewTitle: 'Übersicht',
  rerunSetup: 'Einrichtung erneut durchlaufen',
  backToSettings: 'Zurück zu den Einstellungen',
  ownerTitle: 'Dein Konto',
  ownerIntro: 'Alles auf diesem Server gehört bisher dir: deine Zeiten, Projekte und Geräte. Welche E-Mail gehört zu deinem Konto? Darüber findet der Server dich später in Float und Personio und beim Firmen-Login.',
  ownerEmail: 'Deine E-Mail',
  ownerName: 'Dein Name',
  ownerSave: 'Sichern',
  peopleTitle: 'Personen',
  pIntro: 'Alle mit einem Konto auf diesem Server, und ihre Geräte. Admins verwalten hier Konten; niemand sieht die Zeiten anderer.',
  pInviteTitle: 'Jemanden einladen',
  pInviteIntro: 'Die Person bekommt einen Link, mit dem sie ihr Konto anlegt (Name und Passwort). Gib ihn per Nachricht oder E-Mail weiter.',
  pEmail: 'E-Mail',
  pName: 'Name (optional)',
  pMember: 'Mitglied',
  pAdmin: 'Admin',
  pInvite: 'Einladen',
  pInviteFor: 'Einladung für {email}',
  pInviteHow: 'Schick diesen Link. Er gilt einmal, bis {date}.',
  pRegTitle: 'Wer ein Konto anlegen darf',
  pRegInvite: 'Nur mit Einladung',
  pRegApproval: 'Mit Freigabe',
  pRegOpen: 'Alle',
  pRegInviteHint: 'Nur wer einen Einladungslink hat, kann sich registrieren.',
  pRegApprovalHint: 'Alle können sich unter /account/register registrieren; das Konto wird aktiv, sobald ein Admin es hier freigibt.',
  pRegOpenHint: 'Alle, die die Adresse dieses Servers kennen, können sich unter /account/register registrieren.',
  pInvited: 'Eingeladen',
  pPending: 'Wartet auf Freigabe',
  pActive: 'Aktiv',
  pDisabled: 'Gesperrt',
  pYou: 'du',
  pApprove: 'Freigeben',
  pReinvite: 'Neuer Einladungslink',
  pMakeAdmin: 'Zum Admin machen',
  pMakeMember: 'Zum Mitglied machen',
  pDisable: 'Sperren',
  pDisableConfirm: '{name} sperren? Die Person wird sofort auf allen Geräten abgemeldet und kann sich erst nach dem Entsperren wieder anmelden.',
  pEnable: 'Entsperren',
  pRemove: 'Entfernen',
  pRemoveConfirm: '{name} mit allen Zeiten und Geräten entfernen? Das lässt sich nicht rückgängig machen.',
  loginEmailless: 'Das erste Konto dieses Servers hat noch keine E-Mail: Lass die E-Mail leer und nimm das Passwort.',
  emailTitle: 'E-Mail',
  emailIntro: 'Für Einladungen und zum Zurücksetzen von Passwörtern. Ohne E-Mail sind Einladungen Links zum Weitergeben, und ein vergessenes Passwort kann niemand selbst zurücksetzen.',
  emailSmtp: 'SMTP',
  emailGraph: 'Microsoft 365',
  emailSmtpHint: 'Jeder Mail-Anbieter: Gmail (mit App-Passwort), Hetzner, der Mailserver deiner Firma.',
  emailGraphHint: 'Über eine App-Registrierung in Microsoft Entra, weil Microsoft die SMTP-Anmeldung mit Passwort abschaltet. Die Schritte stehen in der Server-Anleitung (server/README.md).',
  emailHost: 'Mailserver',
  emailPort: 'Port',
  emailSecurity: 'Verschlüsselung',
  emailTls: 'TLS (meist Port 465)',
  emailStarttls: 'STARTTLS (meist Port 587)',
  emailNone: 'Keine (nur für einen Relay auf diesem Rechner)',
  emailUser: 'Benutzername',
  emailPassword: 'Passwort',
  emailTenant: 'Verzeichnis-ID (Mandant)',
  emailClient: 'Anwendungs-ID (Client)',
  emailSecret: 'Geheimer Clientschlüssel (sein Wert)',
  emailFrom: 'Absenderadresse',
  emailFromHint: 'E-Mails kommen von dieser Adresse, mit „{name}“ als Absendername.',
  emailFromGraphHint: 'Das Postfach, als das die App sendet, zum Beispiel ein freigegebenes Postfach. „{name}“ ist der Absendername.',
  emailSecretKept: 'Gespeichert. Leer lassen, um es zu behalten.',
  emailTestTo: 'Test-E-Mail senden an',
  emailTest: 'Test-E-Mail senden',
  emailSending: 'Sende…',
  emailTestOk: 'An {to} gesendet. Schau in den Posteingang und in den Spam-Ordner.',
  emailReady: 'E-Mail funktioniert. Letzter erfolgreicher Test: {when}.',
  emailUntested: 'Gespeichert. Sende eine Test-E-Mail, um zu prüfen, ob es klappt.',
  emailNoUrl: 'Gib zuerst unter Firma die Adresse des Servers ein: Die Links in den E-Mails führen dorthin.',
  emailOff: 'E-Mail abschalten',
  emailOffConfirm: 'E-Mail abschalten? Einladungen werden zu Links zum Weitergeben, und niemand kann sein Passwort zurücksetzen.',
  pInviteIntroEmail: 'Sie bekommen eine E-Mail mit einem Link, um ihr Konto anzulegen (Name und Passwort).',
  pInviteSent: 'Einladung an {email} gesendet. Der Link funktioniert einmal, bis {date}.',
  pInviteFailed: 'Die E-Mail ging nicht raus: {error} Gib stattdessen diesen Link weiter.',
  pExpired: 'Einladung abgelaufen',
  pInvitedUntil: 'Einladung gültig bis {date}',
  pResend: 'Einladung erneut senden',
  pReset: 'Passwort-Link senden',
  pResetConfirm: '{name} eine E-Mail mit einem Link für ein neues Passwort senden? Er funktioniert einmal, 30 Minuten lang.',
  pResetSent: '{email} hat einen Link für ein neues Passwort bekommen.',
  pInviteDays: 'Einladungen gelten',
  pDays: 'Tage',
  loginForgot: 'Passwort vergessen?',
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
  email?: EmailSettings;
  audit: { at: string; what: string }[];
};
type EmailSettings = { provider: 'smtp'; host: string; port: number; security: 'tls' | 'starttls' | 'none'; user: string; from: string; tested?: string } | { provider: 'graph'; tenantId: string; clientId: string; from: string; tested?: string };
type State = { config: Config; secrets: { float: boolean; personio: boolean; email: boolean }; email: { ready: boolean; publicUrl: boolean }; keySource: 'env' | 'file'; release: { version: string; size: number } | null; devices: number; passwordSet: boolean; feedbackUnread: number; me: { id: string; email: string | null; name: string }; registration: 'invite' | 'approval' | 'open'; pending: number };

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

function EmailStep({ s, setS, setErr }: Ctx) {
  const e = s.config.email;
  const [provider, setProvider] = useState<'smtp' | 'graph'>(e?.provider ?? 'smtp');
  const [smtp, setSmtp] = useState({ host: '', port: 587, security: 'starttls' as 'tls' | 'starttls' | 'none', user: '', ...(e?.provider === 'smtp' && e) });
  const [graph, setGraph] = useState({ tenantId: '', clientId: '', ...(e?.provider === 'graph' && e) });
  const [from, setFrom] = useState(e?.from ?? '');
  const [secret, setSecret] = useState('');
  const [to, setTo] = useState(s.me.email ?? '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const name = s.config.company.name || 'Gnomon';
  // The stored secret belongs to the account that's set up; for another provider it has to be entered again.
  const secretStored = s.secrets.email && e?.provider === provider;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setErr(null);
    } catch (err) {
      setErr((err as Error).message);
    }
    setBusy(false);
  };
  const save = () =>
    run(async () => {
      setS(await call('PUT', '/email', { provider, from, secret: secret || undefined, ...(provider === 'smtp' ? smtp : graph) }));
      setSecret('');
      setNote(t('saved'));
    });
  const test = () =>
    run(async () => {
      const r = await call<State & { sentTo: string }>('POST', '/email/test', { to: to || undefined });
      setS(r);
      setNote(t('emailTestOk', { to: r.sentTo }));
    });
  const setPort = (port: number) => setSmtp({ ...smtp, port, security: port === 465 ? 'tls' : port === 587 ? 'starttls' : smtp.security });
  return (
    <>
      <p className="a-intro">{t('emailIntro')}</p>
      {!s.email.publicUrl && <p className="a-warn">{t('emailNoUrl')}</p>}
      {e && s.email.ready && (e.tested ? (
        <div className="a-ok">
          <Icon name="check_circle" /> {t('emailReady', { when: new Date(e.tested).toLocaleString() })}
        </div>
      ) : (
        <span className="a-hint">{t('emailUntested')}</span>
      ))}
      <div className="a-seg">
        {(['smtp', 'graph'] as const).map((p) => (
          <button key={p} className={provider === p ? 'on' : ''} onClick={() => (setProvider(p), setSecret(''))}>
            {t(p === 'smtp' ? 'emailSmtp' : 'emailGraph')}
          </button>
        ))}
      </div>
      <span className="a-hint">{t(provider === 'smtp' ? 'emailSmtpHint' : 'emailGraphHint')}</span>
      <form className="a-card" onSubmit={(ev) => (ev.preventDefault(), void save())}>
        {provider === 'smtp' ? (
          <>
            <div className="a-row">
              <Field label={t('emailHost')}>
                <input value={smtp.host} onChange={(ev) => setSmtp({ ...smtp, host: ev.target.value })} placeholder="smtp.example.com" spellCheck={false} autoComplete="off" />
              </Field>
              <Field label={t('emailPort')}>
                <input type="number" min={1} max={65535} value={smtp.port} onChange={(ev) => setPort(Number(ev.target.value))} />
              </Field>
              <Field label={t('emailSecurity')}>
                <select value={smtp.security} onChange={(ev) => setSmtp({ ...smtp, security: ev.target.value as typeof smtp.security })}>
                  <option value="starttls">{t('emailStarttls')}</option>
                  <option value="tls">{t('emailTls')}</option>
                  <option value="none">{t('emailNone')}</option>
                </select>
              </Field>
            </div>
            <div className="a-row">
              <Field label={t('emailUser')}>
                <input value={smtp.user} onChange={(ev) => setSmtp({ ...smtp, user: ev.target.value })} spellCheck={false} autoComplete="off" />
              </Field>
              <Field label={t('emailPassword')} hint={secretStored ? t('emailSecretKept') : undefined}>
                <input type="password" value={secret} onChange={(ev) => setSecret(ev.target.value)} autoComplete="new-password" placeholder={secretStored ? '••••••••' : ''} />
              </Field>
            </div>
          </>
        ) : (
          <>
            <div className="a-row">
              <Field label={t('emailTenant')}>
                <input value={graph.tenantId} onChange={(ev) => setGraph({ ...graph, tenantId: ev.target.value })} placeholder="00000000-0000-0000-0000-000000000000" spellCheck={false} autoComplete="off" />
              </Field>
              <Field label={t('emailClient')}>
                <input value={graph.clientId} onChange={(ev) => setGraph({ ...graph, clientId: ev.target.value })} placeholder="00000000-0000-0000-0000-000000000000" spellCheck={false} autoComplete="off" />
              </Field>
            </div>
            <Field label={t('emailSecret')} hint={secretStored ? t('emailSecretKept') : undefined}>
              <input type="password" value={secret} onChange={(ev) => setSecret(ev.target.value)} autoComplete="new-password" placeholder={secretStored ? '••••••••' : ''} />
            </Field>
          </>
        )}
        <Field label={t('emailFrom')} hint={t(provider === 'smtp' ? 'emailFromHint' : 'emailFromGraphHint', { name })}>
          <input type="email" value={from} onChange={(ev) => setFrom(ev.target.value)} placeholder="gnomon@example.com" spellCheck={false} autoComplete="off" />
        </Field>
        <button className="primary a-save" disabled={busy || !from.trim()}>
          {t('save')}
        </button>
      </form>
      {e && (
        <form className="a-card" onSubmit={(ev) => (ev.preventDefault(), void test())}>
          <div className="a-inline">
            <input type="email" value={to} onChange={(ev) => setTo(ev.target.value)} placeholder={t('emailTestTo')} aria-label={t('emailTestTo')} />
            <button className="soft" disabled={busy}>
              <Icon name="send" size={18} /> {busy ? t('emailSending') : t('emailTest')}
            </button>
          </div>
          {note && (
            <div className="a-ok">
              <Icon name="check_circle" /> {note}
            </div>
          )}
          <button type="button" className="soft danger" onClick={() => confirm(t('emailOffConfirm')) && void run(async () => setS(await call('DELETE', '/email')))}>
            {t('emailOff')}
          </button>
        </form>
      )}
      {!e && note && (
        <div className="a-ok">
          <Icon name="check_circle" /> {note}
        </div>
      )}
    </>
  );
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

/** Not seen for 30 days, or never used and older than a day (the server removes the same ones). */
const unused = (d: Device) => !d.admin && (d.lastSeenAt ? Date.now() - Date.parse(d.lastSeenAt) > 30 * 86_400_000 : Date.now() - Date.parse(d.createdAt) > 86_400_000);

function ago(iso: string | null): string {
  if (!iso) return t('devNever');
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  const when = min < 2 ? t('devJustNow') : min < 60 ? t('devMinutes', { n: min }) : min < 48 * 60 ? t('devHours', { n: Math.round(min / 60) }) : t('devDays', { n: Math.round(min / 1440) });
  return t('devLastSeen', { when });
}

function DeviceRow({ d, reload, setErr }: { d: Device; reload: () => void; setErr: (e: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.name);
  const [icon, label] = KIND[kindOf(d) ?? ''] ?? ['devices', 'devUnknown'];
  const run = async (method: string, body?: unknown) => {
    try {
      setErr(null);
      await call(method, `/devices/${d.id}`, body);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <li className={`a-device ${unused(d) ? 'unused' : ''}`}>
      <span className="a-device-icon" title={t(label)}>
        <Icon name={icon} size={20} />
      </span>
      <div className="a-device-main">
        {editing ? (
          <form className="a-inline" onSubmit={(e) => (e.preventDefault(), run('PATCH', { name }).then(() => setEditing(false)))}>
            <input value={name} autoFocus maxLength={60} onChange={(e) => setName(e.target.value)} />
            <button className="primary">{t('devSave')}</button>
          </form>
        ) : (
          <strong>
            {d.name} {unused(d) && <span className="a-tag">{t('devUnused')}</span>}
          </strong>
        )}
        <span className="a-hint">
          {t(label)} · {ago(d.lastSeenAt)} · {t('devSince', { date: new Date(d.createdAt).toLocaleDateString() })}
        </span>
      </div>
      <div className="a-device-actions">
        {!editing && (
          <button className="soft" title={t('devRename')} onClick={() => setEditing(true)}>
            <Icon name="edit" size={18} />
          </button>
        )}
        <button className="soft danger" title={t('devDisconnect')} onClick={() => confirm(t('devConfirm', { name: d.name })) && run('DELETE')}>
          <Icon name="link_off" size={18} />
        </button>
      </div>
    </li>
  );
}

// ---- People: everyone with an account, their devices, invitations, who may register ------------------

type PersonRow = { id: string; email: string | null; name: string; role: 'admin' | 'member'; status: 'invited' | 'pending' | 'active' | 'disabled'; owner: boolean; lastSeenAt: string | null; inviteExpiresAt: string | null; devices: Device[] };
/** An invitation just made: emailed (`sent`), or a link to pass on by hand (with `error` when the email failed). */
type Invite = { personId?: string; email: string; sent: boolean; link?: string; error?: string; expiresAt?: string };
type PeopleResponse = { people: PersonRow[]; registration: 'invite' | 'approval' | 'open'; inviteDays: number; email: boolean };
const day = (iso: string) => new Date(iso).toLocaleDateString();
const STATUS_KEY: Record<PersonRow['status'], Key> = { invited: 'pInvited', pending: 'pPending', active: 'pActive', disabled: 'pDisabled' };

function InviteBox({ invite }: { invite: Invite }) {
  const [copied, setCopied] = useState(false);
  if (invite.sent || !invite.link)
    return invite.sent ? (
      <div className="a-ok">
        <Icon name="mail" /> {t('pInviteSent', { email: invite.email, date: day(invite.expiresAt!) })}
      </div>
    ) : (
      <p className="a-warn">{invite.error}</p>
    );
  const link = invite.link;
  return (
    <div className="a-invite">
      <Qr text={link} />
      <div>
        <strong>{t('pInviteFor', { email: invite.email })}</strong>
        {invite.error && <span className="a-warn">{t('pInviteFailed', { error: invite.error })}</span>}
        <code>{link}</code>
        <span className="a-hint">{t('pInviteHow', { date: day(invite.expiresAt!) })}</span>
        <button
          type="button"
          className="soft"
          onClick={() => {
            navigator.clipboard?.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
    </div>
  );
}

function People(ctx: Ctx) {
  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const [registration, setRegistration] = useState<'invite' | 'approval' | 'open'>('invite');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [inviteDays, setInviteDays] = useState(14);
  const [emailOn, setEmailOn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const take = (r: PeopleResponse) => (setPeople(r.people), setRegistration(r.registration), setInviteDays(r.inviteDays), setEmailOn(r.email));
  const load = () => call<PeopleResponse>('GET', '/people').then(take, (e) => ctx.setErr((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  const run = async (method: string, path: string, body?: unknown) => {
    try {
      ctx.setErr(null);
      setNotice(null);
      const r = await call<PeopleResponse & { invite?: Invite; resetSentTo?: string }>(method, path, body);
      take(r);
      if (r.invite) setInvite(r.invite);
      if (r.resetSentTo) setNotice(t('pResetSent', { email: r.resetSentTo }));
      call<State>('GET', '/state').then(ctx.setS);
    } catch (e) {
      ctx.setErr((e as Error).message);
    }
  };
  return (
    <>
      <p className="a-intro">{t('pIntro')}</p>
      <form
        className="a-card"
        onSubmit={(e) => {
          e.preventDefault();
          void run('POST', '/people', { email, name: name || undefined, role }).then(() => (setEmail(''), setName('')));
        }}
      >
        <strong>
          <Icon name="person" size={18} /> {t('pInviteTitle')}
        </strong>
        <span className="a-hint">{t(emailOn ? 'pInviteIntroEmail' : 'pInviteIntro')}</span>
        <div className="a-row">
          <input type="email" required placeholder={t('pEmail')} value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder={t('pName')} value={name} onChange={(e) => setName(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
            <option value="member">{t('pMember')}</option>
            <option value="admin">{t('pAdmin')}</option>
          </select>
          <button className="primary">{t('pInvite')}</button>
        </div>
        {invite && <InviteBox invite={invite} />}
      </form>
      <div className="a-card">
        <strong>{t('pRegTitle')}</strong>
        <div className="a-seg">
          {(['invite', 'approval', 'open'] as const).map((m) => (
            <button key={m} className={registration === m ? 'on' : ''} onClick={() => run('PUT', '/registration', { mode: m })}>
              {t(m === 'invite' ? 'pRegInvite' : m === 'approval' ? 'pRegApproval' : 'pRegOpen')}
            </button>
          ))}
        </div>
        <span className="a-hint">{t(registration === 'invite' ? 'pRegInviteHint' : registration === 'approval' ? 'pRegApprovalHint' : 'pRegOpenHint')}</span>
        <label className="a-inline a-days">
          <span>{t('pInviteDays')}</span>
          <input
            type="number"
            min={1}
            max={90}
            value={inviteDays}
            onChange={(e) => setInviteDays(Number(e.target.value))}
            onBlur={() => inviteDays >= 1 && inviteDays <= 90 && run('PUT', '/registration', { inviteDays: Math.round(inviteDays) })}
          />
          <span>{t('pDays')}</span>
        </label>
      </div>
      {notice && (
        <div className="a-ok">
          <Icon name="mail" /> {notice}
        </div>
      )}
      <ul className="a-people">
        {people?.map((x) => {
          const expired = x.status === 'invited' && Boolean(x.inviteExpiresAt) && Date.parse(x.inviteExpiresAt!) < Date.now();
          return (
          <li key={x.id} className={`a-person ${x.status}`}>
            <div className="a-person-head">
              <span className="a-device-icon">
                <Icon name="person" size={20} />
              </span>
              <div className="a-device-main">
                <strong>
                  {x.name} {x.id === ctx.s.me.id && <span className="a-tag">{t('pYou')}</span>}
                </strong>
                <span className="a-hint">
                  {x.email ?? '—'}
                  {x.status === 'invited' && x.inviteExpiresAt && !expired && ` · ${t('pInvitedUntil', { date: day(x.inviteExpiresAt) })}`}
                </span>
              </div>
              <span className={`a-status ${x.status === 'pending' || expired ? 'new' : ''}`}>{t(expired ? 'pExpired' : STATUS_KEY[x.status])}</span>
              <span className="a-status">{t(x.role === 'admin' ? 'pAdmin' : 'pMember')}</span>
            </div>
            {x.devices.length > 0 && (
              <ul className="a-devices">
                {x.devices.map((d) => (
                  <DeviceRow key={d.id} d={d} reload={load} setErr={ctx.setErr} />
                ))}
              </ul>
            )}
            {x.id !== ctx.s.me.id && (
              <div className="a-inline a-person-actions">
                {x.status === 'pending' && (
                  <button className="primary" onClick={() => run('PATCH', `/people/${x.id}`, { status: 'active' })}>
                    {t('pApprove')}
                  </button>
                )}
                {x.status === 'invited' && (
                  <button className={expired ? 'primary' : 'soft'} onClick={() => run('POST', `/people/${x.id}/invite`)}>
                    {t(emailOn ? 'pResend' : 'pReinvite')}
                  </button>
                )}
                {x.status === 'active' && x.email && emailOn && (
                  <button className="soft" onClick={() => confirm(t('pResetConfirm', { name: x.name })) && run('POST', `/people/${x.id}/reset`)}>
                    {t('pReset')}
                  </button>
                )}
                <button className="soft" onClick={() => run('PATCH', `/people/${x.id}`, { role: x.role === 'admin' ? 'member' : 'admin' })}>
                  {t(x.role === 'admin' ? 'pMakeMember' : 'pMakeAdmin')}
                </button>
                {x.status === 'active' && (
                  <button className="soft" onClick={() => confirm(t('pDisableConfirm', { name: x.name })) && run('PATCH', `/people/${x.id}`, { status: 'disabled' })}>
                    {t('pDisable')}
                  </button>
                )}
                {x.status === 'disabled' && (
                  <button className="soft" onClick={() => run('PATCH', `/people/${x.id}`, { status: 'active' })}>
                    {t('pEnable')}
                  </button>
                )}
                {!x.owner && (
                  <button className="soft danger" onClick={() => confirm(t('pRemoveConfirm', { name: x.name })) && run('DELETE', `/people/${x.id}`)}>
                    {t('pRemove')}
                  </button>
                )}
              </div>
            )}
          </li>
          );
        })}
      </ul>
    </>
  );
}

// ---- Feedback inbox -----------------------------------------------------------------------------

type FbMessage = { author: 'user' | 'admin'; text: string; at: string };
type FbThread = { id: string; status: 'new' | 'open' | 'done'; sender: string | null; appVersion: string | null; os: string | null; createdAt: string; updatedAt: string; unread: boolean; messages?: FbMessage[]; first?: string; last?: FbMessage | null; count?: number };
const STATUS: Record<FbThread['status'], Key> = { new: 'fbNew', open: 'fbOpen', done: 'fbDone' };
const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Conversation({ id, back, setErr }: { id: string; back: () => void; setErr: (e: string | null) => void }) {
  const [th, setTh] = useState<FbThread | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call<FbThread>('GET', `/feedback/${id}`).then(setTh, (e) => setErr((e as Error).message));
  }, [id]);
  if (!th) return null;
  const run = async (method: string, path: string, body?: unknown) => {
    try {
      setErr(null);
      setTh(await call<FbThread>(method, path, body));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="a-convo">
      <button className="soft" onClick={back}>
        <Icon name="arrow_back" size={18} /> {t('fbBack')}
      </button>
      <div className="a-convo-head">
        <strong>{th.sender || t('fbAnonymous')}</strong>
        <span className="a-hint">{[th.appVersion && `Gnomon ${th.appVersion}`, th.os, when(th.createdAt)].filter(Boolean).join(' · ')}</span>
        <span className="spacer" />
        <div className="a-seg">
          {(['open', 'done'] as const).map((st) => (
            <button key={st} className={th.status === st ? 'on' : ''} onClick={() => run('PATCH', `/feedback/${id}`, { status: st })}>
              {t(STATUS[st])}
            </button>
          ))}
        </div>
      </div>
      <ol className="a-messages">
        {th.messages!.map((m, i) => (
          <li key={i} className={m.author}>
            <span className="a-bubble">{m.text}</span>
            <span className="a-hint">
              {m.author === 'admin' ? t('fbYou') : th.sender || t('fbAnonymous')} · {when(m.at)}
            </span>
          </li>
        ))}
      </ol>
      <form
        className="a-reply"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await run('POST', `/feedback/${id}/reply`, { text: reply });
          setReply('');
          setBusy(false);
        }}
      >
        <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t('fbReplyPlaceholder')} rows={3} maxLength={5000} />
        <div className="a-inline">
          <button
            type="button"
            className="soft danger"
            onClick={async () => {
              if (!confirm(t('fbDeleteConfirm'))) return;
              await call('DELETE', `/feedback/${id}`);
              back();
            }}
          >
            <Icon name="delete" size={18} /> {t('fbDelete')}
          </button>
          <span className="spacer" />
          <button className="primary" disabled={busy || !reply.trim()}>
            <Icon name="send" size={18} /> {t('fbSend')}
          </button>
        </div>
      </form>
    </div>
  );
}

function Feedback(ctx: Ctx) {
  const [threads, setThreads] = useState<FbThread[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => call<{ threads: FbThread[] }>('GET', '/feedback').then((r) => setThreads(r.threads), (e) => ctx.setErr((e as Error).message));
  useEffect(() => {
    if (!open) void load();
  }, [open]);
  if (open) return <Conversation id={open} back={() => (setOpen(null), call<State>('GET', '/state').then(ctx.setS))} setErr={ctx.setErr} />;
  return (
    <>
      <p className="a-intro">{t('fbIntro')}</p>
      {threads && threads.length === 0 && <p className="a-hint">{t('fbNone')}</p>}
      <ul className="a-threads">
        {threads?.map((th) => (
          <li key={th.id}>
            <button className={`a-thread ${th.unread ? 'unread' : ''} ${th.status}`} onClick={() => setOpen(th.id)}>
              <span className="a-thread-top">
                <strong>{th.sender || t('fbAnonymous')}</strong>
                <span className={`a-status ${th.status}`}>{t(STATUS[th.status])}</span>
                <span className="spacer" />
                <span className="a-hint">{when(th.updatedAt)}</span>
              </span>
              <span className="a-thread-text">{th.first}</span>
              <span className="a-hint">
                {[th.appVersion && `Gnomon ${th.appVersion}`, th.count && th.count > 1 ? t('fbMessages', { n: th.count }) : null].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---- The owner's account: asked once after the update to people (docs/accounts-design.md) -----------------

function OwnerPrompt({ s, setS }: { s: State; setS: (s: State) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState(s.me.name === 'Owner' ? '' : s.me.name);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="a-card a-owner"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          setS(await call('PATCH', '/me', { email, name: name || undefined }));
        } catch (e) {
          setErr((e as Error).message);
        }
      }}
    >
      <strong>
        <Icon name="person" size={18} /> {t('ownerTitle')}
      </strong>
      <span className="a-hint">{t('ownerIntro')}</span>
      {err && <p className="a-error">{err}</p>}
      <div className="a-row">
        <Field label={t('ownerEmail')}>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('ownerName')}>
          <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <button className="primary a-save" disabled={!email.trim()}>
        {t('ownerSave')}
      </button>
    </form>
  );
}

// ---- Signing in with the admin password ---------------------------------------------------------

const keepToken = (value: string) => {
  token = value;
  try {
    if (value) sessionStorage.setItem('gnomon.admin', value);
    else sessionStorage.removeItem('gnomon.admin');
  } catch {
    /* this tab only */
  }
};

function Login({ onIn, emailless }: { onIn: (s: State) => void; emailless: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="a-page a-login">
      <header className="a-head">
        <img src="/icon-192.png" alt="" width={44} height={44} />
        <div>
          <h1>{t('adminTitle')}</h1>
          <span className="a-hint">{location.host}</span>
        </div>
      </header>
      <form
        className="a-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await call<State & { token: string }>('POST', '/login', { email: email || undefined, password });
            keepToken(r.token);
            onIn(r);
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>
          <Icon name="lock" size={22} /> {t('loginTitle')}
        </h2>
        <p className="a-intro">{t('loginIntro')}</p>
        {err && (
          <p className="a-error">
            <Icon name="warning" size={18} /> {err}
          </p>
        )}
        <Field label={t('pEmail')} hint={emailless ? t('loginEmailless') : undefined}>
          <input type="email" autoComplete="username" autoFocus={!emailless} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('password')}>
          <input type="password" autoComplete="current-password" autoFocus={emailless} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <footer className="a-foot">
          <span className="a-hint">
            <a href="/account/forgot">{t('loginForgot')}</a> {t('pwForgot')}
          </span>
          <span className="spacer" />
          <button className="primary" disabled={busy || !password}>
            {t('signIn')}
          </button>
        </footer>
      </form>
    </main>
  );
}

function Account({ s, setS, setErr }: Ctx) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [saved, setSaved] = useState(false);
  const save = async () => {
    if (a.length < 10) return setErr(t('pwShort'));
    if (a !== b) return setErr(t('pwMismatch'));
    try {
      setErr(null);
      setS(await call('POST', '/password', { password: a }));
      setA('');
      setB('');
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <>
      <p className="a-intro">{t('pwIntro')}</p>
      {s.passwordSet && !saved && (
        <div className="a-ok">
          <Icon name="check_circle" /> {t('pwIsSet')}
        </div>
      )}
      <form className="a-card" onSubmit={(e) => (e.preventDefault(), void save())}>
        <Field label={t('pwNew')}>
          <input type="password" autoComplete="new-password" value={a} onChange={(e) => (setA(e.target.value), setSaved(false))} />
        </Field>
        <Field label={t('pwRepeat')}>
          <input type="password" autoComplete="new-password" value={b} onChange={(e) => (setB(e.target.value), setSaved(false))} />
        </Field>
        <button className="primary a-save" disabled={!a || !b}>
          {t('pwSave')}
        </button>
        {saved && (
          <div className="a-ok">
            <Icon name="check_circle" /> {t('pwSaved')}
          </div>
        )}
      </form>
    </>
  );
}

// ---- App ------------------------------------------------------------------------------------------

type Section = { key: string; title: Key; icon: IconName; view: (ctx: Ctx) => ReactNode };
const PEOPLE: Section = { key: 'people', title: 'peopleTitle', icon: 'group', view: (c) => <People {...c} /> };
const FEEDBACK: Section = { key: 'feedback', title: 'fbTitle', icon: 'forum', view: (c) => <Feedback {...c} /> };
const ACCOUNT: Section = { key: 'account', title: 'accountTitle', icon: 'lock', view: (c) => <Account {...c} /> };
/** After the setup, these steps are Settings pages of their own (the others only make sense in the wizard). */
const SETTINGS_KEYS = ['company', 'email', 'float', 'personio', 'rules', 'rollout', 'done'];
const STEPS: Section[] = [
  { key: 'before', title: 'beforeTitle', icon: 'check_circle', view: (c) => <Before {...c} /> },
  { key: 'company', title: 'companyTitle', icon: 'apartment', view: (c) => <CompanyStep {...c} /> },
  { key: 'signin', title: 'signInTitle', icon: 'group', view: () => <SignIn /> },
  { key: 'email', title: 'emailTitle', icon: 'mail', view: (c) => <EmailStep {...c} /> },
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
  const [login, setLogin] = useState(false);
  const [emailless, setEmailless] = useState(false);
  // The wizard again, on request, after the setup is finished.
  const [wizard, setWizard] = useState(false);

  useEffect(() => {
    // Trade the one-time code from the link for a session, then take the code out of the address bar.
    const code = new URLSearchParams(location.hash.slice(1)).get('code');
    (async () => {
      try {
        if (code) {
          history.replaceState(null, '', location.pathname);
          const r = await call<State & { token: string }>('POST', '/session', { code });
          keepToken(r.token);
          setS(r);
          if (r.config.setupDone && !admin) setStep(STEPS.length - 1);
        } else if (token) setS(await call('GET', '/state'));
        else if (admin) {
          // No link: sign in with the password, if the server has one.
          const st = await call<{ passwordSet: boolean; emailless: boolean }>('GET', '/status');
          setEmailless(st.emailless);
          if (st.passwordSet) setLogin(true);
          else setFatal(t('noPassword'));
        } else setFatal(t('noLink'));
      } catch (e) {
        // An expired session after a restart: back to the login rather than a dead end.
        if (!code && admin && token) {
          keepToken('');
          const st = await call<{ passwordSet: boolean }>('GET', '/status').catch(() => ({ passwordSet: false }));
          if (st.passwordSet) return setLogin(true);
        }
        setFatal(code ? t('linkFailed', { error: (e as Error).message }) : t('noLink'));
      }
    })();
  }, []);

  useEffect(() => {
    document.title = t(admin ? 'adminTitle' : 'title');
  }, []);

  if (login && !s) return <Login emailless={emailless} onIn={(r) => (setLogin(false), setS(r))} />;
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

  // The Admin page: Manage (everyday: devices, feedback, account), then either the setup wizard (numbered steps, until
  // it's finished or when run again) or Settings (the same pages, each on its own, without steps). /setup is the wizard.
  const setupMode = !admin || !s.config.setupDone || wizard;
  const MANAGE = admin ? [PEOPLE, FEEDBACK, ACCOUNT] : [];
  const rest = setupMode ? STEPS : STEPS.filter((x) => SETTINGS_KEYS.includes(x.key));
  const SECTIONS = [...MANAGE, ...rest];
  const offset = MANAGE.length;
  const ctx: Ctx = { s, setS, err, setErr };
  const cur = SECTIONS[Math.min(step, SECTIONS.length - 1)];
  const isStep = setupMode && step >= offset;
  const titleOf = (x: Section) => (!setupMode && x.key === 'done' ? 'overviewTitle' : x.title);
  const switchMode = (on: boolean) => (setWizard(on), setStep(offset), setErr(null));
  return (
    <main className="a-page">
      <header className="a-head">
        <img src="/icon-192.png" alt="" width={44} height={44} />
        <div>
          <h1>{t(admin || s.config.setupDone ? 'adminTitle' : 'title')}</h1>
          <span className="a-hint">{s.config.company.name || s.config.company.publicUrl || location.host}</span>
        </div>
        {admin && (
          <button
            className="soft a-signout"
            onClick={async () => {
              await call('DELETE', '/session').catch(() => {});
              keepToken('');
              location.replace('/admin');
            }}
          >
            {t('signOut')}
          </button>
        )}
      </header>
      {admin && !s.me.email && <OwnerPrompt s={s} setS={setS} />}
      {admin && !s.passwordSet && step !== 2 && (
        <button className="a-banner" onClick={() => (setStep(2), setErr(null))}>
          <Icon name="lock" size={18} /> {t('pwMissing')} <Icon name="arrow_forward" size={16} />
        </button>
      )}
      <div className="a-body">
        <nav className="a-steps">
          {SECTIONS.map((st, i) => (
            <Fragment key={st.key}>
              {admin && i === 0 && <span className="a-group">{t('manageGroup')}</span>}
              {admin && i === offset && <span className="a-group">{t(setupMode ? 'setupGroup' : 'settingsGroup')}</span>}
              <button className={`a-step ${i === step ? 'on' : ''} ${setupMode && i < step && i >= offset ? 'past' : ''}`} onClick={() => (setStep(i), setErr(null))}>
                <span className="a-num">{i < offset || !setupMode ? <Icon name={st.icon} size={14} /> : i - offset + 1}</span>
                {t(titleOf(st))}
                {st.key === 'feedback' && s.feedbackUnread > 0 && <span className="a-badge">{s.feedbackUnread}</span>}
                {st.key === 'people' && s.pending > 0 && <span className="a-badge">{s.pending}</span>}
              </button>
            </Fragment>
          ))}
          {admin && s.config.setupDone && (
            <button className="a-step a-mode" onClick={() => switchMode(!wizard)}>
              <span className="a-num">
                <Icon name={wizard ? 'arrow_back' : 'rocket_launch'} size={14} />
              </span>
              {t(wizard ? 'backToSettings' : 'rerunSetup')}
            </button>
          )}
        </nav>
        <section className="a-panel">
          {isStep && <span className="a-hint">{t('step', { n: step - offset + 1, total: STEPS.length })}</span>}
          <h2>
            <Icon name={cur.icon} size={24} /> {t(titleOf(cur))}
          </h2>
          {err && (
            <p className="a-error">
              <Icon name="warning" size={18} /> {err}
            </p>
          )}
          {cur.view(ctx)}
          <footer className="a-foot">
            {isStep && step > offset && (
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
