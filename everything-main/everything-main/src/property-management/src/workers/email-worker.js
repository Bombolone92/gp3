/**
 * Emailing tenants, owners and vendors from the app: the app's one shared,
 * app-owned Puter worker (deployed to https://property-management-email.puter.work;
 * src/mailer.js is the calling side).
 *
 * It is deployed ONCE, by the app owner (npm run deploy:email-worker):
 * outbound mail has to be authorized by a worker's own token, so the sending
 * capability lives somewhere the app controls. The cost does not: the app
 * calls this worker with puter.workers.exec(), which forwards the signed-in
 * user's Puter token, and each message is sent with that token in hand, so
 * every send is billed to, and rate-limited as, the user who asked for it.
 *
 *   POST /send    email one message to its recipients (one private mail each)
 *   GET  /health  liveness + deployed version (no auth)
 *   GET  /whoami  what the worker can see of your session (names only)
 *
 * An app-owned relay that forwarded whatever it was handed would be a spam
 * cannon wearing this app's sending reputation, so:
 *
 *   - no Puter session, no send. `user` is only populated for callers that
 *     come through puter.workers.exec(); everyone else gets 401, and so does
 *     a caller whose session arrived without a form that bills THEM.
 *   - the caller supplies TEXT, never markup. The body is HTML-escaped here
 *     and laid out by this worker, so nothing can inject links, images, or a
 *     tracking pixel.
 *   - recipients are capped per request and per user per day, and a message a
 *     recipient already received is skipped rather than re-sent.
 *   - attachments are capped in count and size, limited to documents and
 *     pictures whose names match their type, and filenames are sanitized.
 *
 * KV here belongs to the APP OWNER, so it holds nothing personal: keys are
 * SHA-256 hashes and values are a version digest plus a timestamp.
 *
 *   mail:sent:<sha256(callerId|messageId|email)> -> { v, at } (expires: SENT_TTL)
 *   mail:rate:<sha256(callerId)>:<YYYY-MM-DD> -> count      (expires: RATE_TTL)
 */

// Bump on every behavior change so /health proves which build is live.
const WORKER_VERSION = '1';

const SENT_PREFIX = 'mail:sent:';
const RATE_PREFIX = 'mail:rate:';
// Long enough to outlive one rent cycle: a reminder is a different message
// (different digest) and goes out regardless, but pressing Send twice on the
// same message weeks apart should still cost one email, not two.
const SENT_TTL = 180 * 24 * 60 * 60; // seconds
const CLAIM_TTL = 10 * 60; // seconds - a send that died mid-way can be retried after this
const RATE_TTL = 2 * 24 * 60 * 60; // seconds - yesterday's counter is dead weight

// Per request. The app sends a long list (an announcement to a building) in
// batches of this size, so one slow or failing request never holds a whole
// building's mail, and the daily cap below bounds the total.
const MAX_RECIPIENTS = 5;
const DAILY_LIMIT = 300; // per user per UTC day
const MAX_SUBJECT_CHARS = 200;
const MAX_BODY_CHARS = 20_000;
const MAX_ATTACHMENTS = 10;
// Base64 characters, not bytes: ~4/3 of the payload. 8 MB of base64 is about
// 6 MB of files, which is already past what many mailboxes accept.
const MAX_ATTACHMENT_CHARS = 8 * 1024 * 1024;

/* ---- Small utilities ---------------------------------------------------- */

/** The worker owner's context (the `me` global; ctx.me in tests). */
function ownerOf(ctx) {
  return (ctx && ctx.me) || (typeof me !== 'undefined' ? me : null);
}

/** The signed-in caller. The runtime has called this both `user` and
 *  `requestor`; take whichever one arrived. (Observed on the live platform,
 *  2026-08: `user`.) */
function callerOf(ctx) {
  return (ctx && (ctx.user || ctx.requestor)) || null;
}

/**
 * A stable id for the caller - it keys the already-sent and daily-cap records,
 * so it has to be the same tomorrow as it is today, and different for every
 * user. Do NOT assume it is sitting on the caller object: the live platform
 * (2026-08) hands over a caller whose only own property is `puter`, so the
 * documented `user.uuid` is absent and asking their own Puter is the path that
 * actually answers. Try the known names first anyway, then the ones nested
 * under their Puter handle, then getUser(). '' means "could not tell", which
 * is refused rather than guessed at: a shared id would let one user's dedupe
 * record suppress another user's message.
 */
