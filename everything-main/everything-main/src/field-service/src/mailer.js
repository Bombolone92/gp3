/**
 * Emailing a quote or invoice from the app: the calling side of
 * src/workers/email-worker.js. The message is posted through
 * puter.workers.exec(), which forwards the signed-in user's session, so every
 * send is billed to and rate-limited as that user.
 */

/** The one shared, app-owned worker (deploy with npm run deploy:email-worker). */
export const EMAIL_WORKER_URL = 'https://field-service-email.puter.work';
export const MAX_RECIPIENTS = 5;
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

export function parseRecipients(input) {
  const seen = new Set();
  const out = [];
  for (const raw of String(input || '').split(/[,;\s]+/)) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: `"${raw}" is not an email address.` };
    seen.add(email);
    out.push(email);
  }
  if (!out.length) return { error: 'Add at least one email address.' };
  if (out.length > MAX_RECIPIENTS) return { error: `Send to at most ${MAX_RECIPIENTS} addresses at once.` };
  return { list: out };
}

/** Why a send did not happen, in words the user can act on. */
export function failureMessage(status, data) {
  const code = (data && data.error) || '';
  if (status === 401 || code === 'sign_in_required') return 'Sign in to Puter again to send email.';
  if (status === 429 || code === 'daily_limit') return "You've reached today's email limit. Try again tomorrow.";
  if (status === 503 || code === 'temporarily_unavailable') return 'The email service is busy. Try again in a moment, or open the message in your email app.';
  if (status === 404) return 'The email service is not available. Open the message in your email app instead.';
  return 'Could not send the email. Try again, or open it in your email app.';
}

/**
 * sendDocument({ kind, doc, settings, to: [emails], subject, body, force })
 * Resolves the worker's summary; rejects with a message fit for a toast.
 */
export async function sendDocument({ kind, doc, settings, to, subject, body, force = false }, { getPuter = puterOf, workerUrl = EMAIL_WORKER_URL, timeoutMs = SEND_TIMEOUT_MS } = {}) {
  if (!mailerAvailable(getPuter)) throw new Error('Sending email needs a Puter session. Open the message in your email app instead.');
  const recipients = to.map((email) => ({ email, version: digest([email, subject, body]) }));
  const request = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      document: {
        id: doc.id,
        number: String(doc.number || ''),
        kind,
        businessName: settings?.company?.name || '',
        businessEmail: settings?.company?.email || '',
      },
      recipients,
      subject,
      body,
      force,
    }),
  };
  let res;
  let timer;
  try {
    res = await Promise.race([
      getPuter().workers.exec(`${workerUrl}/send`, request),
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), timeoutMs))),
    ]);
  } catch (err) {
    if (err?.message === 'timeout') throw new Error('The email service did not answer in time. It may still go out; sending again will not create a duplicate.');
    throw new Error('Could not reach the email service. Check your connection, or open the message in your email app.');
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.ok) throw new Error(failureMessage(res.status, data));
  return data;
}

/**
 * One-line summary of a send for a toast, plus the addresses that have the
 * message (sent now or before), which are the only ones to record as emailed.
 */
export function describeResult(out) {
  const results = out?.results || [];
  const sent = out?.sent || 0;
  const already = results.filter((r) => r.status === 'skipped' && r.reason === 'already_sent').length;
  const limited = results.filter((r) => r.status === 'skipped' && r.reason === 'daily_limit').length;
  const failed = (out?.failed || 0) + (out?.suppressed || 0);
  const delivered = results.filter((r) => r.status === 'sent' || (r.status === 'skipped' && r.reason === 'already_sent')).map((r) => r.email);
  const notes = [failed ? `${failed} could not be reached` : '', limited ? `${limited} not sent because today's email limit was reached` : ''].filter(Boolean).join(', and ');
  if (sent && !notes) return { ok: true, delivered, message: `Emailed to ${sent} recipient${sent === 1 ? '' : 's'}` };
  if (!sent && already && !notes) return { ok: true, delivered, duplicate: true, message: 'They already have this exact message.' };
  if (sent) return { ok: true, partial: true, delivered, message: `Emailed ${sent}, but ${notes}.` };
  if (limited && !failed) return { ok: false, delivered, message: "Today's email limit was reached. Try again tomorrow, or open the message in your email app." };
  return { ok: false, delivered, message: 'The email could not be delivered.' };
}
