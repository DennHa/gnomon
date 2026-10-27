// The setup wizard (/setup) and the Admin page (/admin) for a company's Gnomon server (docs/company-setup.md).
// Access: the one-time code in the link (#code=…) is traded for a short session, kept in this tab only.
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import qrcode from 'qrcode-generator';
import { Icon, type IconName } from './icons';
import { toCsv } from '../src/csv';
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
  rulesTitle: 'Rules (optional)',
  rulesIntro: 'What Gnomon may do on your people’s Macs. In Germany, talk to the works council and data protection before rolling out a time-tracking tool.',
  rManaged: 'Hide personal setup on Macs',
  rManagedWhy: 'Float, Personio and server connections are handled here; people don’t see token fields.',
  rApi: 'Allow the local API on Macs',
  rApiWhy: 'Lets other programs on a Mac read and change its times. Off unless someone needs it.',
  rTrail: 'Offer the activity trail',
  rTrailWhy: 'An opt-in memory aid: which app was in front, once a minute. It never leaves the Mac.',
  rPhone: 'Phone web app on this server',
  rPhoneWhy: 'People can clock in and track from their phone at this address.',
  // Working hours (after the setup: Company → Working hours)
  hoursTitle: 'Working hours',
  hoursIntro: 'How people see their hours against their own work schedule. Either way, the numbers are worked out on each person’s devices: admins never see anyone’s times or deviations.',
  hoursMode: 'What people see',
  hoursUnset: 'Each person chooses (overtime balance unless they switch)',
  hoursBalance: 'Overtime balance for everyone',
  hoursCorridor: 'Target corridor for everyone',
  hoursModeHint: 'Overtime balance: a running total above or below target. Target corridor: whether the average of the last few weeks stays near the target, without a bank of hours. Switching keeps all data.',
  hoursWeeks: 'Window (weeks)',
  hoursWeeksHint: 'The rolling average covers this many finished weeks.',
  hoursWithin: 'Within (± %)',
  hoursWithinHint: 'Less than this: within the corridor.',
  hoursCritical: 'Critical above (%)',
  hoursCriticalHint: 'More than this: critical. In between: elevated.',
  hoursZones: 'Within: under {within} % · elevated: {within}–{critical} % · critical: over {critical} %. Under and over target count alike.',
  hoursNote: 'Note under the chart',
  hoursNoteHint: 'Leave it empty for Gnomon’s note in each person’s language (shown as the placeholder).',
  hoursNoteDefault: 'Larger deviations that last should be agreed with your line manager beforehand; approval happens outside Gnomon. Always stay within the Working Time Act (ArbZG). Vacation and other absences go through Personio.',
  // 7
  rolloutTitle: 'Roll-out with Iru (optional)',
  rolloutIntro: 'Two files, and a checklist for your Mac management.',
  profile: 'Settings profile',
  profileWhy: 'Connects Gnomon to this server and applies your rules. It contains addresses and switches only, no tokens.',
  download: 'Download Gnomon.mobileconfig',
  needUrl: 'Enter the server’s address in step 2 first.',
  app: 'The app',
  appRelease: 'Gnomon {version} is ready to download from this server.',
  appDownload: 'Download Gnomon.dmg',
  appNone: 'No app to hand out yet: choose where it comes from in the step “The Mac app”.',
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
  backToSettings: 'Back to the Admin page',
  ownerTitle: 'Your account',
  ownerIntro: 'Everything on this server so far is yours: your times, projects and devices. Which email belongs to your account? It finds you in Float and Personio later, and for the company login.',
  ownerEmail: 'Your email',
  ownerName: 'Your name',
  ownerSave: 'Save',
  peopleTitle: 'People',
  pIntro: 'Everyone with an account on this server, and their devices. Admins manage accounts here; nobody sees anyone’s times.',
  pInviteTitle: 'Invite people',
  pOne: 'One person',
  pList: 'From a list',
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
  imIntro: 'Upload a CSV file or paste a list: one person per line, name and email, separated by comma, semicolon or tab. A header line is fine. You see what happens before anything is sent.',
  imFile: 'Choose a CSV file',
  imPaste: 'Jane Doe; jane.doe@example.com',
  imCheck: 'Check the list',
  imXlsx: 'This is an Excel file. In Excel, save it as “CSV UTF-8” first, then choose that file.',
  imNew: 'New',
  imAccount: 'Has an account',
  imInvited: 'Already invited',
  imDuplicate: 'Twice in the list',
  imInvalid: 'Not an email',
  imAll: 'All',
  imLine: 'Line',
  imName: 'Name',
  imNobody: 'Nobody new in this list: everyone has an account or an invitation already.',
  imOnlyNew: 'Only the {n} new people are invited, as members. Their links are valid for {days} days.',
  imSend: 'Send {n} invitations by email',
  imLinks: 'Create {n} links without email',
  imLinksOnly: 'Create {n} invitation links',
  imBack: 'Change the list',
  imProgress: 'Inviting… {done} of {total}',
  imKeepOpen: 'Keep this page open until it’s done.',
  imDone: 'Done.',
  imSent: '{n} invited by email',
  imMade: '{n} links to pass on',
  imFailed: '{n} didn’t work',
  imRetry: 'Try again',
  imCsv: 'Download links (CSV)',
  imCsvHint: 'Name, email, link and valid until, for each invitation that wasn’t emailed. Hand them out yourself or send them through your own mail.',
  imAnother: 'Import another list',
  imCsvHead: 'Name|Email|Link|Valid until',
  imLeave: 'Invitations are still being sent.',
  loginForgot: 'Forgot your password?',
  // Setup page for admins (docs/admin-guide.md)
  guide: 'Admin guide',
  welcomeTitle: 'Welcome',
  welcomeIntro: 'This page sets up your Gnomon server in about ten minutes. Only your admin account is required; you can skip everything else and come back later.',
  wServer: 'Server',
  wHttps: 'HTTPS',
  wKey: 'Secret key',
  wBackups: 'Backups',
  wVersion: 'Gnomon {v}',
  httpsCaddy: 'Caddy with an automatic certificate',
  httpsCaddyOwn: 'Caddy with your own certificate',
  httpsProxy: 'your own reverse proxy',
  httpsTunnel: 'Cloudflare Tunnel',
  httpsLocal: 'local test, no HTTPS',
  httpsManual: 'set up without the install script',
  wBackupsOn: 'every night, the last {n} kept',
  wBackupsNoKey: 'no backup password yet (step “Backups”)',
  wBackupsOff: 'off',
  wNeed: 'What you’ll need',
  accountStepTitle: 'Your admin account',
  accountStepIntro: 'You sign in to the Admin page with this from any browser, and it’s your own Gnomon account for tracking. More admins can be invited later.',
  accountDone: 'Signed in as {name} ({email}). Change your password later under Admin → Admin password.',
  accountCreate: 'Create account',
  accountRequired: 'Create your admin account first.',
  addrCheck: 'Check',
  addrChecking: 'Checking…',
  addr_ok: 'Reachable over HTTPS with a valid certificate, and it’s this server.',
  addr_ok_local: 'Reachable, but only on this machine and without HTTPS: fine for a test.',
  addr_not_https: 'The address has to start with https://',
  addr_invalid: 'That isn’t an address like https://gnomon.example.com',
  addr_dns: 'The name {host} isn’t found in DNS (yet).',
  addr_refused: 'Nothing answers at this address. Is the proxy or tunnel running?',
  addr_timeout: 'No answer within 10 seconds: a firewall, or the server can’t reach its own public address from inside.',
  addr_certificate: 'The certificate isn’t valid for {host} ({detail}).',
  addr_other_server: 'The address answers ({detail}), but not as this Gnomon server. Check that the proxy or tunnel forwards it here.',
  addrBrowser: 'You opened this page at {here}, so a browser reaches it there.',
  regStepTitle: 'Who may register',
  regStepIntro: 'For a company, “Invited only” is right: nobody gets an account without an invitation from an admin.',
  macTitle: 'The Mac app',
  macIntro: 'People download the app at {url}/latest, and the app looks there for new versions.',
  macGithub: 'The official release from GitHub',
  macGithubHint: 'Always the newest version from github.com/{repo}. The download goes straight to GitHub.',
  macUpload: 'Upload your own',
  macUploadHint: 'For example a build signed with your company’s Apple Developer ID. Upload each new version here.',
  macFolder: 'GNOMON_RELEASES_DIR is set, so the app comes from that folder; the choice here applies once it’s removed.',
  macNow: 'Handed out now: Gnomon {v}',
  macNowDate: 'Handed out now: Gnomon {v} from {date}',
  macNone: 'Nothing to hand out yet.',
  macLoading: 'Looking up the current version…',
  macFile: 'Choose the .dmg',
  macVersion: 'Version',
  macUploadButton: 'Upload',
  macUploading: 'Uploading… {p} %',
  macUploaded: 'Uploaded. Gnomon {v} is handed out now.',
  backupsTitle: 'Backups',
  backupsIntro: 'Every night the server makes an encrypted copy of everything into its data folder and keeps the newest ones. Copy them somewhere else too (see the admin guide): a backup on the same disk doesn’t help when the disk dies.',
  bNightly: 'Make a backup every night',
  bNightlyWhy: 'At the hour below, in the server’s time zone.',
  bHour: 'At',
  bKeep: 'Keep the newest',
  bPassword: 'Backup password',
  bPasswordSet: 'Set {when}. Backups can only be restored with it.',
  bPasswordNone: 'No backup password yet, so no backups are made. Set one now.',
  bLost: 'Keep the backup password in your password manager. Without it, a backup can’t be restored: nobody can recover it, not even the Gnomon project. The server keeps only a key that can encrypt, not decrypt.',
  bCurrent: 'Current backup password',
  bNew: 'New backup password (at least 12 characters)',
  bRepeat: 'Repeat it',
  bSetPassword: 'Set password',
  bChange: 'Change password',
  bChanged: 'Saved. New backups need this password; older ones still need the one they were made with.',
  bShort: 'At least 12 characters.',
  bRun: 'Back up now',
  bRunning: 'Backing up…',
  bFiles: 'On the server',
  bNoFiles: 'No backups yet.',
  bLastFailed: 'The last backup failed ({when}): {error}',
  bDownload: 'Download',
  inviteStepTitle: 'Invite people',
  inviteStepIntro: 'Invite one person or a whole list. You can do this any time later under People.',
  optional: '(optional)',
  sEmail: 'Email',
  sMacApp: 'Mac app',
  sBackups: 'Backups',
  sAdmin: 'Admin',
  doneIntroNew: 'The server is set up. After finishing, the setup link stops working; sign in at {url}/admin with your account for changes.',
  loading: 'Loading…',
  invitationsTitle: 'Invitations and approvals',
  signupTitle: 'Who may sign up',
  inboxGroup: 'Inbox',
  companyGroup: 'Company',
  companyDetails: 'Company details',
  macRollout: 'Mac app and roll-out',
  integrationsTitle: 'Float and Personio',
  serverGroup: 'Server',
  healthTitle: 'Health and updates',
  ownAccount: 'Your own account',
  pSelf: 'That’s you. Change your own account under “Your own account” in the menu at the top.',
  pDecline: 'Decline',
  pAsked: 'asked {date}',
  pDeclineConfirm: 'Decline {name}? Their request is deleted; they can ask again.',
  pExpiredOn: 'expired {date}',
  pUntil: 'until {date}',
  pSearch: 'Search name or email',
  pStatus: 'Status',
  pSeen: 'Last seen',
  pActions: 'Actions',
  pResendShort: 'Resend',
  pDetails: 'Devices and actions',
  pNoDevices: 'No devices connected.',
  pNoDevicesYet: 'No devices yet: they connect after signing up.',
  pNoMatch: 'Nobody matches.',
  pResending: 'Sending… {done} of {total}',
  pPendingHint: 'They signed up themselves. Their account works once you approve it.',
  pExpiredTitle: 'Expired invitations',
  pResendAll: 'Send all {n} again',
  pReinviteAll: 'New links for all {n}',
  pOpenTitle: 'Open invitations',
  pNothingOpen: 'No open invitations and nobody waiting.',
  oAttention: 'Needs attention',
  oAllGood: 'Nothing needs your attention.',
  oServer: 'Server',
  oDetails: 'Details',
  oExpired: '{n} expired',
  atPending: '{n} waiting for your approval',
  atReview: 'Review',
  atExpired: '{n} invitations expired before they were used',
  atResend: 'Resend',
  atEmail: 'Email isn’t set up: invitations are links you pass on, and nobody can reset a forgotten password',
  atSetUp: 'Set up',
  atAddress: 'Email is set up, but the server’s address is missing, so emails can’t link to it',
  atBackupKey: 'No backup password, so no backups are made',
  atBackupFailed: 'The last backup failed ({when}): {error}',
  atBackupsOff: 'Nightly backups are off',
  atBackupOld: 'No backup in the last two days',
  atDisk: 'The server’s disk is almost full',
  atUpdate: 'Gnomon {v} is available (this server runs {current})',
  atHowUpdate: 'How to update',
  atPassword: 'You have no password: set one to sign in here without a link',
  atFeedback: '{n} unread feedback conversations',
  atRead: 'Read',
  atUnknown: 'Something needs a look',
  atOpen: 'Open',
  hVersion: 'Version',
  hCurrent: 'Gnomon {v}, up to date',
  hUpdate: 'Gnomon {v}; {new} is available',
  hNoKey: 'No backup password yet',
  hBackupFailed: 'The last one failed ({when})',
  hBackupLast: 'Last one {when}, every night at {hour}:00',
  hBackupNone: 'None yet; the first tonight at {hour}:00',
  hDisk: 'Disk',
  hDiskFree: '{free} free of {total}',
  hTested: 'tested {when}',
  hUntested: 'not tested yet',
  hEmailOff: 'Not set up',
  hEncryption: 'Data at rest',
  hEncOn: 'Encrypted, key from {key}',
  hEncOff: 'Not encrypted',
  hEncCopies: '{n} unencrypted copies left',
  atNotEncrypted: 'The data isn’t encrypted at rest: set GNOMON_DATA_KEY so a copied database or disk can’t be read',
  atPlainCopies: '{n} unencrypted copies of the database are left in the data folder. Check that all is well, then delete them on the server:',
  atPlainCopy: 'An unencrypted copy of the database is left in the data folder. Check that all is well, then delete it on the server:',
  hEncCopy: '1 unencrypted copy left',
  atHowTo: 'How to',
  atMore: 'and {n} more',
  keyFileShort: 'Key file in the data folder',
  hUpdateTitle: 'Gnomon {v} is available',
  hUpdateHow: 'On the server, this makes a backup first, then downloads and starts the new version. People keep working; their apps reconnect by themselves.',
  hWhatsNew: 'What’s new',
  hRunning: 'Running',
  hSince: 'since {when}',
  hDevices: '{n} connected',
  hCleanup: 'Remove unused devices',
  rerunHint: 'Walks through every setup step again. Nothing is lost; each step shows what’s set now.',
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
  rulesTitle: 'Regeln (optional)',
  rulesIntro: 'Was Gnomon auf den Macs deiner Leute darf. In Deutschland vor der Einführung eines Zeiterfassungs-Tools mit Betriebsrat und Datenschutz sprechen.',
  rManaged: 'Persönliche Einrichtung auf Macs ausblenden',
  rManagedWhy: 'Float, Personio und Server-Verbindung laufen hier; niemand sieht Token-Felder.',
  rApi: 'Lokale API auf Macs erlauben',
  rApiWhy: 'Andere Programme auf einem Mac können dessen Zeiten lesen und ändern. Aus, außer jemand braucht es.',
  rTrail: 'Aktivitätsspur anbieten',
  rTrailWhy: 'Eine freiwillige Gedächtnisstütze: welche App vorne war, einmal pro Minute. Sie verlässt den Mac nie.',
  rPhone: 'Handy-Web-App auf diesem Server',
  rPhoneWhy: 'Alle können sich unter dieser Adresse auch per Handy einstempeln und Zeiten erfassen.',
  hoursTitle: 'Arbeitszeit',
  hoursIntro: 'Wie alle ihre Stunden im Vergleich zum eigenen Arbeitszeitmodell sehen. So oder so wird auf den Geräten jeder Person gerechnet: Admins sehen nie die Zeiten oder Abweichungen anderer.',
  hoursMode: 'Was alle sehen',
  hoursUnset: 'Jede Person wählt selbst (Überstundenkonto, solange sie nicht umschaltet)',
  hoursBalance: 'Überstundenkonto für alle',
  hoursCorridor: 'Zielkorridor für alle',
  hoursModeHint: 'Überstundenkonto: ein laufender Saldo über oder unter dem Soll. Zielkorridor: ob der Durchschnitt der letzten Wochen nahe am Soll bleibt, ohne Stundenkonto. Beim Umschalten bleiben alle Daten erhalten.',
  hoursWeeks: 'Zeitraum (Wochen)',
  hoursWeeksHint: 'So viele abgeschlossene Wochen umfasst der gleitende Durchschnitt.',
  hoursWithin: 'Im Korridor (± %)',
  hoursWithinHint: 'Weniger als das: im Zielkorridor.',
  hoursCritical: 'Kritisch ab (%)',
  hoursCriticalHint: 'Mehr als das: kritisch. Dazwischen: erhöht.',
  hoursZones: 'Im Korridor: unter {within} % · erhöht: {within}–{critical} % · kritisch: über {critical} %. Unter und über dem Soll zählen gleich.',
  hoursNote: 'Hinweis unter dem Diagramm',
  hoursNoteHint: 'Leer lassen für den Hinweis von Gnomon in der Sprache der jeweiligen Person (als Platzhalter zu sehen).',
  hoursNoteDefault: 'Größere, länger anhaltende Abweichungen stimmst du vorher mit deiner Führungskraft ab; die Freigabe erfolgt außerhalb von Gnomon. Halte immer das Arbeitszeitgesetz (ArbZG) ein. Urlaub und andere Abwesenheiten laufen über Personio.',
  rolloutTitle: 'Verteilen mit Iru (optional)',
  rolloutIntro: 'Zwei Dateien und eine Checkliste für deine Mac-Verwaltung.',
  profile: 'Einstellungsprofil',
  profileWhy: 'Verbindet Gnomon mit diesem Server und setzt deine Regeln. Es enthält nur Adressen und Schalter, keine Tokens.',
  download: 'Gnomon.mobileconfig herunterladen',
  needUrl: 'Trag zuerst in Schritt 2 die Adresse des Servers ein.',
  app: 'Die App',
  appRelease: 'Gnomon {version} liegt auf diesem Server zum Herunterladen bereit.',
  appDownload: 'Gnomon.dmg herunterladen',
  appNone: 'Noch keine App zum Ausgeben: Wähl im Schritt „Die Mac-App“, woher sie kommt.',
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
  backToSettings: 'Zurück zur Verwaltung',
  ownerTitle: 'Dein Konto',
  ownerIntro: 'Alles auf diesem Server gehört bisher dir: deine Zeiten, Projekte und Geräte. Welche E-Mail gehört zu deinem Konto? Darüber findet der Server dich später in Float und Personio und beim Firmen-Login.',
  ownerEmail: 'Deine E-Mail',
  ownerName: 'Dein Name',
  ownerSave: 'Sichern',
  peopleTitle: 'Personen',
  pIntro: 'Alle mit einem Konto auf diesem Server, und ihre Geräte. Admins verwalten hier Konten; niemand sieht die Zeiten anderer.',
  pInviteTitle: 'Personen einladen',
  pOne: 'Eine Person',
  pList: 'Aus einer Liste',
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
  imIntro: 'Lade eine CSV-Datei hoch oder füge eine Liste ein: eine Person pro Zeile, Name und E-Mail, getrennt durch Komma, Semikolon oder Tab. Eine Kopfzeile ist in Ordnung. Du siehst, was passiert, bevor etwas verschickt wird.',
  imFile: 'CSV-Datei wählen',
  imPaste: 'Erika Muster; erika.muster@example.com',
  imCheck: 'Liste prüfen',
  imXlsx: 'Das ist eine Excel-Datei. Speichere sie in Excel zuerst als „CSV UTF-8“ und wähle dann diese Datei.',
  imNew: 'Neu',
  imAccount: 'Hat ein Konto',
  imInvited: 'Schon eingeladen',
  imDuplicate: 'Doppelt in der Liste',
  imInvalid: 'Keine E-Mail',
  imAll: 'Alle',
  imLine: 'Zeile',
  imName: 'Name',
  imNobody: 'Niemand Neues in dieser Liste: Alle haben schon ein Konto oder eine Einladung.',
  imOnlyNew: 'Nur die {n} neuen Personen werden eingeladen, als Mitglieder. Ihre Links gelten {days} Tage.',
  imSend: '{n} Einladungen per E-Mail senden',
  imLinks: '{n} Links ohne E-Mail erstellen',
  imLinksOnly: '{n} Einladungslinks erstellen',
  imBack: 'Liste ändern',
  imProgress: 'Lädt ein… {done} von {total}',
  imKeepOpen: 'Lass diese Seite offen, bis es fertig ist.',
  imDone: 'Fertig.',
  imSent: '{n} per E-Mail eingeladen',
  imMade: '{n} Links zum Weitergeben',
  imFailed: '{n} hat nicht geklappt',
  imRetry: 'Noch mal versuchen',
  imCsv: 'Links herunterladen (CSV)',
  imCsvHint: 'Name, E-Mail, Link und gültig bis, für jede Einladung, die nicht per E-Mail ging. Gib sie selbst weiter oder verschick sie über eure eigene Mail.',
  imAnother: 'Weitere Liste importieren',
  imCsvHead: 'Name|E-Mail|Link|Gültig bis',
  imLeave: 'Einladungen werden noch verschickt.',
  loginForgot: 'Passwort vergessen?',
  guide: 'Anleitung für Admins',
  welcomeTitle: 'Willkommen',
  welcomeIntro: 'Diese Seite richtet deinen Gnomon-Server in etwa zehn Minuten ein. Nötig ist nur dein Admin-Konto; alles andere kannst du überspringen und später nachholen.',
  wServer: 'Server',
  wHttps: 'HTTPS',
  wKey: 'Geheimer Schlüssel',
  wBackups: 'Backups',
  wVersion: 'Gnomon {v}',
  httpsCaddy: 'Caddy mit automatischem Zertifikat',
  httpsCaddyOwn: 'Caddy mit eigenem Zertifikat',
  httpsProxy: 'euer eigener Reverse Proxy',
  httpsTunnel: 'Cloudflare Tunnel',
  httpsLocal: 'lokaler Test, ohne HTTPS',
  httpsManual: 'ohne das Installationsskript eingerichtet',
  wBackupsOn: 'jede Nacht, die letzten {n} bleiben',
  wBackupsNoKey: 'noch kein Backup-Passwort (Schritt „Backups“)',
  wBackupsOff: 'aus',
  wNeed: 'Was du brauchst',
  accountStepTitle: 'Dein Admin-Konto',
  accountStepIntro: 'Damit meldest du dich in jedem Browser in der Verwaltung an, und es ist dein eigenes Gnomon-Konto zum Erfassen. Weitere Admins kannst du später einladen.',
  accountDone: 'Angemeldet als {name} ({email}). Das Passwort änderst du später unter Verwaltung → Admin-Passwort.',
  accountCreate: 'Konto anlegen',
  accountRequired: 'Leg zuerst dein Admin-Konto an.',
  addrCheck: 'Prüfen',
  addrChecking: 'Prüft…',
  addr_ok: 'Über HTTPS mit gültigem Zertifikat erreichbar, und es ist dieser Server.',
  addr_ok_local: 'Erreichbar, aber nur auf diesem Rechner und ohne HTTPS: gut für einen Test.',
  addr_not_https: 'Die Adresse muss mit https:// anfangen.',
  addr_invalid: 'Das ist keine Adresse wie https://gnomon.example.com',
  addr_dns: 'Den Namen {host} gibt es (noch) nicht im DNS.',
  addr_refused: 'Unter dieser Adresse antwortet nichts. Läuft der Proxy oder Tunnel?',
  addr_timeout: 'Keine Antwort in 10 Sekunden: eine Firewall, oder der Server erreicht seine eigene öffentliche Adresse von innen nicht.',
  addr_certificate: 'Das Zertifikat gilt nicht für {host} ({detail}).',
  addr_other_server: 'Die Adresse antwortet ({detail}), aber nicht als dieser Gnomon-Server. Prüf, ob der Proxy oder Tunnel hierher weiterleitet.',
  addrBrowser: 'Du hast diese Seite unter {here} geöffnet, ein Browser erreicht sie also dort.',
  regStepTitle: 'Wer sich registrieren darf',
  regStepIntro: 'Für eine Firma ist „Nur mit Einladung“ richtig: Niemand bekommt ein Konto ohne Einladung von einem Admin.',
  macTitle: 'Die Mac-App',
  macIntro: 'Die App gibt es unter {url}/latest, und die App sucht dort nach neuen Versionen.',
  macGithub: 'Die offizielle Version von GitHub',
  macGithubHint: 'Immer die neueste Version von github.com/{repo}. Der Download kommt direkt von GitHub.',
  macUpload: 'Eigene hochladen',
  macUploadHint: 'Zum Beispiel eine mit eurer eigenen Apple-Developer-ID signierte Version. Jede neue Version hier hochladen.',
  macFolder: 'GNOMON_RELEASES_DIR ist gesetzt, die App kommt also aus diesem Ordner; die Wahl hier gilt, sobald er entfernt ist.',
  macNow: 'Ausgegeben wird: Gnomon {v}',
  macNowDate: 'Ausgegeben wird: Gnomon {v} vom {date}',
  macNone: 'Noch nichts zum Ausgeben.',
  macLoading: 'Aktuelle Version wird gesucht…',
  macFile: '.dmg auswählen',
  macVersion: 'Version',
  macUploadButton: 'Hochladen',
  macUploading: 'Lädt hoch… {p} %',
  macUploaded: 'Hochgeladen. Ausgegeben wird jetzt Gnomon {v}.',
  backupsTitle: 'Backups',
  backupsIntro: 'Jede Nacht macht der Server eine verschlüsselte Kopie von allem in seinen Datenordner und behält die neuesten. Kopier sie auch woandershin (siehe Anleitung): Ein Backup auf derselben Platte hilft nicht, wenn die Platte kaputtgeht.',
  bNightly: 'Jede Nacht ein Backup machen',
  bNightlyWhy: 'Zur Stunde unten, in der Zeitzone des Servers.',
  bHour: 'Um',
  bKeep: 'Behalten: die neuesten',
  bPassword: 'Backup-Passwort',
  bPasswordSet: 'Gesetzt am {when}. Nur damit lassen sich Backups wiederherstellen.',
  bPasswordNone: 'Noch kein Backup-Passwort, deshalb werden keine Backups gemacht. Setz jetzt eins.',
  bLost: 'Bewahr das Backup-Passwort in deinem Passwort-Manager auf. Ohne es lässt sich ein Backup nicht wiederherstellen: Niemand kann es zurückholen, auch nicht das Gnomon-Projekt. Der Server hat nur einen Schlüssel, der verschlüsseln kann, nicht entschlüsseln.',
  bCurrent: 'Aktuelles Backup-Passwort',
  bNew: 'Neues Backup-Passwort (mindestens 12 Zeichen)',
  bRepeat: 'Noch einmal',
  bSetPassword: 'Passwort setzen',
  bChange: 'Passwort ändern',
  bChanged: 'Gespeichert. Neue Backups brauchen dieses Passwort; ältere weiter das, mit dem sie gemacht wurden.',
  bShort: 'Mindestens 12 Zeichen.',
  bRun: 'Jetzt sichern',
  bRunning: 'Sichert…',
  bFiles: 'Auf dem Server',
  bNoFiles: 'Noch keine Backups.',
  bLastFailed: 'Das letzte Backup ist fehlgeschlagen ({when}): {error}',
  bDownload: 'Herunterladen',
  inviteStepTitle: 'Leute einladen',
  inviteStepIntro: 'Lade eine Person oder eine ganze Liste ein. Das geht auch jederzeit später unter Personen.',
  optional: '(optional)',
  sEmail: 'E-Mail',
  sMacApp: 'Mac-App',
  sBackups: 'Backups',
  sAdmin: 'Admin',
  doneIntroNew: 'Der Server ist eingerichtet. Nach dem Abschließen funktioniert der Einrichtungslink nicht mehr; für Änderungen meldest du dich unter {url}/admin mit deinem Konto an.',
  loading: 'Lädt…',
  invitationsTitle: 'Einladungen und Freigaben',
  signupTitle: 'Wer sich anmelden darf',
  inboxGroup: 'Posteingang',
  companyGroup: 'Firma',
  companyDetails: 'Firmendaten',
  macRollout: 'Mac-App und Verteilung',
  integrationsTitle: 'Float und Personio',
  serverGroup: 'Server',
  healthTitle: 'Zustand und Updates',
  ownAccount: 'Dein eigenes Konto',
  pSelf: 'Das bist du. Dein eigenes Konto änderst du unter „Dein eigenes Konto“ im Menü oben.',
  pDecline: 'Ablehnen',
  pAsked: 'angefragt am {date}',
  pDeclineConfirm: '{name} ablehnen? Die Anfrage wird gelöscht; sie können es erneut versuchen.',
  pExpiredOn: 'abgelaufen am {date}',
  pUntil: 'bis {date}',
  pSearch: 'Name oder E-Mail suchen',
  pStatus: 'Status',
  pSeen: 'Zuletzt aktiv',
  pActions: 'Aktionen',
  pResendShort: 'Erneut senden',
  pDetails: 'Geräte und Aktionen',
  pNoDevices: 'Keine Geräte verbunden.',
  pNoDevicesYet: 'Noch keine Geräte: die kommen nach der Anmeldung.',
  pNoMatch: 'Niemand passt.',
  pResending: 'Sendet… {done} von {total}',
  pPendingHint: 'Sie haben sich selbst angemeldet. Das Konto funktioniert, sobald du es freigibst.',
  pExpiredTitle: 'Abgelaufene Einladungen',
  pResendAll: 'Alle {n} erneut senden',
  pReinviteAll: 'Neue Links für alle {n}',
  pOpenTitle: 'Offene Einladungen',
  pNothingOpen: 'Keine offenen Einladungen, niemand wartet.',
  oAttention: 'Braucht Aufmerksamkeit',
  oAllGood: 'Nichts braucht gerade deine Aufmerksamkeit.',
  oServer: 'Server',
  oDetails: 'Details',
  oExpired: '{n} abgelaufen',
  atPending: '{n} warten auf deine Freigabe',
  atReview: 'Ansehen',
  atExpired: '{n} Einladungen sind abgelaufen, ohne benutzt zu werden',
  atResend: 'Erneut senden',
  atEmail: 'E-Mail ist nicht eingerichtet: Einladungen sind Links zum Weitergeben, und niemand kann ein vergessenes Passwort zurücksetzen',
  atSetUp: 'Einrichten',
  atAddress: 'E-Mail ist eingerichtet, aber die Adresse des Servers fehlt, also können E-Mails nicht darauf verlinken',
  atBackupKey: 'Kein Backup-Passwort, also werden keine Backups gemacht',
  atBackupFailed: 'Das letzte Backup ist fehlgeschlagen ({when}): {error}',
  atBackupsOff: 'Die nächtlichen Backups sind aus',
  atBackupOld: 'Seit zwei Tagen kein Backup',
  atDisk: 'Die Festplatte des Servers ist fast voll',
  atUpdate: 'Gnomon {v} ist da (dieser Server hat {current})',
  atHowUpdate: 'So geht’s',
  atPassword: 'Du hast kein Passwort: setz eins, um dich hier ohne Link anzumelden',
  atFeedback: '{n} ungelesene Feedback-Gespräche',
  atRead: 'Lesen',
  atUnknown: 'Etwas braucht einen Blick',
  atOpen: 'Öffnen',
  hVersion: 'Version',
  hCurrent: 'Gnomon {v}, aktuell',
  hUpdate: 'Gnomon {v}; {new} ist da',
  hNoKey: 'Noch kein Backup-Passwort',
  hBackupFailed: 'Das letzte ist fehlgeschlagen ({when})',
  hBackupLast: 'Letztes {when}, jede Nacht um {hour}:00',
  hBackupNone: 'Noch keins; das erste heute Nacht um {hour}:00',
  hDisk: 'Festplatte',
  hDiskFree: '{free} frei von {total}',
  hTested: 'getestet {when}',
  hUntested: 'noch nicht getestet',
  hEmailOff: 'Nicht eingerichtet',
  hEncryption: 'Daten auf dem Server',
  hEncOn: 'Verschlüsselt, Schlüssel aus {key}',
  hEncOff: 'Nicht verschlüsselt',
  hEncCopies: '{n} unverschlüsselte Kopien übrig',
  atNotEncrypted: 'Die Daten sind nicht verschlüsselt gespeichert: setz GNOMON_DATA_KEY, damit eine kopierte Datenbank oder Festplatte nicht lesbar ist',
  atPlainCopies: '{n} unverschlüsselte Kopien der Datenbank liegen noch im Datenordner. Prüf, ob alles läuft, und lösch sie dann auf dem Server:',
  atPlainCopy: 'Eine unverschlüsselte Kopie der Datenbank liegt noch im Datenordner. Prüf, ob alles läuft, und lösch sie dann auf dem Server:',
  hEncCopy: '1 unverschlüsselte Kopie übrig',
  atHowTo: 'So geht’s',
  atMore: 'und {n} weitere',
  keyFileShort: 'Schlüsseldatei im Datenordner',
  hUpdateTitle: 'Gnomon {v} ist da',
  hUpdateHow: 'Auf dem Server: das macht zuerst ein Backup, lädt dann die neue Version und startet sie. Alle arbeiten weiter; ihre Apps verbinden sich von selbst neu.',
  hWhatsNew: 'Was ist neu',
  hRunning: 'Läuft',
  hSince: 'seit {when}',
  hDevices: '{n} verbunden',
  hCleanup: 'Unbenutzte Geräte entfernen',
  rerunHint: 'Geht alle Einrichtungsschritte noch einmal durch. Nichts geht verloren; jeder Schritt zeigt, was jetzt eingestellt ist.',
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
  hours: { mode: 'unset' | 'balance' | 'corridor'; weeks: number; within: number; critical: number; note: string };
  email?: EmailSettings;
  macApp: { source: 'github' | 'upload' };
  audit: { at: string; what: string }[];
};
type EmailSettings = { provider: 'smtp'; host: string; port: number; security: 'tls' | 'starttls' | 'none'; user: string; from: string; tested?: string } | { provider: 'graph'; tenantId: string; clientId: string; from: string; tested?: string };
type State = {
  version: string;
  https: string | null;
  macApp: { from: 'folder' | 'upload' | 'github'; upload: string | null };
  backups: BackupStatus | null;
  config: Config; secrets: { float: boolean; personio: boolean; email: boolean }; email: { ready: boolean; publicUrl: boolean }; keySource: 'env' | 'file'; release: { version: string; size: number } | null; devices: number; passwordSet: boolean; feedbackUnread: number; me: { id: string; email: string | null; name: string }; registration: 'invite' | 'approval' | 'open'; pending: number };

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
      <AddressCheck url={v.publicUrl.trim()} />
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

