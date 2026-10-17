// A QR code drawn with text, for the server log and gnomon-admin: two modules per character (▀), black on white
// via ANSI colours, so a phone camera can scan it straight from the terminal.
import qrcode from 'qrcode-generator';

export function terminalQr(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  const dark = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
  const lines: string[] = [];
  for (let r = -quiet; r < n + quiet; r += 2) {
    let line = '';
    for (let c = -quiet; c < n + quiet; c++) line += `\x1b[${dark(r, c) ? 30 : 97}m\x1b[${dark(r + 1, c) ? 40 : 107}m▀`;
    lines.push(`${line}\x1b[0m`);
  }
  return lines.join('\n');
}

/** The pairing link a QR code carries, when the server knows its public address (GNOMON_PUBLIC_URL). */
export function pairLink(code: string): string | undefined {
  const base = process.env.GNOMON_PUBLIC_URL?.trim().replace(/\/+$/, '');
  return base ? `${base}/#pair=${code}` : undefined;
}

/** Code, link and QR as printed by the server and gnomon-admin. */
export function printPairing(code: string, deviceName: string, minutes: number) {
  const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
  const link = pairLink(formatted);
  if (link) console.log(`\n${terminalQr(link)}\n\nScan with the phone's camera, or open ${link}`);
  console.log(`Pairing code for "${deviceName}": ${formatted}  (valid ${minutes} minutes, works once)`);
  if (!link) console.log('Set GNOMON_PUBLIC_URL (e.g. https://gnomon.example.com) to also get a QR code here.');
}
