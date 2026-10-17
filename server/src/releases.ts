// The download page for the Mac app: /latest (a short page), /latest/version.json (what the app's update check reads)
// and /latest/download (the .dmg). Optional: only when GNOMON_RELEASES_DIR points at a folder with version.json and the
// .dmg it names (made by `npm run release:manifest` in the app). Anyone who can reach the server can download the app,
// so put it behind your own access control if it shouldn't be public. Read on every request, so replacing the files
// publishes a new version without a restart.
import fs from 'node:fs';
import path from 'node:path';

export type Release = { version: string; date?: string; notes: string[]; file: string; size: number };

export function readRelease(dir?: string): Release | null {
  if (!dir) return null;
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8'));
    if (typeof v.version !== 'string' || !/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(v.version)) return null;
    // Only a plain file name in that folder, never a path.
    if (typeof v.file !== 'string' || v.file !== path.basename(v.file) || !/\.dmg$/i.test(v.file)) return null;
    const stat = fs.statSync(path.join(dir, v.file));
    if (!stat.isFile()) return null;
    return {
      version: v.version,
      date: typeof v.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : undefined,
      notes: Array.isArray(v.notes) ? v.notes.filter((n: unknown) => typeof n === 'string').slice(0, 20) : [],
      file: v.file,
      size: stat.size,
    };
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const TEXT = {
  en: {
    title: 'Download Gnomon',
    tagline: 'A calm work-hour tracker for your Mac.',
    version: 'Version {v}',
    download: 'Download for Mac',
    needs: 'macOS on Apple silicon (M1 or newer) · {size}',
    news: 'What’s new',
    install: 'Install',
    steps: [
      'Open the downloaded .dmg and drag <strong>Gnomon</strong> into <strong>Applications</strong>.',
      'First start: <strong>right-click Gnomon → Open</strong> and confirm. The app isn’t signed with an Apple Developer ID yet, so macOS asks once.',
      'Updating later: download the new version and drag it over the old one. Your data stays where it is.',
    ],
    phone: 'On your phone? Open the web app',
    none: 'No version has been published on this server yet.',
  },
  de: {
    title: 'Gnomon herunterladen',
    tagline: 'Die entspannte Arbeitszeiterfassung für deinen Mac.',
    version: 'Version {v}',
    download: 'Für Mac herunterladen',
    needs: 'macOS auf Apple Silicon (M1 oder neuer) · {size}',
    news: 'Was ist neu',
    install: 'Installieren',
    steps: [
      'Öffne die geladene .dmg und zieh <strong>Gnomon</strong> in <strong>Programme</strong>.',
      'Erster Start: <strong>Rechtsklick auf Gnomon → Öffnen</strong> und bestätigen. Die App ist noch nicht mit einer Apple-Developer-ID signiert, deshalb fragt macOS einmal nach.',
      'Später aktualisieren: neue Version laden und über die alte ziehen. Deine Daten bleiben, wo sie sind.',
    ],
    phone: 'Am Handy? Zur Web-App',
    none: 'Auf diesem Server wurde noch keine Version veröffentlicht.',
  },
};

export const pickLang = (acceptLanguage?: string) => (/^de\b/i.test((acceptLanguage ?? '').trim()) ? 'de' : 'en');

export function releasePage(r: Release | null, lang: 'en' | 'de'): string {
  const x = TEXT[lang];
  const mb = r ? `${Math.round(r.size / 1_000_000)} MB` : '';
  const body = r
    ? `<p class="muted">${esc(x.version.replace('{v}', r.version))}${r.date ? ` · ${esc(r.date)}` : ''}</p>
      <a class="download" href="/latest/download">${esc(x.download)}</a>
      <p class="muted small">${esc(x.needs.replace('{size}', mb))}</p>
      ${r.notes.length ? `<h2>${esc(x.news)}</h2><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <h2>${esc(x.install)}</h2><ol>${x.steps.map((s) => `<li>${s}</li>`).join('')}</ol>`
    : `<p class="muted">${esc(x.none)}</p>`;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(x.title)}</title>
<link rel="icon" href="/icon-192.png">
<link rel="stylesheet" href="/latest.css">
</head>
<body>
<main>
  <img src="/icon-192.png" alt="" width="96" height="96">
  <h1>Gnomon</h1>
  <p class="tagline">${esc(x.tagline)}</p>
  ${body}
  <p class="small"><a href="/">${esc(x.phone)}</a></p>
</main>
</body>
</html>`;
}
