/**
 * The email channel. Every Puter account has an address, <username>@puter.email,
 * whose mail is stored in the account's own drive. When the owner turns this
 * on, their browser checks that mailbox while the app is open and hands new
 * messages to the help desk, which opens tickets or threads replies (see
 * server/email.js). Notification emails set Reply-To to this address, so
 * customer replies come back the same way.
 */
import { sdk, currentUser } from './puter.js';

const CHECK_EVERY = 2 * 60 * 1000;
const MAX_PER_RUN = 40;
const MAX_RETRIES = 5;
const ATTACHMENT_LIMIT = 20 * 1024 * 1024;

export async function mailboxAddress() {
  const u = await currentUser();
  return `${u.username}@puter.email`;
}

function stateKey(ref) {
  return `help-desk:mailbox:${ref}`;
}

function loadState(ref) {
  try {
    return JSON.parse(localStorage.getItem(stateKey(ref)) || 'null');
  } catch {
    return null;
  }
}

function saveState(ref, state) {
  try {
    localStorage.setItem(stateKey(ref), JSON.stringify({ ...state, seen: state.seen.slice(-400) }));
  } catch {
    /* ignore */
  }
}

/** Ask for (prompt) or check access to the mailbox folder. */
export async function mailboxAccess({ prompt = false } = {}) {
  const p = sdk();
  if (!p?.email?.list) return false;
  const { username } = await currentUser();
  const permission = `fs:/${username}/.mail:read`;
  try {
    if (prompt) return !!(await p.perms.request('permission', { permission, create: false }));
    if (p.perms?.check) return !!(await p.perms.check('permission', { permission }));
  } catch {
    /* fall through to a probe */
  }
  try {
    await p.email.list({ limit: 1 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every message filed since the last check, oldest first. The listing is
 * newest first, so it has to reach back to `since`: stopping early would let
 * `since` move past messages that were never fetched.
 */
async function newMessages(state) {
  const p = sdk();
  const since = Date.parse(state.since) || 0;
  const seen = new Set(state.seen);
  const found = [];
  let cursor = null;
  do {
    const page = await p.email.list({ folder: 'inbox', limit: 50, cursor });
    let older = false;
    for (const item of page.items || []) {
      if (Date.parse(item.date) < since) {
        older = true;
        break;
      }
      if (!seen.has(item.id)) found.push(item);
    }
    cursor = older ? null : page.cursor;
  } while (cursor);
  return found.reverse();
}

const inflight = new Map();

/**
 * Import new mail into the open help desk. Returns a summary of what
 * happened. Safe to call often: each message is imported once, and a check
 * that is already running for this desk is shared rather than repeated.
 */
export function importMailbox(app, opts = {}) {
  const ref = app.ref;
  if (!inflight.has(ref)) inflight.set(ref, runImport(app, opts).finally(() => inflight.delete(ref)));
  return inflight.get(ref);
}

async function runImport(app, { onProgress } = {}) {
  // Pin the desk this run belongs to: switching desks mid-run must not file
  // the remaining messages in the newly opened one.
  const { ref, api, replica } = app;
  const current = () => app.ref === ref;
  const state = loadState(ref) || { since: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), seen: [] };
  state.retries ||= {};
  const items = (await newMessages(state)).slice(0, MAX_PER_RUN);
  const summary = { created: 0, appended: 0, skipped: 0, failed: 0 };
  // `since` only moves past an unbroken run of handled messages, so one that
  // failed is listed again next time. Messages after it are kept in `seen`.
  let blocked = false;
  const done = (item) => {
    state.seen.push(item.id);
    delete state.retries[item.id];
    if (blocked) return;
    // The mailbox's own filing time, never the sender's Date header, which
    // anyone can set (a message dated 2099 would stop all later imports).
    const filed = Math.min(Date.parse(item.date) || Date.now(), Date.now());
    state.since = new Date(Math.max(filed, Date.parse(state.since) || 0)).toISOString();
  };
  const fail = (item) => {
    summary.failed++;
    // A message that keeps failing is given up on rather than holding back
    // every later import.
    state.retries[item.id] = (state.retries[item.id] || 0) + 1;
    if (state.retries[item.id] >= MAX_RETRIES) done(item);
    else blocked = true;
  };
  for (let i = 0; i < items.length && current(); i++) {
    onProgress?.(i + 1, items.length);
    const item = items[i];
    let message;
    try {
      message = await sdk().email.get(item.id);
    } catch {
      fail(item);
      continue;
    }
    // Your own notification copies and mail from no sender are not requests.
    if (!message.from?.address || /@apps\.puter\.email$/i.test(message.from.address)) {
      summary.skipped++;
      done(item);
      continue;
    }
    const attachments = [];
    for (const a of (message.attachments || []).filter((x) => !x.related && x.size <= ATTACHMENT_LIMIT).slice(0, 10)) {
      try {
        const file = new File([a.content], a.filename || 'attachment', { type: a.mimeType || 'application/octet-stream' });
        attachments.push(await api.upload(file));
      } catch {
        /* keep the message even if a file fails */
      }
    }
    if (!current()) break;
    const text = message.text || (message.html ? new DOMParser().parseFromString(message.html, 'text/html').body.textContent : '');
    try {
      const res = await api.post('/email/import', {
        messages: [{
          messageId: message.messageId || `${item.id}@puter-mailbox`,
          from: message.from,
          cc: message.cc || [],
          subject: message.subject || item.subject,
          text,
          date: message.date || item.date,
          attachments,
        }],
      });
      let failed = false;
      for (const r of res.results || []) {
        if (r.ticket) replica?.upsert('t', r.ticket);
        if (r.requester) replica?.upsert('u', r.requester);
        if (r.status === 'failed') failed = true;
        else if (r.status in summary) summary[r.status]++;
        else if (r.status === 'duplicate') summary.skipped++;
      }
      // The server reports a message it could not file (a storage error,
      // say) in a normal answer; it is tried again like any other failure.
      if (failed) fail(item);
      else done(item);
      saveState(ref, state);
    } catch {
      fail(item);
    }
  }
  saveState(ref, state);
  return summary;
}

/**
 * Keep checking the mailbox while the app is open, for the owner of a desk
 * with the email channel on. Returns a stop function.
 */
export function watchMailbox(app, { onImported } = {}) {
  let timer = null;
  let stopped = false;
  let running = false;
  const run = async () => {
    if (stopped || running || document.visibilityState === 'hidden') return;
    const meta = app.replica?.meta;
    if (!meta?.email?.inbox || app.me?.role !== 'owner') return;
    running = true;
    try {
      if (await mailboxAccess()) {
        const s = await importMailbox(app);
        if (s.created || s.appended) onImported?.(s);
      }
    } catch (e) {
      console.warn('Mailbox check failed', e);
    } finally {
      running = false;
    }
  };
  timer = setInterval(run, CHECK_EVERY);
  setTimeout(run, 4000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
