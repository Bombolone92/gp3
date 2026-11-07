/**
 * Emailing invitations — the calling side of worker/email.js, the one shared
 * worker the app's developer deploys (workspace workers cannot send mail).
 * The call goes through puter.workers.exec(), which forwards the signed-in
 * user's Puter token: that is what lets the worker send at all, and what
 * makes each send bill the sender rather than the app owner.
 *
 * Nothing here sends on its own. Every message is one a person typed
 * addresses for and pressed Send on, and the worker composes the mail from
 * parts (names, server, code), so this module never builds a message body.
 */
import { EMAIL_WORKER_URL } from '../config.js';

/** Sending needs the worker bridge (it carries the user's session). */
export function emailAvailable() {
  return Boolean(EMAIL_WORKER_URL && typeof puter !== 'undefined' && puter?.workers?.exec);
}

/**
 * The addresses in a pasted blob: commas, semicolons, whitespace, and
 * newlines all separate. A "Display Name <addr@host>" entry — the shape a
 * mail client or address book pastes — counts as its address, not as a run
 * of bad tokens. Returns what parsed and what did not.
 */
export function parseEmails(text) {
  const emails = [];
  const bad = [];
  const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const add = (raw) => {
    // As an address is pasted out of prose or off a web page: a "mailto:"
    // scheme in front (a contact link copied whole), the bracket, quote or
    // sentence punctuation glued to either end ("(pat@x.com)", "pat@x.com."),
    // and the full-width @ an East Asian keyboard layout types (U+FF20). Read
    // as they came, the scheme and the punctuation went into the address,
    // which the mail then never reached, and the full-width sign made the
    // address unreadable, though the sender saw nothing wrong with it. A
    // contact link often carries a subject with it ("mailto:pat@x.com?subject=
    // Hello"), and the scheme taken off alone left the question mark and
    // everything after it on the address, which passed for one (a domain
    // with a dot in it) and reached the mail as one nobody has. What stands
    // after a question mark in the domain is the link's, never the address's
    // (a question mark before the @ may be part of a name, and stays). In
    // the order they stand in: the bracket or quote in front comes off
    // before the scheme is looked for (looked for first, "(mailto:pat@x.com)"
    // kept its scheme), the scheme before the query, and the punctuation at
    // the end last, once the query it may have been glued to is gone.
    const s = String(raw).trim().replace(/^[(["']+/, '').replace(/^mailto:/i, '').replace(/＠/g, '@')
      .replace(/^([^\s@?]+@[^\s@?]+)\?.*$/, '$1').replace(/[)\]"'.,;:!?]+$/, '').toLowerCase();
    if (SHAPE.test(s) && s.length <= 254) {
      if (!emails.includes(s)) emails.push(s);
      return true;
    }
    return false;
  };
  // Pull each bracketed address (with the display name in front of it) out
  // first, so the name never becomes a run of bad tokens; then split the rest.
  // The name run crosses whitespace, so a bare address sitting right before a
  // bracketed entry ("pat@x.com Ann <ann@y.com>") would be swallowed with the
  // name and silently lost — anything in the run shaped like an address is
  // kept for the split below instead.
  // A quoted display name goes first, whole: address books write a name
  // with a comma in it in quotes ("Fry, Ellis" <ellis@x.com>), and the name
  // run stops at the comma, so the half before it was reported as an
  // address that could not be read. Unquoted, the same name (Fry, Ellis
  // <ellis@x.com>; Doe, Jane <jane@x.com>, as a mail client's To line is
  // copied) reaches back over a comma too, as long as what stands before
  // the comma carries no @: a bare address before a comma is a recipient
  // of its own, never part of the next name. The name begins where the
  // text does or right after a separator, never inside a token (from the
  // "x.com" of a bare address, say, which would leave "pat@" behind).
  // The full-width @ first, over the whole text: the name run below stops at
  // an @ (a bare address before a bracketed entry is a recipient, not a
  // name), and typed full-width it did not stop, so the address before the
  // name was taken for part of it and lost.
  const rest = String(text || '').replace(/＠/g, '@').replace(/"[^"\n]*"\s*(?=<)/g, ' ').replace(/(?<![^,;\n>])((?:[^,;<>\n@]*,)*[^,;<>\n]*)<([^<>]*)>/g, (_, name, addr) => {
    const t = addr.trim();
    if (!add(t) && t) bad.push(t);
    return ` ${name.split(/\s+/).filter((w) => SHAPE.test(w)).join(' ')} `;
  });
  for (const part of rest.split(/[\s,;]+/).filter(Boolean)) {
    if (!add(part.replace(/^<+|>+$/g, ''))) bad.push(part);
  }
  return { emails, bad };
}

/** How long one send is given: up to ten mails go out one after another on the worker. */
const SEND_TIMEOUT_MS = 60_000;

const FRIENDLY = {
  sign_in_required: 'Sign in with Puter to send invitations.',
  daily_limit: 'You have sent as many invitation emails as one account can in a day. Try again tomorrow, or share the link directly.',
  too_many_recipients: 'That is too many addresses at once; send to 10 at a time.',
  invalid: 'The invitation could not be composed. Copy the link and share it directly.',
};

/**
 * Send one invitation to several addresses. `kind` is 'workspace', 'guest',
 * or 'connect'; `server` + `code` name the invite, and the worker builds the
 * link and the message itself. Resolves to { sent, failed, suppressed,
 * results }; throws a friendly Error when nothing could be sent.
 */
export async function sendInviteEmails({ kind, server, code, exp, workspace, channel, inviter, note, emails }) {
  if (!emailAvailable()) throw new Error('Email is not available here. Copy the link and share it directly.');
  // Given a minute, long enough for ten mails to go out one after another,
  // and then given up on: every call to a workspace server has its time
  // limit, and this one had none, so a connection that stalled left the
  // dialog's button reading "Sending", disabled, for good.
  let ctl = null;
  let timer = null;
  try {
    ctl = new AbortController();
    timer = setTimeout(() => ctl.abort(new DOMException('The request timed out', 'TimeoutError')), SEND_TIMEOUT_MS);
  } catch {
    ctl = null; /* no AbortController in this runtime */
  }
  let res;
  try {
    res = await puter.workers.exec(`${EMAIL_WORKER_URL}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(ctl ? { signal: ctl.signal } : {}),
      body: JSON.stringify({
        kind, server, code, workspace, channel, inviter, emails,
        exp: exp || undefined,
        note: note || undefined,
        app: `${location.origin}${location.pathname}`,
      }),
    });
  } catch {
    // The mails may have gone out before the answer was lost: said so,
    // rather than have the sender send them all again on the spot.
    if (ctl?.signal.aborted) throw new Error('The email service took too long to answer; if nothing arrives, copy the link and share it directly.');
    throw new Error('The email service is not reachable right now. Copy the link and share it directly.');
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.ok) {
    throw new Error(FRIENDLY[data?.error] || 'The invitations could not be sent. Copy the link and share it directly.');
  }
  return data;
}
