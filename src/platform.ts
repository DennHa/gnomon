// Where the interface runs: the Mac app (Electron) or the web app (/app on a Gnomon server, src/web). In the browser,
// what needs the Mac is hidden: menu bar, shortcuts, idle detection, the activity trail, Float/Personio, the local API.
export const isWeb = (): boolean => typeof window !== 'undefined' && (window as { gnomonWeb?: boolean }).gnomonWeb === true;

/** Copy as text in the browser: the Clipboard API, or the older copy command where that's not allowed. */
export async function browserCopy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    const focused = document.activeElement as HTMLElement | null;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    focused?.focus();
    if (!ok) throw new Error('copy failed');
  }
}
