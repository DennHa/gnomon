// The emails the server sends: an invitation, a password reset and the admin's test email. Short plain text plus
// simple HTML, in English or German, from the server's name.
import type { Mail } from './mail';

export type Lang = 'en' | 'de';

const TEXT = {
  en: {
    inviteSubject: 'Your invitation to {server}',
    inviteHello: 'Hello {name},',
    inviteBody: '{inviter} invited you to Gnomon on {server}. Create your account with this link:',
    inviteValid: 'The link works once, until {date}.',
    inviteButton: 'Create your account',
    resetSubject: 'Reset your password for {server}',
    resetBody: 'Someone asked to reset the password of your Gnomon account on {server}. Set a new one with this link:',
    resetValid: 'The link works once, for 30 minutes.',
    resetIgnore: 'If that wasn’t you, ignore this email. Your password stays as it is.',
    resetButton: 'Set a new password',
    testSubject: 'Test email from {server}',
    testBody: 'This is a test from your Gnomon server. Email works: invitations and password resets will arrive like this.',
    hello: 'Hello,',
  },
  de: {
    inviteSubject: 'Deine Einladung zu {server}',
    inviteHello: 'Hallo {name},',
    inviteBody: '{inviter} hat dich zu Gnomon auf {server} eingeladen. Leg dein Konto mit diesem Link an:',
    inviteValid: 'Der Link funktioniert einmal, bis {date}.',
    inviteButton: 'Konto anlegen',
    resetSubject: 'Passwort für {server} zurücksetzen',
    resetBody: 'Jemand möchte das Passwort deines Gnomon-Kontos auf {server} zurücksetzen. Mit diesem Link legst du ein neues fest:',
    resetValid: 'Der Link funktioniert einmal, 30 Minuten lang.',
    resetIgnore: 'Warst du das nicht, ignoriere diese E-Mail. Dein Passwort bleibt, wie es ist.',
    resetButton: 'Neues Passwort festlegen',
    testSubject: 'Test-E-Mail von {server}',
    testBody: 'Das ist ein Test von deinem Gnomon-Server. E-Mail funktioniert: Einladungen und Passwort-Links kommen so an.',
    hello: 'Hallo,',
  },
} satisfies Record<Lang, Record<string, string>>;

type Key = keyof (typeof TEXT)['en'];
const fill = (lang: Lang, k: Key, vars: Record<string, string> = {}) => TEXT[lang][k].replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Paragraphs and an optional button link, as plain text and as simple HTML (no images, no tracking). */
function compose(to: string, fromName: string, subject: string, paragraphs: string[], link?: { url: string; label: string }, after: string[] = []): Mail {
  const text = [...paragraphs, ...(link ? [link.url] : []), ...after, `— ${fromName}`].join('\n\n') + '\n';
  const p = (s: string) => `<p style="margin:0 0 16px">${esc(s)}</p>`;
  const button = link
    ? `<p style="margin:0 0 16px"><a href="${esc(link.url)}" style="display:inline-block;padding:10px 18px;background:#1f6feb;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">${esc(link.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;color:#555;word-break:break-all">${esc(link.url)}</p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;padding:24px;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222"><div style="max-width:520px">${paragraphs.map(p).join('')}${button}${after.map(p).join('')}<p style="margin:24px 0 0;color:#777;font-size:13px">${esc(fromName)}</p></div></body></html>`;
  return { to, subject, text, html, fromName };
}

export function inviteEmail(o: { lang: Lang; to: string; name: string; server: string; inviter: string; link: string; expiresAt: string }): Mail {
  const date = new Date(o.expiresAt).toLocaleDateString(o.lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const v = { name: o.name, server: o.server, inviter: o.inviter, date };
  return compose(o.to, o.server, fill(o.lang, 'inviteSubject', v), [fill(o.lang, 'inviteHello', v), fill(o.lang, 'inviteBody', v)], { url: o.link, label: fill(o.lang, 'inviteButton') }, [fill(o.lang, 'inviteValid', v)]);
}

export function resetEmail(o: { lang: Lang; to: string; server: string; link: string }): Mail {
  const v = { server: o.server };
  return compose(o.to, o.server, fill(o.lang, 'resetSubject', v), [fill(o.lang, 'hello'), fill(o.lang, 'resetBody', v)], { url: o.link, label: fill(o.lang, 'resetButton') }, [fill(o.lang, 'resetValid'), fill(o.lang, 'resetIgnore')]);
}

export function testEmail(o: { lang: Lang; to: string; server: string }): Mail {
  const v = { server: o.server };
  return compose(o.to, o.server, fill(o.lang, 'testSubject', v), [fill(o.lang, 'hello'), fill(o.lang, 'testBody')]);
}