/** Balance or corridor for everyone (or each person's choice), and the corridor's zones and note (src/corridor.ts). */
function HoursStep({ s, setS, setErr }: Ctx) {
  const [v, setV] = useState(s.config.hours);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    try {
      setS(await call('PUT', '/config', { hours: v }));
      setErr(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const num = (k: 'weeks' | 'within' | 'critical') => (e: { target: { value: string } }) => setV({ ...v, [k]: Number(e.target.value) });
  return (
    <>
      <p className="a-intro">{t('hoursIntro')}</p>
      <Field label={t('hoursMode')} hint={t('hoursModeHint')}>
        <select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as Config['hours']['mode'] })}>
          <option value="unset">{t('hoursUnset')}</option>
          <option value="balance">{t('hoursBalance')}</option>
          <option value="corridor">{t('hoursCorridor')}</option>
        </select>
      </Field>
      <div className="a-row">
        <Field label={t('hoursWeeks')} hint={t('hoursWeeksHint')}>
          <input type="number" min={1} max={26} step={1} value={v.weeks} onChange={num('weeks')} />
        </Field>
        <Field label={t('hoursWithin')} hint={t('hoursWithinHint')}>
          <input type="number" min={1} max={100} step={1} value={v.within} onChange={num('within')} />
        </Field>
        <Field label={t('hoursCritical')} hint={t('hoursCriticalHint')}>
          <input type="number" min={1} max={200} step={1} value={v.critical} onChange={num('critical')} />
        </Field>
      </div>
      <p className="a-hint">{t('hoursZones', { within: v.within, critical: v.critical })}</p>
      <Field label={t('hoursNote')} hint={t('hoursNoteHint')}>
        <textarea rows={3} maxLength={1000} value={v.note} placeholder={t('hoursNoteDefault')} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </Field>
      <button className="primary a-save" onClick={save}>
        {saved ? t('saved') : t('save')}
      </button>
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

function Done(ctx: Ctx) {
  const { s, setS } = ctx;
  const c = s.config;
  const b = s.backups;
  const rows: [Key, string][] = [
    ['sAdmin', s.me.email ? `${s.me.name} · ${s.me.email}` : '—'],
    ['sCompany', [c.company.name, c.company.publicUrl].filter(Boolean).join(' · ') || '—'],
    ['sEmail', s.email.ready ? (c.email?.tested ? t('emailReady', { when: new Date(c.email.tested).toLocaleDateString() }) : t('emailUntested')) : t('notSet')],
    ['sMacApp', s.release ? t('macNow', { v: s.release.version }) : t(c.macApp.source === 'github' ? 'macGithub' : 'macNone')],
    ['sBackups', !b ? '—' : !b.keySet ? t('wBackupsNoKey') : b.enabled ? t('wBackupsOn', { n: b.keep }) : t('wBackupsOff')],
    ['sFloat', ctx.s.secrets.float ? t('floatOk', { n: c.float.people ?? 0 }) : t('notSet')],
    ['sPersonio', ctx.s.secrets.personio ? t('personioOk', { n: c.personio.people ?? 0 }) : t('notSet')],
    ['sRules', t(c.rules.managed ? 'yes' : 'no')],
    ['sKey', t(s.keySource === 'env' ? 'keyEnv' : 'keyFile')],
  ];
  return (
    <>
      <p className="a-intro">
        {t('doneIntroNew', { url: c.company.publicUrl || location.origin })}{' '}
        <a href={GUIDE} target="_blank" rel="noreferrer">
          {t('guide')}
        </a>
      </p>
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


// ---- Setup for admins: welcome, admin account, Mac app, backups (docs/admin-guide.md) --------------

const GUIDE = 'https://github.com/DennHa/gnomon/blob/main/docs/admin-guide.md';
const HTTPS_TEXT: Record<string, Key> = { caddy: 'httpsCaddy', 'caddy-own': 'httpsCaddyOwn', proxy: 'httpsProxy', tunnel: 'httpsTunnel', local: 'httpsLocal' };

function Welcome(ctx: Ctx) {
  const { s } = ctx;
  const b = s.backups;
  const rows: [Key, string, boolean][] = [
    ['wServer', t('wVersion', { v: s.version }), true],
    ['wHttps', t(HTTPS_TEXT[s.https ?? ''] ?? 'httpsManual'), s.https !== 'local'],
    ['wKey', t(s.keySource === 'env' ? 'keyEnv' : 'keyFile'), s.keySource === 'env'],
    ['wBackups', !b ? '—' : !b.keySet ? t('wBackupsNoKey') : b.enabled ? t('wBackupsOn', { n: b.keep }) : t('wBackupsOff'), Boolean(b?.keySet && b.enabled)],
  ];
  return (
    <>
      <p className="a-intro">
        {t('welcomeIntro')}{' '}
        <a href={GUIDE} target="_blank" rel="noreferrer">
          {t('guide')}
        </a>
      </p>
      <div className="a-card">
        <dl className="a-summary">
          {rows.map(([k, v, ok]) => (
            <div key={k}>
              <dt>{t(k)}</dt>
              <dd className={ok ? 'a-good' : 'a-meh'}>
                <Icon name={ok ? 'check_circle' : 'warning'} size={16} /> {v}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <h3>{t('wNeed')}</h3>
      <Before {...ctx} />
    </>
  );
}

function AccountStep({ s, setS, setErr }: Ctx) {
  const [name, setName] = useState(s.me.name === 'Owner' ? '' : s.me.name);
  const [email, setEmail] = useState(s.me.email ?? '');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  if (s.passwordSet && s.me.email)
    return (
      <>
        <p className="a-intro">{t('accountStepIntro')}</p>
        <div className="a-ok">
          <Icon name="check_circle" /> {t('accountDone', { name: s.me.name, email: s.me.email })}
        </div>
      </>
    );
  return (
    <form
      className="a-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pw.length < 10) return setErr(t('pwShort'));
        if (pw !== pw2) return setErr(t('pwMismatch'));
        try {
          setS(await call('POST', '/account', { name, email, password: pw }));
          setErr(null);
        } catch (e) {
          setErr((e as Error).message);
        }
      }}
    >
      <p className="a-intro">{t('accountStepIntro')}</p>
      <div className="a-row">
        <Field label={t('ownerName')}>
          <input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('ownerEmail')}>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>
      <div className="a-row">
        <Field label={t('pwNew')} hint={t('pwShort')}>
          <input type="password" autoComplete="new-password" required minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label={t('pwRepeat')}>
          <input type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
      </div>
      <button className="primary a-save">{t('accountCreate')}</button>
    </form>
  );
}

/** The HTTPS check next to the server's address: the server opens its own address and must find itself there. */
function AddressCheck({ url }: { url: string }) {
  const [r, setR] = useState<{ ok: boolean; code?: string; message: string; host?: string; detail?: string } | 'busy' | null>(null);
  useEffect(() => setR(null), [url]);
  const here = location.origin;
  return (
    <div className="a-check-address">
      <button
        type="button"
        className="soft"
        disabled={!url || r === 'busy'}
        onClick={async () => {
          setR('busy');
          setR(await call<{ ok: boolean; message: string }>('POST', '/check-address', { url }).catch((e) => ({ ok: false, message: (e as Error).message })));
        }}
      >
        <Icon name="lock" size={16} /> {r === 'busy' ? t('addrChecking') : t('addrCheck')}
      </button>
      {r && r !== 'busy' && (
        <p className={r.ok ? 'a-ok' : 'a-warn'}>
          <Icon name={r.ok ? 'check_circle' : 'warning'} size={16} /> {r.code && `addr_${r.code}` in L ? t(`addr_${r.code}` as Key, { host: r.host ?? '', detail: r.detail ?? '' }) : r.message}
          {!r.ok && url.replace(/\/$/, '') === here && ` ${t('addrBrowser', { here })}`}
        </p>
      )}
    </div>
  );
}

type MacAppInfo = { from: 'folder' | 'upload' | 'github'; release: { version: string; date: string | null; size: number; file: string } | null };

function MacAppStep({ s, setS, setErr }: Ctx) {
  const [info, setInfo] = useState<MacAppInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const source = s.config.macApp.source;
  const load = () => call<MacAppInfo>('GET', '/mac-app').then(setInfo, (e) => setErr((e as Error).message));
  useEffect(() => {
    setInfo(null);
    void load();
  }, [source]);
  const choose = async (v: 'github' | 'upload') => {
    try {
      setS(await call('PUT', '/config', { macApp: { source: v } }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const upload = () => {
    if (!file) return;
    setErr(null);
    setDone(null);
    // XMLHttpRequest for the progress bar; a .dmg is easily 100 MB.
    const x = new XMLHttpRequest();
    x.open('PUT', `/api/v1/admin/mac-app?version=${encodeURIComponent(version.trim())}`);
    x.setRequestHeader('Authorization', `Bearer ${token}`);
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      setProgress(null);
      const json = (() => {
        try {
          return JSON.parse(x.responseText);
        } catch {
          return {};
        }
      })();
      if (x.status !== 200) return setErr(json.message || x.statusText);
      setS(json as State);
      setDone(version.trim());
      setFile(null);
      void load();
    };
    x.onerror = () => (setProgress(null), setErr(x.statusText || 'Upload failed'));
    x.send(file);
  };
  const url = s.config.company.publicUrl || location.origin;
  return (
    <>
      <p className="a-intro">{t('macIntro', { url })}</p>
      {s.macApp.from === 'folder' && <p className="a-warn">{t('macFolder')}</p>}
      <div className="a-list">
        {(['github', 'upload'] as const).map((v) => (
          <label key={v} className={`a-item ${source === v ? 'done' : ''}`}>
            <input type="radio" name="mac-source" checked={source === v} onChange={() => choose(v)} />
            <Icon name={v === 'github' ? 'download' : 'upload'} size={22} />
            <span>
              <strong>{t(v === 'github' ? 'macGithub' : 'macUpload')}</strong>
              <span className="a-hint">{v === 'github' ? t('macGithubHint', { repo: 'DennHa/gnomon' }) : t('macUploadHint')}</span>
            </span>
          </label>
        ))}
      </div>
      {source === 'upload' && s.macApp.from !== 'folder' && (
        <div className="a-card">
          <div className="a-row">
            <Field label={t('macFile')}>
              <input
                type="file"
                accept=".dmg"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  const v = f?.name.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/)?.[1];
                  if (v) setVersion(v);
                }}
              />
            </Field>
            <Field label={t('macVersion')}>
              <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.2.3" spellCheck={false} />
            </Field>
          </div>
          <button className="primary a-save" disabled={!file || !version.trim() || progress !== null} onClick={upload}>
            <Icon name="upload" size={18} /> {progress !== null ? t('macUploading', { p: progress }) : t('macUploadButton')}
          </button>
          {done && <p className="a-ok">{t('macUploaded', { v: done })}</p>}
        </div>
      )}
      <p className="a-hint">
        {!info ? t('macLoading') : info.release ? (info.release.date ? t('macNowDate', { v: info.release.version, date: info.release.date }) : t('macNow', { v: info.release.version })) : t('macNone')}
      </p>
      <p className="a-warn">{t('appSigned')}</p>
    </>
  );
}

type BackupStatus = { enabled: boolean; hour: number; keep: number; keySet: boolean; keySetAt?: string; files: { name: string; size: number; at: string }[]; last?: { at: string; ok: boolean; error?: string } };

function BackupsStep({ s, setS, setErr }: Ctx) {
  const [b, setB] = useState<BackupStatus | null>(s.backups);
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [changing, setChanging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (method: string, path: string, body?: unknown) => {
    try {
      setErr(null);
      const r = await call<BackupStatus>(method, path, body);
      setB(r);
      setS({ ...s, backups: r });
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    }
  };
  if (!b) return <p className="a-warn">—</p>;
  const download = async (name: string) => {
    const res = await fetch(`/api/v1/admin/backups/files/${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return setErr(res.statusText);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const size = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  return (
    <>
      <p className="a-intro">{t('backupsIntro')}</p>
      <div className="a-card">
        <Toggle on={b.enabled} onChange={(v) => run('PUT', '/backups', { enabled: v })} label={t('bNightly')} why={t('bNightlyWhy')} />
        <div className="a-row">
          <Field label={t('bHour')}>
            <select value={b.hour} onChange={(e) => run('PUT', '/backups', { hour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('bKeep')}>
            <input type="number" min={1} max={365} defaultValue={b.keep} onBlur={(e) => Number(e.target.value) !== b.keep && run('PUT', '/backups', { keep: Math.round(Number(e.target.value)) })} />
          </Field>
        </div>
      </div>
      <div className="a-card">
        <strong>
          <Icon name="lock" size={18} /> {t('bPassword')}
        </strong>
        <span className="a-hint">{b.keySet ? t('bPasswordSet', { when: b.keySetAt ? new Date(b.keySetAt).toLocaleDateString() : '' }) : t('bPasswordNone')}</span>
        <p className="a-warn">
          <Icon name="warning" size={16} /> {t('bLost')}
        </p>
        {b.keySet && !changing ? (
          <button className="soft a-save" onClick={() => (setChanging(true), setNotice(null))}>
            {t('bChange')}
          </button>
        ) : (
          <form
            className="a-form a-tight"
            onSubmit={async (e) => {
              e.preventDefault();
              if (pw.length < 12) return setErr(t('bShort'));
              if (pw !== pw2) return setErr(t('pwMismatch'));
              if (await run('POST', '/backups/password', { password: pw, current: b.keySet ? current : undefined })) {
                setPw('');
                setPw2('');
                setCurrent('');
                setChanging(false);
                setNotice(t('bChanged'));
              }
            }}
          >
            {b.keySet && (
              <Field label={t('bCurrent')}>
                <input type="password" autoComplete="off" required value={current} onChange={(e) => setCurrent(e.target.value)} />
              </Field>
            )}
            <div className="a-row">
              <Field label={t('bNew')}>
                <input type="password" autoComplete="new-password" required minLength={12} value={pw} onChange={(e) => setPw(e.target.value)} />
              </Field>
              <Field label={t('bRepeat')}>
                <input type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} />
              </Field>
            </div>
            <button className="primary a-save">{t(b.keySet ? 'bChange' : 'bSetPassword')}</button>
          </form>
        )}
        {notice && <p className="a-ok">{notice}</p>}
      </div>
      <div className="a-card">
        <div className="a-card-head">
          <strong>
            <Icon name="backup" size={18} /> {t('bFiles')}
          </strong>
          <button className="soft" disabled={!b.keySet || busy} onClick={async () => (setBusy(true), await run('POST', '/backups/run'), setBusy(false))}>
            {busy ? t('bRunning') : t('bRun')}
          </button>
        </div>
        {b.last && !b.last.ok && <p className="a-warn">{t('bLastFailed', { when: new Date(b.last.at).toLocaleString(), error: b.last.error ?? '' })}</p>}
        {b.files.length ? (
          <ul className="a-backups">
            {b.files.map((f) => (
              <li key={f.name}>
                <span>{new Date(f.at).toLocaleString()}</span>
                <span className="a-hint">{size(f.size)}</span>
                <button className="soft" onClick={() => download(f.name)}>
                  <Icon name="download" size={16} /> {t('bDownload')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <span className="a-hint">{t('bNoFiles')}</span>
        )}
      </div>
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

/** How long ago, like "3 h ago". */
function since(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return min < 2 ? t('devJustNow') : min < 60 ? t('devMinutes', { n: min }) : min < 48 * 60 ? t('devHours', { n: Math.round(min / 60) }) : t('devDays', { n: Math.round(min / 1440) });
}
function ago(iso: string | null): string {
  return iso ? t('devLastSeen', { when: since(iso) }) : t('devNever');
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

type PersonRow = { id: string; email: string | null; name: string; role: 'admin' | 'member'; status: 'invited' | 'pending' | 'active' | 'disabled'; owner: boolean; createdAt: string; lastSeenAt: string | null; inviteExpiresAt: string | null; devices: Device[] };
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

// Inviting from a list: check it (nothing happens yet), then invite the new people in small batches, by email or as
// links, and download the links as CSV. The server does the parsing (server/src/people-import.ts).
type ImportStatus = 'new' | 'account' | 'invited' | 'duplicate' | 'invalid';
type PreviewRow = { line: number; name: string; email: string; status: ImportStatus };
type Preview = { rows: PreviewRow[]; counts: Record<ImportStatus, number>; email: boolean; inviteDays: number };
type Imported = Invite & { name: string };
const IMPORT_KEY: Record<ImportStatus, Key> = { new: 'imNew', account: 'imAccount', invited: 'imInvited', duplicate: 'imDuplicate', invalid: 'imInvalid' };
/** People per request: emails go out one after another, so fewer at a time keeps each request short. */
const BATCH = { email: 10, link: 50 };
/** A failure worth trying again: the email didn't go out, or the request didn't get through (not "has an account"). */
const retryable = (r: Imported) => Boolean(r.error) && (Boolean(r.expiresAt) || !r.personId);

/** A file as text: UTF-8, or else Windows-1252 (what Excel's plain "CSV" is on many computers). */
async function readList(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new Error(t('imXlsx'));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function linksCsv(done: Imported[]) {
  const sep = L === DE ? ';' : ',';
  const stamp = (iso?: string) => (iso ? new Date(iso).toLocaleString(L === DE ? 'de-DE' : 'en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const rows = done.filter((r) => r.link).map((r) => [r.name, r.email, r.link!, stamp(r.expiresAt)]);
  saveFile(`gnomon-invitations-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([t('imCsvHead').split('|'), ...rows], sep), 'text/csv;charset=utf-8');
}

function ImportList({ reload, setErr }: { reload: () => void; setErr: (e: string | null) => void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [show, setShow] = useState<ImportStatus | 'all'>('all');
  const [done, setDone] = useState<Imported[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [by, setBy] = useState<'email' | 'link'>('email');
  useEffect(() => {
    if (!progress) return;
    const warn = (e: BeforeUnloadEvent) => (e.preventDefault(), (e.returnValue = t('imLeave')));
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [Boolean(progress)]);

  const check = async (list = text) => {
    try {
      setErr(null);
      setPreview(await call<Preview>('POST', '/people/import/preview', { text: list }));
      setShow('all');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  /** Invite people batch by batch; results replace earlier ones for the same email (a retry). */
  const invite = async (people: { name: string; email: string }[], how: 'email' | 'link', again: boolean) => {
    setErr(null);
    setBy(how);
    const results = new Map((done ?? []).map((r) => [r.email, r]));
    setProgress({ done: 0, total: people.length });
    for (let i = 0; i < people.length; i += BATCH[how]) {
      const batch = people.slice(i, i + BATCH[how]);
      try {
        const r = await call<{ results: Invite[] }>('POST', '/people/import', { people: batch, by: how, again });
        r.results.forEach((x, j) => results.set(x.email, { ...x, name: batch[j]?.name ?? '' }));
      } catch (e) {
        // Stop here: the rest stays in the list as not done, to try again.
        for (const x of people.slice(i)) results.set(x.email, { email: x.email, name: x.name, sent: false, error: (e as Error).message });
        setErr((e as Error).message);
        break;
      }
      setDone([...results.values()]);
      setProgress({ done: Math.min(i + batch.length, people.length), total: people.length });
    }
    setDone([...results.values()]);
    setProgress(null);
    reload();
  };
  const reset = () => (setText(''), setPreview(null), setDone(null));

  const fresh = preview?.rows.filter((r) => r.status === 'new') ?? [];
  const failed = done?.filter(retryable) ?? [];
  return (
    <div className="a-import">
      {!preview && !done && (
        <>
          <span className="a-hint">{t('imIntro')}</span>
          <textarea rows={6} placeholder={t('imPaste')} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          <div className="a-inline">
            <label className="soft a-file">
              {t('imFile')}
              <input
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  try {
                    const list = await readList(f);
                    setText(list);
                    await check(list);
                  } catch (err) {
                    setErr((err as Error).message);
                  }
                }}
              />
            </label>
            <button className="primary" disabled={!text.trim()} onClick={() => check()}>
              {t('imCheck')}
            </button>
          </div>
        </>
      )}
      {preview && !done && !progress && (
        <>
          <div className="a-chips">
            <button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>
              {t('imAll')} {preview.rows.length}
            </button>
            {(Object.keys(IMPORT_KEY) as ImportStatus[]).filter((k) => preview.counts[k]).map((k) => (
              <button key={k} className={`${show === k ? 'on' : ''} ${k}`} onClick={() => setShow(k)}>
                {t(IMPORT_KEY[k])} {preview.counts[k]}
              </button>
            ))}
          </div>
          <div className="a-import-list">
            <table>
              <thead>
                <tr>
                  <th>{t('imLine')}</th>
                  <th>{t('imName')}</th>
                  <th>{t('pEmail')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {preview.rows.filter((r) => show === 'all' || r.status === show).map((r) => (
                  <tr key={r.line} className={r.status}>
                    <td>{r.line}</td>
                    <td>{r.name || '—'}</td>
                    <td>{r.email || '—'}</td>
                    <td>
                      <span className={`a-status ${r.status}`}>{t(IMPORT_KEY[r.status])}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fresh.length ? <span className="a-hint">{t('imOnlyNew', { n: fresh.length, days: preview.inviteDays })}</span> : <p className="a-warn">{t('imNobody')}</p>}
          <div className="a-inline a-wrap">
            {fresh.length > 0 && preview.email && (
              <button className="primary" onClick={() => invite(fresh, 'email', false)}>
                <Icon name="mail" size={18} /> {t('imSend', { n: fresh.length })}
              </button>
            )}
            {fresh.length > 0 && (
              <button className={preview.email ? 'soft' : 'primary'} onClick={() => invite(fresh, 'link', false)}>
                <Icon name="link" size={18} /> {t(preview.email ? 'imLinks' : 'imLinksOnly', { n: fresh.length })}
              </button>
            )}
            <button className="soft" onClick={() => setPreview(null)}>
              {t('imBack')}
            </button>
          </div>
        </>
      )}
      {progress && (
        <>
          <progress max={progress.total} value={progress.done} />
          <span className="a-hint">
            {t('imProgress', progress)} {t('imKeepOpen')}
          </span>
        </>
      )}
      {done && !progress && (
        <>
          <div className="a-ok">
            <Icon name="check_circle" /> {t('imDone')}{' '}
            {[
              done.filter((r) => r.sent).length && t('imSent', { n: done.filter((r) => r.sent).length }),
              done.filter((r) => r.link).length && t('imMade', { n: done.filter((r) => r.link).length }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {failed.length > 0 && (
            <div className="a-warn">
              <strong>{t('imFailed', { n: failed.length })}</strong>
              <ul>
                {failed.map((r) => (
                  <li key={r.email}>
                    {r.name ? `${r.name} · ` : ''}
                    {r.email}: {r.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {done.some((r) => r.link) && <span className="a-hint">{t('imCsvHint')}</span>}
          <div className="a-inline a-wrap">
            {failed.length > 0 && (
              <button className="primary" onClick={() => invite(failed.map(({ name, email }) => ({ name, email })), by, true)}>
                {t('imRetry')}
              </button>
            )}
            {done.some((r) => r.link) && (
              <button className={failed.length ? 'soft' : 'primary'} onClick={() => linksCsv(done)}>
                <Icon name="download" size={18} /> {t('imCsv')}
              </button>
            )}
            <button className="soft" onClick={reset}>
              {t('imAnother')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** `part`: only the invitation card or only who may register (for the setup page's steps). */
/** Everyone with an account, loaded once per page; every change answers with the new list. */
function usePeople(ctx: Ctx) {
  const [r, setR] = useState<PeopleResponse | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = () => call<PeopleResponse>('GET', '/people').then(setR, (e) => ctx.setErr((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  const run = async (method: string, path: string, body?: unknown) => {
    try {
      ctx.setErr(null);
      setNotice(null);
      const res = await call<PeopleResponse & { invite?: Invite; resetSentTo?: string }>(method, path, body);
      setR(res);
      if (res.invite) setInvite(res.invite);
      if (res.resetSentTo) setNotice(t('pResetSent', { email: res.resetSentTo }));
      call<State>('GET', '/state').then(ctx.setS, () => {});
      return res;
    } catch (e) {
      ctx.setErr((e as Error).message);
      return null;
    }
  };
  return { r, load, run, invite, notice };
}
type PeopleData = ReturnType<typeof usePeople>;

const expiredInvite = (x: PersonRow) => x.status === 'invited' && Boolean(x.inviteExpiresAt) && Date.parse(x.inviteExpiresAt!) < Date.now();
/** What the People list shows and filters by: an expired invitation counts on its own. */
type Shown = PersonRow['status'] | 'expired';
const shownStatus = (x: PersonRow): Shown => (expiredInvite(x) ? 'expired' : x.status);
const SHOWN_KEY: Record<Shown, Key> = { ...STATUS_KEY, expired: 'pExpired' };
const SHOWN_ORDER: Shown[] = ['pending', 'expired', 'invited', 'active', 'disabled'];

function InviteCard({ p, ctx }: { p: PeopleData; ctx: Ctx }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [how, setHow] = useState<'one' | 'list'>('one');
  return (
    <div className="a-card">
      <div className="a-card-head">
        <strong>
          <Icon name="person_add" size={18} /> {t('pInviteTitle')}
        </strong>
        <div className="a-seg">
          <button className={how === 'one' ? 'on' : ''} onClick={() => setHow('one')}>
            {t('pOne')}
          </button>
          <button className={how === 'list' ? 'on' : ''} onClick={() => setHow('list')}>
            {t('pList')}
          </button>
        </div>
      </div>
      <form
        className="a-import"
        hidden={how !== 'one'}
        onSubmit={(e) => {
          e.preventDefault();
          void p.run('POST', '/people', { email, name: name || undefined, role }).then((r) => r && (setEmail(''), setName('')));
        }}
      >
        <span className="a-hint">{t(p.r?.email ? 'pInviteIntroEmail' : 'pInviteIntro')}</span>
        <div className="a-row">
          <input type="email" required placeholder={t('pEmail')} value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder={t('pName')} value={name} onChange={(e) => setName(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
            <option value="member">{t('pMember')}</option>
            <option value="admin">{t('pAdmin')}</option>
          </select>
          <button className="primary">{t('pInvite')}</button>
        </div>
        {p.invite && <InviteBox invite={p.invite} />}
      </form>
      {/* Stays mounted while hidden, so a running import goes on when switching to one person. */}
      <div hidden={how !== 'list'}>
        <ImportList reload={p.load} setErr={ctx.setErr} />
      </div>
    </div>
  );
}

function RegistrationCard({ p }: { p: PeopleData }) {
  const registration = p.r?.registration ?? 'invite';
  const [inviteDays, setInviteDays] = useState(14);
  useEffect(() => {
    if (p.r) setInviteDays(p.r.inviteDays);
  }, [p.r?.inviteDays]);
  return (
    <div className="a-card">
      <strong>{t('pRegTitle')}</strong>
      <div className="a-seg">
        {(['invite', 'approval', 'open'] as const).map((m) => (
          <button key={m} className={registration === m ? 'on' : ''} onClick={() => p.run('PUT', '/registration', { mode: m })}>
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
          onBlur={() => inviteDays >= 1 && inviteDays <= 90 && p.run('PUT', '/registration', { inviteDays: Math.round(inviteDays) })}
        />
        <span>{t('pDays')}</span>
      </label>
    </div>
  );
}

/** The setup wizard's steps "Who may register" and "Invite people". */
function People({ part, ...ctx }: Ctx & { part: 'invite' | 'registration' }) {
  const p = usePeople(ctx);
  return part === 'invite' ? <InviteCard p={p} ctx={ctx} /> : <RegistrationCard p={p} />;
}

/** One person's actions: the ones that fit their status. */
function PersonActions({ x, p, ctx }: { x: PersonRow; p: PeopleData; ctx: Ctx }) {
  const emailOn = Boolean(p.r?.email);
  if (x.id === ctx.s.me.id) return <span className="a-hint">{t('pSelf')}</span>;
  return (
    <div className="a-inline a-person-actions">
      {x.status === 'pending' && (
        <button className="primary" onClick={() => p.run('PATCH', `/people/${x.id}`, { status: 'active' })}>
          {t('pApprove')}
        </button>
      )}
      {x.status === 'invited' && (
        <button className={expiredInvite(x) ? 'primary' : 'soft'} onClick={() => p.run('POST', `/people/${x.id}/invite`)}>
          {t(emailOn ? 'pResend' : 'pReinvite')}
        </button>
      )}
      {x.status === 'active' && x.email && emailOn && (
        <button className="soft" onClick={() => confirm(t('pResetConfirm', { name: x.name })) && p.run('POST', `/people/${x.id}/reset`)}>
          {t('pReset')}
        </button>
      )}
      <button className="soft" onClick={() => p.run('PATCH', `/people/${x.id}`, { role: x.role === 'admin' ? 'member' : 'admin' })}>
        {t(x.role === 'admin' ? 'pMakeMember' : 'pMakeAdmin')}
      </button>
      {x.status === 'active' && (
        <button className="soft" onClick={() => confirm(t('pDisableConfirm', { name: x.name })) && p.run('PATCH', `/people/${x.id}`, { status: 'disabled' })}>
          {t('pDisable')}
        </button>
      )}
      {x.status === 'disabled' && (
        <button className="soft" onClick={() => p.run('PATCH', `/people/${x.id}`, { status: 'active' })}>
          {t('pEnable')}
        </button>
      )}
      {!x.owner && (
        <button className="soft danger" onClick={() => confirm(t('pRemoveConfirm', { name: x.name })) && p.run('DELETE', `/people/${x.id}`)}>
          {t(x.status === 'pending' ? 'pDecline' : 'pRemove')}
        </button>
      )}
    </div>
  );
}

/** Last seen for people with an account, the invitation's end for invited ones. */
function seenText(x: PersonRow) {
  if (x.status === 'pending') return t('pAsked', { date: day(x.createdAt) });
  if (x.status === 'invited') return x.inviteExpiresAt ? t(expiredInvite(x) ? 'pExpiredOn' : 'pUntil', { date: day(x.inviteExpiresAt) }) : '—';
  return x.lastSeenAt ? since(x.lastSeenAt) : '—';
}

type Sort = 'name' | 'status' | 'seen';

/** Everyone, searchable and sortable, one line each; a click opens their devices and actions. */
function PeopleList({ ctx, filter: initial }: { ctx: Ctx; filter?: string }) {
  const p = usePeople(ctx);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Shown | 'all'>(SHOWN_ORDER.includes(initial as Shown) ? (initial as Shown) : 'all');
  const [sort, setSort] = useState<{ by: Sort; up: boolean }>({ by: 'name', up: true });
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setFilter(SHOWN_ORDER.includes(initial as Shown) ? (initial as Shown) : 'all'), [initial]);
  const people = p.r?.people ?? [];
  const counts = Object.fromEntries(SHOWN_ORDER.map((k) => [k, people.filter((x) => shownStatus(x) === k).length])) as Record<Shown, number>;
  const needle = q.trim().toLowerCase();
  const seen = (x: PersonRow) => Date.parse((x.status === 'invited' ? x.inviteExpiresAt : x.lastSeenAt) ?? '') || 0;
  const rows = people
    .filter((x) => (filter === 'all' || shownStatus(x) === filter) && (!needle || `${x.name} ${x.email ?? ''}`.toLowerCase().includes(needle)))
    .sort((a, b) => {
      const d =
        sort.by === 'status'
          ? SHOWN_ORDER.indexOf(shownStatus(a)) - SHOWN_ORDER.indexOf(shownStatus(b))
          : sort.by === 'seen'
            ? seen(b) - seen(a)
            : 0;
      return (sort.up ? 1 : -1) * (d || a.name.localeCompare(b.name));
    });
  const head = (by: Sort, label: Key, className?: string) => (
    <th className={className}>
      <button className={`a-sort ${sort.by === by ? 'on' : ''}`} onClick={() => setSort({ by, up: sort.by === by ? !sort.up : true })}>
        {t(label)}
        {sort.by === by && <Icon name={sort.up ? 'arrow_upward' : 'arrow_downward'} size={14} />}
      </button>
    </th>
  );
  return (
    <>
      <div className="a-toolbar">
        <label className="a-search">
          <Icon name="search" size={18} />
          <input type="search" placeholder={t('pSearch')} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <a className="primary a-button" href="#invitations">
          <Icon name="person_add" size={18} /> {t('pInviteTitle')}
        </a>
      </div>
      <div className="a-chips">
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          {t('imAll')} {people.length}
        </button>
        {SHOWN_ORDER.filter((k) => counts[k] || filter === k).map((k) => (
          <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
            {t(SHOWN_KEY[k])} {counts[k]}
          </button>
        ))}
      </div>
      {p.notice && (
        <div className="a-ok">
          <Icon name="mail" /> {p.notice}
        </div>
      )}
      {p.invite && <InviteBox invite={p.invite} />}
      <table className="a-table">
        <thead>
          <tr>
            {head('name', 'imName')}
            {head('status', 'pStatus')}
            {head('seen', 'pSeen', 'a-wide')}
            <th aria-label={t('pActions')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const st = shownStatus(x);
            const isOpen = open === x.id;
            return (
              <Fragment key={x.id}>
                <tr className={`a-prow ${st} ${isOpen ? 'open' : ''}`} onClick={() => setOpen(isOpen ? null : x.id)}>
                  <td>
                    <strong>{x.name}</strong>
                    {x.role === 'admin' && <span className="a-tag">{t('pAdmin')}</span>}
                    {x.id === ctx.s.me.id && <span className="a-tag">{t('pYou')}</span>}
                    <span className="a-hint a-email">{x.email ?? '—'}</span>
                  </td>
                  <td>
                    <span className={`a-chip ${st}`}>{t(SHOWN_KEY[st])}</span>
                  </td>
                  <td className="a-wide a-hint">{seenText(x)}</td>
                  <td className="a-row-end" onClick={(e) => e.stopPropagation()}>
                    {x.status === 'pending' && (
                      <button className="primary a-small" onClick={() => p.run('PATCH', `/people/${x.id}`, { status: 'active' })}>
                        {t('pApprove')}
                      </button>
                    )}
                    {st === 'expired' && (
                      <button className="soft a-small" onClick={() => p.run('POST', `/people/${x.id}/invite`)}>
                        {t('pResendShort')}
                      </button>
                    )}
                    <button className={`a-more ${isOpen ? 'open' : ''}`} aria-label={t('pDetails')} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : x.id)}>
                      <Icon name="chevron_right" size={20} />
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="a-pdetail">
                    <td colSpan={4}>
                      <span className="a-label">{t('devicesTitle')}</span>
                      {x.devices.length ? (
                        <ul className="a-devices">
                          {x.devices.map((d) => (
                            <DeviceRow key={d.id} d={d} reload={p.load} setErr={ctx.setErr} />
                          ))}
                        </ul>
                      ) : (
                        <span className="a-hint">{t(x.status === 'active' ? 'pNoDevices' : 'pNoDevicesYet')}</span>
                      )}
                      <PersonActions x={x} p={p} ctx={ctx} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {p.r && !rows.length && <p className="a-hint">{t('pNoMatch')}</p>}
    </>
  );
}

/** People → Invitations and approvals: the invite card, then everyone still waiting for something. */
function Invitations(ctx: Ctx) {
  const p = usePeople(ctx);
  const [busy, setBusy] = useState<string | null>(null);
  // Links made by "Resend all" without email: every one of them, for the CSV (the invite box shows only the last).
  const [links, setLinks] = useState<Imported[]>([]);
  const people = p.r?.people ?? [];
  const pending = people.filter((x) => x.status === 'pending');
  const expired = people.filter(expiredInvite);
  const open = people.filter((x) => x.status === 'invited' && !expiredInvite(x)).sort((a, b) => (a.inviteExpiresAt ?? '').localeCompare(b.inviteExpiresAt ?? ''));
  const resendAll = async () => {
    // One after another, like the list import, so a slow mail server never times out a big request.
    const made: Imported[] = [];
    for (const [i, x] of expired.entries()) {
      setBusy(t('pResending', { done: i, total: expired.length }));
      const r = await p.run('POST', `/people/${x.id}/invite`);
      if (!r) break;
      if (r.invite?.link && !r.invite.sent) made.push({ ...r.invite, name: x.name });
    }
    setLinks(made);
    setBusy(null);
  };
  const line = (x: PersonRow, action: ReactNode) => (
    <li key={x.id} className="a-qline">
      <span className="a-qname">
        <strong>{x.name}</strong>
        <span className="a-hint">{x.email}</span>
      </span>
      <span className="a-hint">{seenText(x)}</span>
      {action}
    </li>
  );
  return (
    <>
      <InviteCard p={p} ctx={ctx} />
      {p.notice && <div className="a-ok">{p.notice}</div>}
      {links.length > 1 && (
        <div className="a-card a-update">
          <strong>{t('imMade', { n: links.length })}</strong>
          <span className="a-hint">{t('imCsvHint')}</span>
          <button className="primary a-save" onClick={() => linksCsv(links)}>
            <Icon name="download" size={18} /> {t('imCsv')}
          </button>
        </div>
      )}
      {pending.length > 0 && (
        <section className="a-sub">
          <h3>
            {t('pPending')} <span className="a-count">{pending.length}</span>
          </h3>
          <span className="a-hint">{t('pPendingHint')}</span>
          <ul className="a-queue">
            {pending.map((x) =>
              line(
                x,
                <span className="a-inline">
                  <button className="primary a-small" onClick={() => p.run('PATCH', `/people/${x.id}`, { status: 'active' })}>
                    {t('pApprove')}
                  </button>
                  <button className="soft a-small danger" onClick={() => confirm(t('pDeclineConfirm', { name: x.name })) && p.run('DELETE', `/people/${x.id}`)}>
                    {t('pDecline')}
                  </button>
                </span>,
              ),
            )}
          </ul>
        </section>
      )}
      {expired.length > 0 && (
        <section className="a-sub">
          <div className="a-card-head">
            <h3>
              {t('pExpiredTitle')} <span className="a-count">{expired.length}</span>
            </h3>
            {expired.length > 1 && (
              <button className="soft" disabled={Boolean(busy)} onClick={resendAll}>
                {busy ?? t(p.r?.email ? 'pResendAll' : 'pReinviteAll', { n: expired.length })}
              </button>
            )}
          </div>
          <ul className="a-queue">
            {expired.map((x) =>
              line(
                x,
                <button className="soft a-small" onClick={() => p.run('POST', `/people/${x.id}/invite`)}>
                  {t('pResendShort')}
                </button>,
              ),
            )}
          </ul>
        </section>
      )}
      {open.length > 0 && (
        <section className="a-sub">
          <h3>
            {t('pOpenTitle')} <span className="a-count">{open.length}</span>
          </h3>
          <ul className="a-queue">
            {open.map((x) =>
              line(
                x,
                <button className="soft a-small" onClick={() => p.run('POST', `/people/${x.id}/invite`)}>
                  {t('pResendShort')}
                </button>,
              ),
            )}
          </ul>
        </section>
      )}
      {p.r && !pending.length && !expired.length && !open.length && <p className="a-hint">{t('pNothingOpen')}</p>}
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

// ---- The Admin page after the setup: an overview, then pages grouped by People, Inbox, Company and Server ----------

type Attention = { code: string; n?: number; at?: string; error?: string; version?: string; files?: string[] };
type Overview = {
  counts: { active: number; invited: number; expired: number; pending: number; disabled: number; admins: number; devices: number };
  attention: Attention[];
  health: {
    version: string;
    update: { version: string; date: string | null } | null;
    https: string | null;
    keySource: 'env' | 'file';
    email: { ready: boolean; provider: 'smtp' | 'graph' | null; tested: string | null };
    backups: { enabled: boolean; hour: number; keySet: boolean; last: { at: string; ok: boolean; error?: string } | null; newest: string | null; count: number } | null;
    disk: { free: number; total: number } | null;
    encryption: null | { encrypted: boolean; keySource: 'env' | 'file' | null; plainCopies: string[] };
    startedAt: string;
  };
};

const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e11 ? 0 : 1)} GB` : `${Math.round(n / 1e6)} MB`);
const RELEASES = 'https://github.com/DennHa/gnomon/releases';

/** What each attention item says, where its button goes (a page here, or the admin guide), and what the button says. */
const ATTENTION: Record<string, [IconName, Key, Key, string]> = {
  notEncrypted: ['lock', 'atNotEncrypted', 'atHowTo', `${GUIDE}#encryption-at-rest`],
  plainCopies: ['delete', 'atPlainCopies', 'atHowTo', `${GUIDE}#encryption-at-rest`],
  pending: ['how_to_reg', 'atPending', 'atReview', 'invitations'],
  invitesExpired: ['schedule', 'atExpired', 'atResend', 'invitations'],
  emailMissing: ['mail', 'atEmail', 'atSetUp', 'email'],
  addressMissing: ['language', 'atAddress', 'atSetUp', 'company'],
  backupNoPassword: ['backup', 'atBackupKey', 'atSetUp', 'backups'],
  backupFailed: ['warning', 'atBackupFailed', 'atOpen', 'backups'],
  backupsOff: ['backup', 'atBackupsOff', 'atOpen', 'backups'],
  backupOld: ['backup', 'atBackupOld', 'atOpen', 'backups'],
  diskLow: ['hard_drive', 'atDisk', 'atOpen', 'health'],
  update: ['update', 'atUpdate', 'atHowUpdate', 'health'],
  adminPassword: ['lock', 'atPassword', 'atSetUp', 'account'],
  feedback: ['forum', 'atFeedback', 'atRead', 'feedback'],
};

function useOverview(ctx: Ctx) {
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => {
    call<Overview>('GET', '/overview').then(setO, (e) => ctx.setErr((e as Error).message));
  }, []);
  return o;
}

/** One line of the server's health: a dot (fine, needs a look, or nothing to say), a label and what's true. */
function HealthRow({ label, value, state }: { label: Key; value: ReactNode; state: 'ok' | 'warn' | 'off' }) {
  return (
    <div className="a-health-row">
      <span className={`a-dot ${state}`} />
      <dt>{t(label)}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function healthRows(o: Overview, s: State): ReactNode[] {
  const h = o.health;
  const b = h.backups;
  const diskLow = h.disk && (h.disk.free < 1e9 || h.disk.free / h.disk.total < 0.05);
  return [
    <HealthRow key="v" label="hVersion" state={h.update ? 'warn' : 'ok'} value={h.update ? t('hUpdate', { v: h.version, new: h.update.version }) : t('hCurrent', { v: h.version })} />,
    <HealthRow
      key="b"
      label="sBackups"
      state={!b || !b.keySet || !b.enabled || (b.last && !b.last.ok) ? 'warn' : 'ok'}
      value={!b ? '—' : !b.keySet ? t('hNoKey') : b.last && !b.last.ok ? t('hBackupFailed', { when: since(b.last.at) }) : !b.enabled ? t('wBackupsOff') : b.newest ? t('hBackupLast', { when: since(b.newest), hour: String(b.hour).padStart(2, '0') }) : t('hBackupNone', { hour: String(b.hour).padStart(2, '0') })}
    />,
    <HealthRow key="d" label="hDisk" state={!h.disk ? 'off' : diskLow ? 'warn' : 'ok'} value={h.disk ? t('hDiskFree', { free: gb(h.disk.free), total: gb(h.disk.total) }) : '—'} />,
    <HealthRow
      key="e"
      label="sEmail"
      state={h.email.ready ? 'ok' : 'warn'}
      value={h.email.ready ? `${h.email.provider === 'graph' ? t('emailGraph') : t('emailSmtp')} · ${h.email.tested ? t('hTested', { when: since(h.email.tested) }) : t('hUntested')}` : t('hEmailOff')}
    />,
    <HealthRow key="h" label="wHttps" state={h.https === 'local' ? 'warn' : 'ok'} value={t((h.https && HTTPS_TEXT[h.https]) || 'httpsManual')} />,
    <HealthRow
      key="x"
      label="hEncryption"
      state={!h.encryption ? 'off' : h.encryption.encrypted && !h.encryption.plainCopies.length ? 'ok' : 'warn'}
      value={
        !h.encryption
          ? '—'
          : [h.encryption.encrypted ? t('hEncOn', { key: h.encryption.keySource === 'file' ? 'GNOMON_DATA_KEY_FILE' : 'GNOMON_DATA_KEY' }) : t('hEncOff'), h.encryption.plainCopies.length ? t(h.encryption.plainCopies.length === 1 ? 'hEncCopy' : 'hEncCopies', { n: h.encryption.plainCopies.length }) : ''].filter(Boolean).join(' · ')
      }
    />,
    <HealthRow key="k" label="sKey" state={s.keySource === 'env' ? 'ok' : 'off'} value={t(s.keySource === 'env' ? 'keyEnv' : 'keyFileShort')} />,
  ];
}

function OverviewPage(ctx: Ctx) {
  const o = useOverview(ctx);
  if (!o) return <p className="a-hint">{t('loading')}</p>;
  const c = o.counts;
  const tiles: [Key, number, string, string?][] = [
    ['pActive', c.active, 'people/active'],
    ['pInvited', c.invited + c.expired, 'people/invited', c.expired ? t('oExpired', { n: c.expired }) : undefined],
    ['pPending', c.pending, 'people/pending'],
    ['pDisabled', c.disabled, 'people/disabled'],
  ];
  return (
    <>
      <div className="a-tiles">
        {tiles.map(([label, n, href, sub]) => (
          <a key={label} className={`a-tile ${label === 'pPending' && n ? 'hot' : ''}`} href={`#${href}`}>
            <span className="a-hint">{t(label)}</span>
            <strong>{n}</strong>
            {sub && <span className="a-tile-sub">{sub}</span>}
          </a>
        ))}
      </div>
      <section className="a-card">
        <strong>{t('oAttention')}</strong>
        {o.attention.length ? (
          <ul className="a-attention">
            {o.attention.map((a) => {
              const [icon, many, button, href] = ATTENTION[a.code] ?? ['warning', 'atUnknown', 'atOpen', 'health'];
              const text = a.code === 'plainCopies' && a.n === 1 ? 'atPlainCopy' : many;
              return (
                <li key={a.code}>
                  <Icon name={icon} size={20} />
                  <span>
                    {t(text, { n: a.n ?? '', v: a.version ?? '', current: o.health.version, when: a.at ? since(a.at) : '', error: a.error ?? '' })}
                    {a.files && (
                      <span className="a-files">
                        {a.files.slice(0, 3).map((f) => (
                          <code key={f}>{f}</code>
                        ))}
                        {a.files.length > 3 && <span className="a-hint">{t('atMore', { n: a.files.length - 3 })}</span>}
                      </span>
                    )}
                  </span>
                  {/^https:/.test(href) ? (
                    <a className="soft a-button a-small" href={href} target="_blank" rel="noreferrer">
                      {t(button)} <Icon name="open_in_new" size={14} />
                    </a>
                  ) : (
                    <a className="soft a-button a-small" href={`#${href}`}>
                      {t(button)}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="a-ok">
            <Icon name="check_circle" /> {t('oAllGood')}
          </div>
        )}
      </section>
      <section className="a-card">
        <div className="a-card-head">
          <strong>{t('oServer')}</strong>
          <a href="#health">{t('oDetails')}</a>
        </div>
        <dl className="a-health">{healthRows(o, ctx.s)}</dl>
      </section>
    </>
  );
}

function HealthPage(ctx: Ctx & { rerun: () => void }) {
  const o = useOverview(ctx);
  const [cleaned, setCleaned] = useState<string | null>(null);
  if (!o) return <p className="a-hint">{t('loading')}</p>;
  const h = o.health;
  return (
    <>
      {h.update && (
        <div className="a-card a-update">
          <strong>
            <Icon name="update" size={18} /> {t('hUpdateTitle', { v: h.update.version })}
          </strong>
          <span className="a-hint">{t('hUpdateHow')}</span>
          <code className="a-cmd">sudo gnomon-admin update</code>
          <a href={`${RELEASES}/tag/v${h.update.version}`} target="_blank" rel="noreferrer">
            {t('hWhatsNew')} <Icon name="open_in_new" size={14} />
          </a>
        </div>
      )}
      <section className="a-card">
        <dl className="a-health">
          {healthRows(o, ctx.s)}
          <HealthRow label="hRunning" state="off" value={t('hSince', { when: new Date(h.startedAt).toLocaleString() })} />
          <HealthRow label="devicesTitle" state="off" value={t('hDevices', { n: o.counts.devices })} />
        </dl>
        <div className="a-inline a-cleanup-row">
          <button
            className="soft a-small"
            onClick={async () => {
              try {
                const r = await call<{ removed: number }>('POST', '/devices/cleanup');
                setCleaned(t('devCleaned', { n: r.removed }));
              } catch (e) {
                ctx.setErr((e as Error).message);
              }
            }}
          >
            {t('hCleanup')}
          </button>
          <span className="a-hint">{cleaned ?? t('devCleanupHint')}</span>
        </div>
      </section>
      {ctx.s.config.audit.length > 0 && (
        <section className="a-card">
          <strong>{t('history')}</strong>
          <ul className="a-audit">
            {ctx.s.config.audit.map((a) => (
              <li key={a.at + a.what}>
                <span className="a-hint">{new Date(a.at).toLocaleString()}</span> {a.what}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="a-card">
        <strong>{t('rerunSetup')}</strong>
        <span className="a-hint">{t('rerunHint')}</span>
        <button className="soft a-save" onClick={ctx.rerun}>
          <Icon name="rocket_launch" size={18} /> {t('rerunSetup')}
        </button>
      </section>
    </>
  );
}

/** A page made of several setup steps, each under its own heading. */
const parts = (ctx: Ctx, list: [Key, (c: Ctx) => ReactNode][]) => (
  <>
    {list.map(([title, view]) => (
      <section key={title} className="a-sub">
        <h3>{t(title)}</h3>
        {view(ctx)}
      </section>
    ))}
  </>
);

type Page = { key: string; title: Key; icon: IconName; view: (c: Ctx & { sub: string; rerun: () => void }) => ReactNode; badge?: (s: State) => number };
const ADMIN_NAV: { group?: Key; pages: Page[] }[] = [
  { pages: [{ key: 'overview', title: 'overviewTitle', icon: 'home', view: (c) => <OverviewPage {...c} /> }] },
  {
    group: 'peopleTitle',
    pages: [
      { key: 'people', title: 'peopleTitle', icon: 'group', view: (c) => <PeopleList ctx={c} filter={c.sub} /> },
      { key: 'invitations', title: 'invitationsTitle', icon: 'person_add', view: (c) => <Invitations {...c} />, badge: (s) => s.pending },
      { key: 'signup', title: 'signupTitle', icon: 'how_to_reg', view: (c) => <><p className="a-intro">{t('regStepIntro')}</p><People {...c} part="registration" /></> },
    ],
  },
  { group: 'inboxGroup', pages: [{ key: 'feedback', title: 'fbTitle', icon: 'forum', view: (c) => <Feedback {...c} />, badge: (s) => s.feedbackUnread }] },
  {
    group: 'companyGroup',
    pages: [
      { key: 'company', title: 'companyDetails', icon: 'apartment', view: (c) => <CompanyStep {...c} /> },
      { key: 'hours', title: 'hoursTitle', icon: 'target', view: (c) => <HoursStep {...c} /> },
      { key: 'macapp', title: 'macRollout', icon: 'laptop_mac', view: (c) => parts(c, [['macTitle', (x) => <MacAppStep {...x} />], ['rulesTitle', (x) => <RulesStep {...x} />], ['rolloutTitle', (x) => <Rollout {...x} />]]) },
      { key: 'integrations', title: 'integrationsTitle', icon: 'extension', view: (c) => parts(c, [['floatTitle', (x) => <FloatStep {...x} />], ['personioTitle', (x) => <PersonioStep {...x} />]]) },
    ],
  },
  {
    group: 'serverGroup',
    pages: [
      { key: 'health', title: 'healthTitle', icon: 'monitor_heart', view: (c) => <HealthPage {...c} /> },
      { key: 'email', title: 'emailTitle', icon: 'mail', view: (c) => <EmailStep {...c} /> },
      { key: 'backups', title: 'backupsTitle', icon: 'backup', view: (c) => <BackupsStep {...c} /> },
    ],
  },
];
// Your own admin password: from the menu under your name, not the side menu.
const ACCOUNT_PAGE: Page = { key: 'account', title: 'accountTitle', icon: 'lock', view: (c) => <Account {...c} /> };
const ADMIN_PAGES = [...ADMIN_NAV.flatMap((g) => g.pages), ACCOUNT_PAGE];

/** The page in the address (#people/pending → people, pending), so reloading and links keep the place. */
const route = () => {
  const [key, sub = ''] = location.hash.slice(1).split('/');
  return { key: ADMIN_PAGES.some((x) => x.key === key) ? key : 'overview', sub };
};

function AdminShell({ ctx, rerun }: { ctx: Ctx; rerun: () => void }) {
  const { s, err, setErr } = ctx;
  const [at, setAt] = useState(route);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const on = () => (setAt(route()), setErr(null), setMenu(false), window.scrollTo(0, 0));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !(e.target as Element).closest('.a-me') && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  // Badges and the overview stay current when coming back to a page.
  useEffect(() => {
    call<State>('GET', '/state').then(ctx.setS, () => {});
  }, [at.key]);
  const cur = ADMIN_PAGES.find((x) => x.key === at.key)!;
  return (
    <main className="a-page">
      <header className="a-head">
        <img src="/icon-192.png" alt="" width={44} height={44} />
        <div>
          <h1>{t('adminTitle')}</h1>
          <span className="a-hint">{s.config.company.name || s.config.company.publicUrl || location.host}</span>
        </div>
        <div className="a-me">
          <button className="soft" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Icon name="account_circle" size={20} /> <span className="a-me-name">{s.me.name}</span>
          </button>
          {menu && (
            <div className="a-menu" role="menu">
              <span className="a-hint">{s.me.email}</span>
              <a role="menuitem" href="#account">
                <Icon name="lock" size={18} /> {t('accountTitle')}
              </a>
              <a role="menuitem" href="/account">
                <Icon name="person" size={18} /> {t('ownAccount')}
              </a>
              <button
                role="menuitem"
                onClick={async () => {
                  await call('DELETE', '/session').catch(() => {});
                  keepToken('');
                  location.replace('/admin');
                }}
              >
                <Icon name="logout" size={18} /> {t('signOut')}
              </button>
            </div>
          )}
        </div>
      </header>
      {!s.me.email && <OwnerPrompt s={s} setS={ctx.setS} />}
      <div className="a-body">
        <nav className="a-steps">
          {ADMIN_NAV.map((g, i) => (
            <Fragment key={i}>
              {g.group && <span className="a-group">{t(g.group)}</span>}
              {g.pages.map((pg) => {
                const n = pg.badge?.(s) ?? 0;
                return (
                  <a key={pg.key} className={`a-step ${pg.key === at.key ? 'on' : ''}`} href={`#${pg.key}`} aria-current={pg.key === at.key ? 'page' : undefined}>
                    <span className="a-num">
                      <Icon name={pg.icon} size={14} />
                    </span>
                    {t(pg.title)}
                    {n > 0 && <span className="a-badge">{n}</span>}
                  </a>
                );
              })}
            </Fragment>
          ))}
        </nav>
        <section className="a-panel">
          <h2>
            <Icon name={cur.icon} size={24} /> {t(cur.title)}
          </h2>
          {err && (
            <p className="a-error">
              <Icon name="warning" size={18} /> {err}
            </p>
          )}
          {/* Keyed by page, so each page loads fresh when opened. */}
          <Fragment key={at.key}>{cur.view({ ...ctx, sub: at.sub, rerun })}</Fragment>
        </section>
      </div>
    </main>
  );
}

// ---- App ------------------------------------------------------------------------------------------

type Section = { key: string; title: Key; icon: IconName; view: (ctx: Ctx) => ReactNode };
const PEOPLE: Section = { key: 'people', title: 'peopleTitle', icon: 'group', view: (c) => <PeopleList ctx={c} /> };
const FEEDBACK: Section = { key: 'feedback', title: 'fbTitle', icon: 'forum', view: (c) => <Feedback {...c} /> };
const ACCOUNT: Section = { key: 'account', title: 'accountTitle', icon: 'lock', view: (c) => <Account {...c} /> };
/** After the setup, these steps are Settings pages of their own (the others only make sense in the wizard). */
const SETTINGS_KEYS = ['company', 'email', 'macapp', 'backups', 'float', 'personio', 'rules', 'rollout', 'done'];
const STEPS: Section[] = [
  { key: 'welcome', title: 'welcomeTitle', icon: 'rocket_launch', view: (c) => <Welcome {...c} /> },
  { key: 'admin', title: 'accountStepTitle', icon: 'admin_panel_settings', view: (c) => <AccountStep {...c} /> },
  { key: 'company', title: 'companyTitle', icon: 'apartment', view: (c) => <CompanyStep {...c} /> },
  { key: 'email', title: 'emailTitle', icon: 'mail', view: (c) => <EmailStep {...c} /> },
  { key: 'registration', title: 'regStepTitle', icon: 'how_to_reg', view: (c) => (<><p className="a-intro">{t('regStepIntro')}</p><People {...c} part="registration" /></>) },
  { key: 'macapp', title: 'macTitle', icon: 'laptop_mac', view: (c) => <MacAppStep {...c} /> },
  { key: 'backups', title: 'backupsTitle', icon: 'backup', view: (c) => <BackupsStep {...c} /> },
  { key: 'float', title: 'floatTitle', icon: 'link', view: (c) => <FloatStep {...c} /> },
  { key: 'personio', title: 'personioTitle', icon: 'link', view: (c) => <PersonioStep {...c} /> },
  { key: 'rules', title: 'rulesTitle', icon: 'lock', view: (c) => <RulesStep {...c} /> },
  { key: 'rollout', title: 'rolloutTitle', icon: 'download', view: (c) => <Rollout {...c} /> },
  { key: 'invite', title: 'inviteStepTitle', icon: 'group', view: (c) => (<><p className="a-intro">{t('inviteStepIntro')}</p><People {...c} part="invite" /></>) },
  { key: 'done', title: 'doneTitle', icon: 'check_circle', view: (c) => <Done {...c} /> },
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

  // After the setup, the Admin page has its own layout (AdminShell); the wizard can be run again from Health.
  if (admin && s.config.setupDone && !wizard) return <AdminShell ctx={{ s, setS, err, setErr }} rerun={() => (setWizard(true), setStep(3), setErr(null), history.replaceState(null, '', location.pathname))} />;

  // The setup wizard on the Admin page: Manage (everyday: devices, feedback, account), then either the setup wizard (numbered steps, until
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
              <button
                className="primary"
                onClick={() => (cur.key === 'admin' && !(s.passwordSet && s.me.email) ? setErr(t('accountRequired')) : (setStep(step + 1), setErr(null)))}
              >
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
