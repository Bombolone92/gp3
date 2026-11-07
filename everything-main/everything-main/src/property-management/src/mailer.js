/**
 * Sending email from the app: the calling side of src/workers/email-worker.js.
 * Messages are posted through puter.workers.exec(), which forwards the
 * signed-in user's session, so every send is billed to and rate-limited as
 * that user. The worker sends one private message per recipient, so nobody
 * sees who else received it.
 */

/** The one shared, app-owned worker (deploy with npm run deploy:email-worker). */
export const EMAIL_WORKER_URL = 'https://property-management-email.puter.work';

/**
 * Recipients per request. The worker refuses more than this in one call, so
 * a long list (an announcement to a whole building) goes out in batches of
 * this size; see sendEmail. Each recipient still gets their own message.
 */
export const MAX_RECIPIENTS = 5;
/** Recipients in one compose action, across all batches. */
export const MAX_TOTAL_RECIPIENTS = 200;
// What the email worker accepts; longer is refused, never cut.
export const MAX_SUBJECT_CHARS = 200;
export const MAX_BODY_CHARS = 20_000;
export const SEND_TIMEOUT_MS = 120_000;

const puterOf = () => (typeof puter !== 'undefined' ? puter : null);

export function mailerAvailable(getPuter = puterOf) {
  const p = getPuter();
  return Boolean(p && p.workers && typeof p.workers.exec === 'function');
}

/** 64-bit FNV-1a style change detector over what one recipient will see. */
export function digest(parts) {
  const text = JSON.stringify(parts);
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// The same test the email worker applies, length included (RFC 5321 caps an
// address at 254), so an address it would drop is caught when it is typed.
export const isEmail = (s) => {
  const v = String(s || '').trim();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
};

/**
 * Normalize recipients given as strings or { name, email } objects:
 * lowercased, deduplicated, validated. Resolves { list } or { error }.
 */
export function parseRecipients(input, { max = MAX_TOTAL_RECIPIENTS } = {}) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[,;\s]+/);
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const item = typeof r === 'string' ? { email: r } : r || {};
    const email = String(item.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    if (!isEmail(email)) return { error: `"${item.email}" is not an email address.` };
    seen.add(email);
    out.push({ ...item, email, name: String(item.name || '').trim() });
  }
  if (!out.length) return { error: 'Add at least one email address.' };
  if (out.length > max) return { error: `Send to at most ${max} addresses at once.` };
  return { list: out };
}

