/** Opens the user's mail client with a rendered template. */
import { copyText } from './components.js';
import { toast } from './toast.js';
import { emailTemplate, mailtoUrl, MAILTO_LIMIT, renderTemplate } from '../core/emails.js';

/**
 * Compose from a stored template. When the rendered mailto is too long for
 * mail clients (offer letters), the body is copied to the clipboard and the
 * draft opens with the subject only.
 */
/**
 * Opens a draft and records it on the candidate's timeline. Returns the
 * logged event (with the candidate id) so a caller stepping through a
 * batch can offer to mark them sent, or null when no draft opened.
 */
export async function composeEmail(ctx, templateKey, candidate, vars) {
  // Trimmed, because that is the test mailtoUrl applies below: an
  // address that is only whitespace — restores keep what they are given,
  // unlike every in-app write — passed a truthiness check and then made
  // mailtoUrl return null, so the click reported a TypeError instead of
  // the plain reason it has right here.
  if (!String(candidate?.email ?? '').trim()) {
    toast('This candidate has no email address.', 'error');
    return null;
  }
  const template = emailTemplate(ctx.store.state.settings, templateKey);
  if (!template) return null;
  const company = ctx.store.state.settings.companyName || 'our team';
  const allVars = { name: candidate.name, company, ...vars };
  const subject = renderTemplate(template.subject, allVars);
  const body = renderTemplate(template.body, allVars);

  const full = mailtoUrl(candidate.email, subject, body);
  if (full.length <= MAILTO_LIMIT) {
    window.location.href = full;
    return log(ctx, candidate, templateKey, subject);
  }
  // The draft only opens with the body on the clipboard: a subject-only
  // draft after a failed copy is an invitation to send a blank offer.
  const copied = await copyText(body, 'Message copied. Paste it into the email body.');
  if (!copied) return null;
  window.location.href = mailtoUrl(candidate.email, subject, '');
  return log(ctx, candidate, templateKey, subject);
}

/**
 * The timeline entry for the draft that just opened. The profile of
 * someone written to twice used to look exactly like the profile of
 * someone never written to at all.
 */
async function log(ctx, candidate, templateKey, subject) {
  try {
    const event = await ctx.store.logEmail(candidate.id, { template: templateKey, subject });
    return { candidateId: candidate.id, eventId: event.id };
  } catch (err) {
    // The draft is already open, so this is not a failed action — but a
    // silently unrecorded email is exactly what this feature exists to
    // prevent, so say so.
    console.error(err);
    toast('The draft opened, but recording it on the timeline failed.', 'error');
    return null;
  }
}
