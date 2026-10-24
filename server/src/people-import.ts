// Inviting many people from a list (the Admin page's People → Invite from a list): a CSV file or pasted text, one
// person per line with a name and an email. First a preview says what would happen to each line; then only the new
// people are invited, in small batches the Admin page sends one after another (invites.ts does the inviting).
import { parseCsv } from './csv';
import { invitePeople, type InviteDeps, type InviteResult } from './invites';
import { plainAddress } from './mail';
import type { Store } from './store';

/** Lines in one list; a company of a few hundred fits with room to spare. */
export const MAX_IMPORT = 1000;
/** People per invite request, so a request with email stays well under a proxy's time limit. */
export const MAX_BATCH = 50;

export type ImportRow = { line: number; name: string; email: string };
/** new: will be invited; account: has an account already; invited: has an invitation already; duplicate: earlier in the list. */
export type ImportStatus = 'new' | 'account' | 'invited' | 'duplicate' | 'invalid';
export type PreviewRow = ImportRow & { status: ImportStatus };

const norm = (h: string) => h.toLowerCase().replace(/[^a-zäöüß]/g, '');
const FIRST = new Set(['firstname', 'givenname', 'vorname']);
const LAST = new Set(['lastname', 'surname', 'familyname', 'nachname', 'familienname']);
const NAME = new Set(['name', 'fullname', 'displayname', 'anzeigename', 'vollständigername']);
const isEmailHeader = (h: string) => /^(e?mail|emailaddress|emailadresse|mailadresse|workemail|arbeitsemail|dienstlicheemail)$/.test(h);

/** An address from a cell: "Jane Doe <jane@example.com>" and "mailto:" work too; lowercase. */
function addressIn(cell: string): string {
  const v = cell.trim();
  const angle = v.match(/<([^<>]+)>/);
  return (angle ? angle[1] : v).replace(/^mailto:/i, '').trim().toLowerCase();
}
const looksLikeEmail = (cell: string) => cell.includes('@');

/**
 * The people in a list. Lines may be "name, email" or "email, name", separated by comma, semicolon or tab, with or
 * without a header. With a header, its columns say where the name (or first and last name) and the email are;
 * without one, the email is the cell with an @ and the name the cells before it (or else the one after it).
 */
export function parsePeopleList(text: string): ImportRow[] {
  const rows = parseCsv(text).filter((r) => r.fields.some((f) => f.trim()));
  if (!rows.length) return [];
  const head = rows[0].fields.map((f) => norm(f));
  const emailCol = head.findIndex(isEmailHeader);
  const hasHeader = !rows[0].fields.some(looksLikeEmail) && (emailCol >= 0 || head.some((h) => NAME.has(h) || FIRST.has(h) || LAST.has(h)));
  const cols = hasHeader
    ? { email: emailCol, name: head.findIndex((h) => NAME.has(h)), first: head.findIndex((h) => FIRST.has(h)), last: head.findIndex((h) => LAST.has(h)) }
    : undefined;
  return rows.slice(hasHeader ? 1 : 0).map(({ line, fields }) => {
    const cell = (i: number) => (i >= 0 ? (fields[i] ?? '').trim() : '');
    let email: string;
    let name: string;
    if (cols && cols.email >= 0) {
      email = cell(cols.email);
      name = cols.name >= 0 ? cell(cols.name) : [cell(cols.first), cell(cols.last)].filter(Boolean).join(' ');
    } else {
      const at = fields.findIndex(looksLikeEmail);
      const cells = fields.map((f) => f.trim());
      email = at >= 0 ? cells[at] : cells.find(Boolean) ?? '';
      const before = at > 0 ? cells.slice(0, at).filter(Boolean) : [];
      name = before.length ? before.join(' ') : at >= 0 ? cells.slice(at + 1).find(Boolean) ?? '' : '';
    }
    // "Jane Doe <jane@example.com>" alone in its cell: the name is in there too.
    const angle = email.match(/^\s*"?([^"<]*?)"?\s*<[^<>]+>\s*$/);
    if (angle && !name) name = angle[1].trim();
    return { line, name: name.replace(/\s+/g, ' ').slice(0, 80), email: addressIn(email) };
  });
}

/** What would happen to each line, with a count per kind. */
export function previewImport(store: Store, rows: ImportRow[]): { rows: PreviewRow[]; counts: Record<ImportStatus, number> } {
  const counts: Record<ImportStatus, number> = { new: 0, account: 0, invited: 0, duplicate: 0, invalid: 0 };
  const seen = new Set<string>();
  const out = rows.map((r): PreviewRow => {
    let status: ImportStatus;
    if (!plainAddress(r.email)) status = 'invalid';
    else if (seen.has(r.email)) status = 'duplicate';
    else {
      seen.add(r.email);
      const p = store.personByEmail(r.email);
      status = !p ? 'new' : p.status === 'invited' ? 'invited' : 'account';
    }
    counts[status]++;
    return { ...r, status };
  });
  return { rows: out, counts };
}

/**
 * Invite one batch of a list. Only people without an account or invitation are invited; with `again`, people who are
 * already invited get a new invitation (to retry an email that didn't go out). Anyone else is skipped with an error.
 */
export async function importPeople(deps: InviteDeps, list: { email: string; name?: string }[], again = false): Promise<InviteResult[]> {
  const results: InviteResult[] = [];
  for (const item of list) {
    const email = String(item.email ?? '').trim().toLowerCase();
    const p = plainAddress(email) ? deps.store.personByEmail(email) : undefined;
    if (p && (p.status !== 'invited' || !again)) {
      results.push({ email, personId: p.id, sent: false, error: p.status === 'invited' ? 'Already invited' : 'There’s already an account with this email' });
      continue;
    }
    const name = typeof item.name === 'string' ? item.name : undefined;
    results.push(...(await invitePeople(deps, [{ email, name, role: 'member' }])));
  }
  return results;
}