async function callerIdOf(caller) {
  if (!caller) return '';
  const own = caller.uuid || caller.uid || caller.user_uuid || caller.username;
  if (typeof own === 'string' && own) return own;
  const p = caller.puter;
  const nested = p && (p.uuid || p.uid || p.username);
  if (typeof nested === 'string' && nested) return nested;
  try {
    const who = p && p.auth && typeof p.auth.getUser === 'function' ? await p.auth.getUser() : null;
    const id = who && (who.uuid || who.uid || who.username);
    return typeof id === 'string' ? id : '';
  } catch {
    return ''; // an unreachable /whoami is not an identity
  }
}

function kvOf(ctx) {
  return ownerOf(ctx).puter.kv;
}

/** puter.kv values may come back as parsed objects or JSON strings. */
function coerce(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  let out = '';
  for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, '0');
  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Every response here is about one user's billing - never cacheable.
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function lowerEmail(v) {
  // Folded through line() first: NEXT LINE (U+0085) is a line break to a
  // transport that honours it but not whitespace to JavaScript's \s, so it
  // passed the shape test below into the one header field the rule for
  // subjects and names did not already cover. Folded to a space, it fails
  // the shape test like any other.
  const s = typeof v === 'string' ? line(v, 300).toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254 ? s : '';
}

/** The first `cap` characters, without leaving half of a surrogate pair at
 *  the cut: a lone high surrogate is not a well-formed string, and JSON or
 *  the transport downstream may refuse it or replace it. */
function cut(s, cap) {
  const out = s.slice(0, cap);
  const last = out.charCodeAt(out.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out;
}

/** Body text: control characters stripped, newlines kept, length capped. */
function text(v, cap) {
  return typeof v === 'string' ? cut(v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''), cap) : '';
}

/** Header-safe text: as above, but folded to a single line. A stray CR/LF in
 *  a subject is how header injection starts; there is no legitimate newline in
 *  a subject or a sender name. Unicode's own line
 *  breaks (LINE/PARAGRAPH SEPARATOR, NEXT LINE) fold the same way - whether a
 *  transport treats them as a header break is its business, not a bet. */
function line(v, cap) {
  return text(v, cap).replace(/[\r\n\u2028\u2029\u0085]+/g, ' ').trim();
}

function escapeHtml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---- Request validation --------------------------------------------------- */

/** A filename safe to put in a MIME header: no separators, no traversal, no
 *  quotes, no bidirectional overrides (which show "invoice\u202efdp.exe" as
 *  invoiceexe.pdf in a mail client's attachment list), and short enough that
 *  the header stays one line. */
