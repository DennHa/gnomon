// Where the interface runs: the Mac app (Electron) or the web app (/app on a Gnomon server, src/web). In the browser,
// what needs the Mac is hidden: menu bar, shortcuts, idle detection, the activity trail, Float/Personio, the local API.
export const isWeb = (): boolean => typeof window !== 'undefined' && (window as { gnomonWeb?: boolean }).gnomonWeb === true;
