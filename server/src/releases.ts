// The download page for the Mac app: /latest (a short page), /latest/version.json (what the app's update check reads)
// and /latest/download (the .dmg). Where the app comes from, in this order:
//   1. GNOMON_RELEASES_DIR: a folder with version.json and the .dmg it names (made by `npm run release:manifest`),
//   2. an upload on the setup page (Mac app → "Upload your own"), kept in the data folder's releases/,
//   3. the official release on GitHub (the default): the page and version.json come from GitHub's latest release, and
//      the download goes straight there.
// Anyone who can reach the server can see the page and download the app (it holds no data or secrets). Folders are read
// on every request, so replacing the files publishes a new version without a restart.
import fs from 'node:fs';
import path from 'node:path';

/** `url`: where the .dmg is downloaded from when it isn't a file on this server (the GitHub release). */
export type Release = { version: string; date?: string; notes: string[]; file: string; size: number; url?: string };

export const OFFICIAL_REPO = () => process.env.GNOMON_RELEASES_REPO?.trim() || 'DennHa/gnomon';
const GITHUB_API = () => process.env.GNOMON_GITHUB_API?.trim() || 'https://api.github.com';

let gh: { at: number; release: Release | null } | undefined;
let ghPending: Promise<Release | null> | undefined;

/**
 * The latest official release from GitHub, cached for an hour (GitHub allows 60 unauthenticated requests an hour); after
 * a failed request the last good answer is kept and asked again after 5 minutes.
 */
export async function githubRelease(): Promise<Release | null> {
  if (gh && Date.now() - gh.at < (gh.release ? 3_600_000 : 300_000)) return gh.release;
  ghPending ??= (async () => {
    try {
      const res = await fetch(`${GITHUB_API()}/repos/${OFFICIAL_REPO()}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Gnomon server' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const r = (await res.json()) as { tag_name?: string; published_at?: string; body?: string; assets?: { name: string; size: number; browser_download_url: string }[] };
      const version = String(r.tag_name ?? '').replace(/^v/, '');
      const dmg = r.assets?.find((a) => /\.dmg$/i.test(a.name) && /^https:\/\//.test(a.browser_download_url));
      const release: Release | null =
        /^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(version) && dmg
          ? {
              version,
              date: r.published_at?.slice(0, 10),
              notes: String(r.body ?? '')
                .split(/\r?\n/)
                .filter((l) => /^\s*[-*] /.test(l))
                .map((l) => l.replace(/^\s*[-*] /, '').replace(/\*\*|`/g, '').trim())
                .slice(0, 20),
              file: dmg.name,
              size: dmg.size,
              url: dmg.browser_download_url,
            }
          : null;
      gh = { at: Date.now(), release };
    } catch {
      gh = { at: Date.now() - 3_300_000, release: gh?.release ?? null };
    }
    return gh.release;
  })().finally(() => (ghPending = undefined));
  return ghPending;
}

/** The cached GitHub answer without asking GitHub (for the Admin page's state). */
export const peekGithubRelease = (): Release | null => gh?.release ?? null;

/** For tests: forget the cached GitHub answer. */
export const forgetGithubRelease = () => (gh = undefined);

export type MacAppSource = 'github' | 'upload';

/** The release /latest shows: the folder from GNOMON_RELEASES_DIR, else an upload, else GitHub (see the top). */
export async function currentRelease(o: { releasesDir?: string; uploadDir?: string; source: MacAppSource }): Promise<{ release: Release | null; dir?: string; from: 'folder' | 'upload' | 'github' }> {
  if (o.releasesDir) return { release: readRelease(o.releasesDir), dir: o.releasesDir, from: 'folder' };
  if (o.source === 'upload') return { release: readRelease(o.uploadDir), dir: o.uploadDir, from: 'upload' };
  return { release: await githubRelease(), from: 'github' };
}

/** A .dmg's last 512 bytes start with "koly" (the UDIF trailer); anything else isn't a disk image. */
export function looksLikeDmg(file: string): boolean {
  const size = fs.statSync(file).size;
  if (size < 1024) return false;
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, size - 512);
    return b.toString('latin1') === 'koly';
  } finally {
    fs.closeSync(fd);
  }
}

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