/** Why a send did not happen, in words the user can act on. */
export function failureMessage(status, data) {
  const code = (data && data.error) || '';
  if (status === 401 || code === 'sign_in_required') return 'Sign in to Puter again to send email.';
  if (status === 429 || code === 'daily_limit') return "You've reached today's email limit. Try again tomorrow.";
  if (status === 503 || code === 'temporarily_unavailable') return 'The email service is busy. Try again in a moment, or open the message in your email app.';
  if (status === 404) return 'The email service is not available. Open the message in your email app instead.';
  if (code === 'subject_too_long') return `The subject is too long. Keep it under ${MAX_SUBJECT_CHARS} characters.`;
  if (code === 'body_too_long') return `The message is too long to email. Keep it under ${MAX_BODY_CHARS.toLocaleString('en-US')} characters.`;
  return 'Could not send the email. Try again, or open it in your email app.';
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function post(getPuter, workerUrl, payload, timeoutMs) {
  let res;
  let timer;
  try {
    res = await Promise.race([
      getPuter().workers.exec(`${workerUrl}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), timeoutMs))),
    ]);
  } catch (err) {
    if (err?.message === 'timeout') throw new Error('The email service did not answer in time. It may still go out; sending again will not create a duplicate.');
    throw new Error('Could not reach the email service. Check your connection, or open the message in your email app.');
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.ok) throw Object.assign(new Error(failureMessage(res.status, data)), { status: res.status, data });
  return data;
}

/**
 * sendEmail({ id, kind, to: [{ name, email }], subject, body, senderName, replyTo, force })
 * `id` identifies the message (the app's message record) so the worker can
 * skip recipients who already received the identical text.
 * Resolves { sent, skipped, failed, suppressed, results }; rejects with a
 * message fit for a toast when nothing could be sent.
 */
export async function sendEmail({ id, kind = 'email', to, subject, body, senderName = '', replyTo = '', force = false }, { getPuter = puterOf, workerUrl = EMAIL_WORKER_URL, timeoutMs = SEND_TIMEOUT_MS } = {}) {
  if (!mailerAvailable(getPuter)) throw new Error('Sending email needs a Puter session. Open the message in your email app instead.');
  const parsed = parseRecipients(to);
  if (parsed.error) throw new Error(parsed.error);
  if (String(subject || '').trim().length > MAX_SUBJECT_CHARS) throw new Error(failureMessage(400, { error: 'subject_too_long' }));
  if (String(body || '').trim().length > MAX_BODY_CHARS) throw new Error(failureMessage(400, { error: 'body_too_long' }));
  const total = { sent: 0, skipped: 0, failed: 0, suppressed: 0, results: [] };
  let firstError = null;
  const batches = chunk(parsed.list, MAX_RECIPIENTS);
  const fail = (batch, reason) => {
    for (const r of batch) total.results.push({ email: r.email, status: 'failed', reason });
    total.failed += batch.length;
  };
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const out = await post(
        getPuter,
        workerUrl,
        {
          message: { id: String(id), kind, senderName, senderEmail: replyTo },
          recipients: batch.map((r) => ({ email: r.email, name: r.name, version: digest([r.email, subject, body]) })),
          subject,
          body,
          force,
        },
        timeoutMs,
      );
      for (const k of ['sent', 'skipped', 'failed', 'suppressed']) total[k] += out[k] || 0;
      total.results.push(...(out.results || []));
    } catch (err) {
      firstError ??= err;
      fail(batch, err.message);
      // A daily limit or a lost session stops every later batch the same way.
      if (err.status === 401 || err.status === 429) {
        for (const rest of batches.slice(i + 1)) fail(rest, err.message);
        break;
      }
    }
  }
  if (!total.sent && !total.skipped && firstError) throw firstError;
  return total;
}

/** A recipient the daily sending limit stopped: not sent, though not an error either. */
const limited = (r) => r.status === 'skipped' && r.reason === 'daily_limit';
/** A recipient an earlier, still running try is sending to: not confirmed yet. */
const inFlight = (r) => r.status === 'skipped' && r.reason === 'in_progress';

/**
 * One-line summary of a send for a toast. `partial` is set when some
 * recipients were not reached; `ok` when at least one was (or all already
 * had it).
 */
export function describeResult(out) {
  const results = out?.results || [];
  const sent = out?.sent || 0;
  const already = results.filter((r) => r.status === 'skipped' && r.reason === 'already_sent').length;
  const stopped = results.filter(limited).length;
  const pending = results.filter(inFlight).length;
  const failed = (out?.failed || 0) + (out?.suppressed || 0) + stopped + pending;
  const why = stopped === failed ? 'could not be sent today: the daily email limit was reached' : pending === failed ? 'are still being sent by an earlier try; check the log in a minute' : 'could not be reached';
  if (sent && !failed) return { ok: true, message: `Emailed to ${sent} recipient${sent === 1 ? '' : 's'}` };
  if (!sent && already && !failed) return { ok: true, duplicate: true, message: 'They already have this exact message.' };
  if (sent && failed) return { ok: true, partial: true, message: `Emailed ${sent}, but ${failed} ${why}.` };
  if (stopped && stopped === failed) return { ok: false, message: 'The daily email limit was reached, so nothing was sent. Try again tomorrow.' };
  if (pending && pending === failed) return { ok: false, message: 'An earlier try is still sending this message. Check the log in a minute before sending again.' };
  return { ok: false, message: 'The email could not be delivered.' };
}

/** Per-recipient outcomes to keep on the message record. */
export function recipientResults(out) {
  // Someone who already had the identical message (an earlier try) has it.
  return (out?.results || []).map((r) => ({ email: r.email, status: limited(r) || inFlight(r) ? 'failed' : r.status === 'skipped' && r.reason === 'already_sent' ? 'sent' : r.status }));
}

/** mailto: link for the fallback path (no worker, or the user prefers their own app). */
export function mailtoHref({ to = [], subject = '', body = '' }) {
  const addrs = to.map((r) => (typeof r === 'string' ? r : r.email)).filter(Boolean);
  const q = new URLSearchParams();
  if (subject) q.set('subject', subject);
  if (body) q.set('body', body);
  // URLSearchParams encodes spaces as "+", which mail apps show literally.
  return `mailto:${addrs.map(encodeURIComponent).join(',')}?${q.toString().replace(/\+/g, '%20')}`;
}
