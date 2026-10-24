// Inviting people (docs/accounts-design.md, section 3): each gets a one-time link to create their account. With email
// set up the link is emailed; without it, the Admin page shows it to pass on by hand. Takes a list, so a bulk import
// can invite many people in one go.
import { inviteEmail, type Lang } from './emails';
import { MailError, plainAddress, type Transport } from './mail';
import type { Person, Store } from './store';

export type InviteInput = { email: string; name?: string; role?: Person['role'] };

/**
 * What happened for one person. `link` is only there when it wasn't emailed (no email set up, or sending failed), so
 * the admin can pass it on by hand. `error` is set when the person couldn't be invited or the email didn't go out.
 */
export type InviteResult = { email: string; personId?: string; expiresAt?: string; sent: boolean; link?: string; error?: string };

export type InviteDeps = {
  store: Store;
  /** How to send email, or undefined when the server has none set up. */
  transport?: Transport;
  /** The server's public address (https://…), for the link. */
  baseUrl: string;
  /** The server's name: the sender name and in the text. */
  server: string;
  /** Who invites, for "{inviter} invited you". */
  inviter: string;
  lang: Lang;
};

export const inviteLink = (baseUrl: string, code: string) => `${baseUrl.replace(/\/+$/, '')}/account/register#invite=${code}`;

/** A new invitation for someone already on the People page as invited (the old link stops working), emailed if possible. */
export async function sendInvitation(deps: InviteDeps, person: Person): Promise<InviteResult> {
  const email = person.email ?? '';
  const { code, expiresAt } = deps.store.createInvite(person.id);
  const link = inviteLink(deps.baseUrl, code);
  if (!deps.transport || !email) return { email, personId: person.id, expiresAt, sent: false, link };
  try {
    await deps.transport(inviteEmail({ lang: deps.lang, to: email, name: person.name, server: deps.server, inviter: deps.inviter, link, expiresAt }));
    return { email, personId: person.id, expiresAt, sent: true };
  } catch (err) {
    return { email, personId: person.id, expiresAt, sent: false, link, error: err instanceof MailError ? err.message : `Sending failed: ${(err as Error).message}` };
  }
}

/**
 * Invite a list of people: each new email becomes an invited person with their own link. Emails are sent one after
 * another (gentle on the mail server's limits). Someone who already has an account is skipped with an error; someone
 * still invited gets a fresh invitation.
 */
export async function invitePeople(deps: InviteDeps, list: InviteInput[]): Promise<InviteResult[]> {
  const results: InviteResult[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const email = String(item.email ?? '').trim().toLowerCase();
    if (!plainAddress(email)) {
      results.push({ email, sent: false, error: 'Not an email address' });
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    const existing = deps.store.personByEmail(email);
    if (existing && existing.status !== 'invited') {
      results.push({ email, personId: existing.id, sent: false, error: 'There’s already an account with this email' });
      continue;
    }
    const name = item.name?.trim().slice(0, 80) || email.split('@')[0];
    const person = existing ?? deps.store.addPerson({ email, name, role: item.role === 'admin' ? 'admin' : 'member', status: 'invited' });
    results.push(await sendInvitation(deps, person));
  }
  return results;
}