function fileName(value, fallback) {
  const name = cut(String(value == null ? '' : value)
    .replace(/[\x00-\x1F\x7F\u2028\u2029\u0085\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/["']/g, '')
    .replace(/^[.\s-]+|[\s]+$/g, ''), 120)
    .trim();
  return name || fallback;
}

const ATTACHMENT_TYPES = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
};

/** Attachments, normalized - or null when one of them is unusable. The whole
 *  request fails in that case rather than quietly mailing a message with its
 *  attachment missing: "sent" has to mean what the user saw. */
function readAttachments(list) {
  if (!Array.isArray(list) || !list.length) return [];
  if (list.length > MAX_ATTACHMENTS) return null;
  const out = [];
  let total = 0;
  for (const a of list) {
    if (!a || typeof a !== 'object') return null;
    const content = typeof a.content === 'string' ? a.content.replace(/\s+/g, '') : '';
    if (!content || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) return null;
    total += content.length;
    if (total > MAX_ATTACHMENT_CHARS) return null;
    // Documents and pictures only, named for what they are: an HTML page or
    // a program sent from this app's address would be a phishing kit.
    const type = typeof a.contentType === 'string' ? a.contentType.toLowerCase() : '';
    const exts = ATTACHMENT_TYPES[type];
    if (!exts) return null;
    const filename = fileName(a.filename, `attachment-${out.length + 1}.${exts[0]}`);
    if (!exts.includes(filename.split('.').pop().toLowerCase())) return null;
    out.push({ filename, content, contentType: type });
  }
  return out;
}

const KINDS = new Set(['email', 'announcement', 'reminder', 'notice', 'receipt', 'statement']);

/** The send request, normalized - or { error } for a 400. */
function readRequest(body) {
  const src = body && typeof body === 'object' ? body : {};
  const m = src.message && typeof src.message === 'object' ? src.message : {};
  // The id becomes part of a KV key. Same alphabet the app's ids use, so
  // nothing can smuggle a separator in.
  if (typeof m.id !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(m.id)) {
    return { error: 'message_id_required' };
  }

  const recipients = [];
  const seen = new Set();
  for (const r of Array.isArray(src.recipients) ? src.recipients : []) {
    const email = lowerEmail(r && r.email);
    if (!email || seen.has(email)) continue;
    // A digest of exactly what THIS recipient will see, computed by the app
    // (src/mailer.js). Opaque here: the worker only compares it to the one it
    // last sent to the same address for the same message.
    const version = /^[0-9a-f]{8,64}$/.test(String((r && r.version) || '')) ? String(r.version) : '';
    if (!version) return { error: 'version_required' };
    seen.add(email);
    recipients.push({ email, version, name: line(r && r.name, 200) });
    if (recipients.length >= MAX_RECIPIENTS) break;
  }
  if (!recipients.length) return { error: 'recipients_required' };

  // Too long is refused rather than cut: a message cut short (a total due
  // missing its amount) must not be reported as sent.
  if (String(src.subject == null ? '' : src.subject).trim().length > MAX_SUBJECT_CHARS) return { error: 'subject_too_long' };
  if (String(src.body == null ? '' : src.body).trim().length > MAX_BODY_CHARS) return { error: 'body_too_long' };
  const subject = line(src.subject, MAX_SUBJECT_CHARS);
  if (!subject) return { error: 'subject_required' };
  const message = text(src.body, MAX_BODY_CHARS).trim();
  if (!message) return { error: 'body_required' };

  const attachments = readAttachments(src.attachments);
  if (attachments === null) return { error: 'attachments_invalid' };

  return {
    message: {
      id: m.id,
      kind: KINDS.has(m.kind) ? m.kind : 'email',
      senderName: line(m.senderName, 200),
      senderEmail: lowerEmail(m.senderEmail),
    },
    recipients,
    subject,
    body: message,
    attachments,
    force: src.force === true,
  };
}

/* ---- The message ---------------------------------------------------------- */

/** The plain-text half: the message the user wrote, unchanged. */
function plainBody(req) {
  return req.body;
}

/**
 * The HTML half. Deliberately plain: a table-free card, everything styled
 * inline (mail clients drop <style> blocks), no images and no web fonts, so it
 * degrades to something readable everywhere and loads nothing from the network.
 * The message itself is the user's own words with their line breaks kept - this
 * worker adds a sender line and a frame, and nothing else.
 */
function htmlBody(req) {
  const d = req.message;
  const message = escapeHtml(req.body).replace(/\r?\n/g, '<br>');
  const header = d.senderName
    ? `<p style="margin:0 0 16px;color:#6b7280;font-size:13px;letter-spacing:.02em;` +
      `text-transform:uppercase">${escapeHtml(d.senderName)}</p>`
    : '';
  return (
    `<div style="background:#f6f7f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px">` +
    header +
    // pre-wrap: the user's own spacing survives - a column of figures lined
    // up with spaces collapsed to single spaces in every HTML-first client,
    // while the plain-text half kept it.
    `<div style="color:#111827;font-size:14px;line-height:1.6;white-space:pre-wrap">${message}</div>` +
    `</div></div>`
  );
}

/* ---- Sending -------------------------------------------------------------- */

/**
 * A send has two halves - who pays (the app's user) and what authorizes it
 * (this worker) - and the platform accepts them in either arrangement:
 *
 *   me.puter.email.send({ …, requesterToken: user.puter.authToken })
 *   user.puter.email.send({ …, emailAccessToken: me.puter.authToken })
 *
 * Both bill the user; which name a given runtime knows has moved, and a worker
 * that only spoke one of them would silently stop sending. So try the first,
 * fall back to the second, and remember which one answered for the rest of
 * this worker's life. The fallback is gated on the error looking like a
 * rejected request (bad parameter, bad token) rather than a rejected DELIVERY  - 
 * retrying a message the transport already accepted would double-send it.
 */
let preferredForm = 0;

const DELIVERY_ERROR = /deliver|recipient|suppress|unsubscrib|mailbox|smtp|bounce|spam|quota|rate|limit|attach|too large|size/i;
const REQUEST_ERROR = /token|auth|unauthor|forbidden|permission|denied|unknown|unrecognized|unsupported|invalid|missing|required|not a function|undefined/i;

/**
 * The forms that are actually available here, by their fixed index - null for
 * one whose halves are not both present.
 *
 * Each form names the caller on the bill in its own way, and BOTH names have
 * to be there for it to hold: form 0 sends through the owner's mailer and
 * points it at the caller with `requesterToken`, so without that token it
 * would send anyway - on the owner's account, silently, which is the one thing
 * this worker exists to never do. Form 1 sends through the caller's own mailer
 * and cannot bill anyone else, but needs the owner's token to be allowed to
 * send at all. A missing half therefore takes its form out of the running
 * rather than being passed along as `undefined`.
 */
function sendForms(ctx) {
  const owner = ownerOf(ctx);
  const caller = callerOf(ctx);
  const ownerPuter = (owner && owner.puter) || null;
  const callerPuter = (caller && caller.puter) || null;
  const token = (p) => (p && typeof p.authToken === 'string' && p.authToken ? p.authToken : '');
  const mailer = (p) => Boolean(p && p.email && typeof p.email.send === 'function');
  const callerToken = token(callerPuter);
  const ownerToken = token(ownerPuter);
  return [
    callerToken && mailer(ownerPuter)
      ? (message) => ownerPuter.email.send({ ...message, requesterToken: callerToken })
      : null,
    ownerToken && mailer(callerPuter)
      ? (message) => callerPuter.email.send({ ...message, emailAccessToken: ownerToken })
      : null,
  ];
}

async function sendMail(ctx, message) {
  const forms = sendForms(ctx);
  const order = (preferredForm === 0 ? [0, 1] : [1, 0]).filter((index) => forms[index]);
  // /send checks this before it reads a request, so reaching it here means the
  // session fell apart mid-batch. Still not a reason to send on the owner.
  if (!order.length) throw new Error('no token to bill this send to');
  let lastErr = null;
  for (const index of order) {
    try {
      const result = await forms[index](message);
      preferredForm = index;
      return result || {};
    } catch (err) {
      lastErr = err;
      const reason = String((err && err.message) || err || '');
      // Anything the transport said about THIS message is final.
      if (DELIVERY_ERROR.test(reason) || !REQUEST_ERROR.test(reason)) throw err;
    }
  }
  throw lastErr;
}

/* ---- Dedupe + daily cap ---------------------------------------------------- */

function sentKey(uuid, messageId, email) {
  return sha256Hex(`${uuid}|${messageId}|${email}`).then((hash) => SENT_PREFIX + hash);
}

async function expire(kv, key, seconds) {
  try {
    if (typeof kv.expire === 'function') await kv.expire(key, seconds);
  } catch {
    /* a key that outlives its welcome is harmless; a failed send is not */
  }
}

async function quotaKey(uuid) {
  return `${RATE_PREFIX}${await sha256Hex(uuid)}:${new Date().toISOString().slice(0, 10)}`;
}

async function quotaUsed(kv, key) {
  const value = coerce(await kv.get(key));
  const used = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isFinite(used) && used > 0 ? used : 0;
}

/**
 * Claim today's allowance for this request before anything is sent, and
 * settle up afterwards. Read-then-bump was a race: the counter only moved
 * once the whole batch had been handed to the transport, so every request in
 * flight at the same time read the same count and each was allowed the full
 * remainder - a burst of concurrent requests sent concurrency × MAX_RECIPIENTS
 * messages past the cap. An atomic increment reserves the slots up front,
 * where the second request sees the first one's claim; what does not go out
 * (a duplicate, a failure, an opt-out) is handed back in settleQuota.
 *
 * Resolves to { budget, reserved } - how many of this request's recipients
 * may be sent, and how many slots were claimed - or throws when the counter
 * cannot be read at all. Without `incr` the store falls back to the plain
 * read, which is not atomic but is all it has.
 */
async function reserveQuota(kv, key, count) {
  if (typeof kv.incr === 'function') {
    const after = Number(await kv.incr(key, count));
    await expire(kv, key, RATE_TTL);
    const before = Math.max(0, (Number.isFinite(after) ? after : count) - count);
    return { budget: Math.max(0, Math.min(count, DAILY_LIMIT - before)), reserved: count };
  }
  const used = await quotaUsed(kv, key);
  return { budget: Math.max(0, DAILY_LIMIT - used), reserved: 0 };
}

/** Return the claimed slots that went unused, or record what went out when
 *  nothing was claimed up front. */
async function settleQuota(kv, key, reservation, sent) {
  try {
    if (reservation.reserved) {
      const unused = reservation.reserved - sent;
      if (unused > 0) await kv.incr(key, -unused);
    } else if (sent) {
      await kv.set(key, (await quotaUsed(kv, key)) + sent);
      await expire(kv, key, RATE_TTL);
    }
  } catch {
    /* the cap is a guard rail, not a ledger - never fail a send over it. An
       unreturned slot costs the user one send today, never a message. */
  }
}

/* ---- Routes ---------------------------------------------------------------- */

router.get('/health', async () => json({ ok: true, version: WORKER_VERSION }));

/**
 * What this worker can see of the caller - NAMES and presence only, never a
 * value, a token, or an address. Two different failures both surface as "you
 * are not signed in" from /send (the session never left the browser, or it
 * arrived and the runtime bound it somewhere this code doesn't look), and only
 * the worker itself can tell them apart. Answering to the caller about their
 * own session leaks nothing they don't already have.
 */
router.get('/whoami', async (ctx) => {
  const caller = callerOf(ctx);
  const p = caller && caller.puter;
  const owner = ownerOf(ctx);
  return json({
    ok: true,
    version: WORKER_VERSION,
    // Did the session even reach us? puter.workers.exec() sends this header.
    sawAuthHeader: Boolean(ctx.request.headers.get('puter-auth')),
    boundAs: ctx.user ? 'user' : ctx.requestor ? 'requestor' : null,
    callerKeys: caller ? Object.keys(caller).sort() : [],
    puterKeys: p ? Object.keys(p).sort() : [],
    has: {
      puter: Boolean(p),
      authToken: Boolean(p && p.authToken),
      email: Boolean(p && p.email && typeof p.email.send === 'function'),
      auth: Boolean(p && p.auth && typeof p.auth.getUser === 'function'),
    },
    identified: Boolean(await callerIdOf(caller)),
    // Which of the two send forms could run here - the other half of "why am
    // I getting a 401", and the one /send checks before it spends anything.
    billable: sendForms(ctx).map(Boolean),
    owner: {
      email: Boolean(owner && owner.puter && owner.puter.email),
      authToken: Boolean(owner && owner.puter && owner.puter.authToken),
    },
  });
});

/**
 * Email one message. One mail per recipient, addressed only to them: a
 * tenant must never learn who else in the building received it, and the
 * sender's own copy is just another recipient here.
 */
router.post('/send', async (ctx) => {
  // A caller context exists only for requests that came through
  // puter.workers.exec(), which forwards their Puter session. No session, no
  // send - and no way to bill anyone for one either. `detail` separates "no
  // session arrived" from "a session arrived that we could not pin to a
  // person"; GET /whoami reports the same picture in full.
  const caller = callerOf(ctx);
  if (!caller || !caller.puter) {
    return json({ error: 'sign_in_required', detail: 'no_caller' }, 401);
  }
  const callerId = await callerIdOf(caller);
  if (!callerId) return json({ error: 'sign_in_required', detail: 'no_identity' }, 401);
  // A session that arrived without the token that names its owner on the bill
  // is not a licence to send on the app owner's. Refused before anything is
  // read, let alone spent; GET /whoami says which half was missing.
  if (!sendForms(ctx).some(Boolean)) {
    return json({ error: 'sign_in_required', detail: 'no_billable_sender' }, 401);
  }

  let body = null;
  try {
    body = await ctx.request.json();
  } catch {
    /* handled by readRequest */
  }
  const req = readRequest(body);
  if (req.error) return json({ error: req.error }, 400);

  const kv = kvOf(ctx);
  const rateKey = await quotaKey(callerId);
  // Claimed before the first message goes, so two requests racing on the last
  // of today's allowance cannot both be granted it. A counter that cannot be
  // read is a refusal, and a clean one: nothing has been spent yet, and a
  // thrown handler would have answered with a bare 5xx instead.
  let reservation = null;
  try {
    reservation = await reserveQuota(kv, rateKey, req.recipients.length);
  } catch {
    return json({ error: 'temporarily_unavailable' }, 503);
  }
  let { budget } = reservation;
  if (!budget) {
    await settleQuota(kv, rateKey, reservation, 0);
    return json({ error: 'daily_limit', limit: DAILY_LIMIT }, 429);
  }

  const html = htmlBody(req);
  const plain = plainBody(req);
  // Replies belong to the person who billed for the send, not to whatever
  // address the platform sends from.
  const replyTo = req.message.senderEmail || undefined;
  const attachments = req.attachments.length ? req.attachments : undefined;
  const results = [];
  let sent = 0;
  let cost = 0;

  for (const recipient of req.recipients) {
    const key = await sentKey(callerId, req.message.id, recipient.email);
    // Same message, same address, same words: don't spend the user's money to
    // send a duplicate. A reminder, an edited message, or a re-published link
    // all change the digest and go out; `force` covers a deliberate resend of
    // the identical message.
    if (!req.force) {
      // The record is a money-saver, not a gate. Unreadable, it counts as
      // absent: the user asked for this message to go, and the worst that
      // costs is one duplicate - whereas throwing here, one recipient into a
      // batch, took the whole reply down after an earlier message had already
      // been handed over, so that delivery was never reported at all.
      let previous = null;
      try {
        previous = coerce(await kv.get(key));
      } catch {
        previous = null;
      }
      if (previous && previous.v === recipient.version) {
        results.push({ email: recipient.email, status: 'skipped', reason: 'already_sent', at: previous.at || 0 });
        continue;
      }
    }
    if (!budget) {
      results.push({ email: recipient.email, status: 'skipped', reason: 'daily_limit' });
      continue;
    }
    // Two identical requests at once (a retry while the first is still
    // running) both pass the check above. An atomic claim lets one send.
    const claimKey = `${key}:claim:${recipient.version}`;
    if (!req.force) {
      let mine = true;
      try {
        mine = Number(await kv.incr(claimKey)) === 1;
        await expire(kv, claimKey, CLAIM_TTL);
      } catch {
        mine = true; // no claim possible: send, as before
      }
      if (!mine) {
        // Another request is sending this right now; it may yet fail, so
        // this one must not report it as delivered.
        results.push({ email: recipient.email, status: 'skipped', reason: 'in_progress' });
        continue;
      }
    }
    const release = async () => {
      try {
        if (!req.force) await (typeof kv.del === 'function' ? kv.del(claimKey) : kv.set(claimKey, 0));
      } catch {
        /* expires on its own */
      }
    };

    // Only the handing-over is allowed to fail as a send. Everything after it
    // is this worker's own bookkeeping, and once the transport has taken the
    // message there is no unsending it: reporting 'failed' because a KV write
    // did not land would tell the user their message never arrived, drop it
    // out of the message's sent history, and invite a second copy.
    let out = null;
    try {
      out = (await sendMail(ctx, {
        to: recipient.email,
        subject: req.subject,
        text: plain,
        html,
        replyTo,
        attachments,
      })) || {};
    } catch (err) {
      await release();
      results.push({
        email: recipient.email,
        status: 'failed',
        reason: line((err && err.message) || 'send_failed', 200),
      });
      continue;
    }
    // One recipient per send, so these lists name this address or nobody.
    // Both outcomes leave the message unsent: don't record it as sent, or a
    // later retry would be skipped as a duplicate. Read defensively - a
    // reply that carries a count where this expects a list must not turn a
    // delivered message into a failed one.
    const named = (list) => Array.isArray(list) && list.includes(recipient.email);
    if (named(out.suppressed)) {
      await release();
      results.push({ email: recipient.email, status: 'suppressed' });
      continue;
    }
    if (named(out.failed)) {
      await release();
      results.push({ email: recipient.email, status: 'failed', reason: 'delivery_failed' });
      continue;
    }
    budget -= 1;
    sent += 1;
    cost += Number.isFinite(out.cost) ? out.cost : 0;
    const at = Date.now();
    try {
      await kv.set(key, { v: recipient.version, at });
      await expire(kv, key, SENT_TTL);
    } catch {
      /* The message is gone. The worst this costs is that pressing Send again
         on the identical message sends a second copy instead of being
         recognised as a duplicate. */
    }
    results.push({ email: recipient.email, status: 'sent', at });
  }

  await settleQuota(kv, rateKey, reservation, sent);

  return json({
    ok: true,
    version: WORKER_VERSION,
    sent,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    // Counted apart from failures: a suppressed address unsubscribed from this
    // sender's mail, which is a decision to report, not a fault to retry.
    suppressed: results.filter((r) => r.status === 'suppressed').length,
    cost,
    results,
  });
});
