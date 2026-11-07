/** Offers: status machine, validation, and the plain-text offer letter. */

import { formatMoney } from '../lib/format.js';
import { formatDate, formatTimestamp, parseISODate } from '../lib/dates.js';
import { renderTemplate } from './emails.js';

export const OFFER_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  SIGNED: 'signed',
  DECLINED: 'declined',
  WITHDRAWN: 'withdrawn',
};

/** Legal moves. Signed, declined, and withdrawn are terminal. */
const TRANSITIONS = {
  draft: ['sent', 'withdrawn'],
  sent: ['signed', 'declined', 'withdrawn'],
  signed: [],
  declined: [],
  withdrawn: [],
};

export const OFFER_STATUS_LABELS = {
  draft: 'Draft',
  sent: 'Awaiting signature',
  signed: 'Signed',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** An offer still in play — at most one of these per candidate. */
export function isOpenOffer(offer) {
  return offer.status === OFFER_STATUS.DRAFT || offer.status === OFFER_STATUS.SENT;
}

/** Returns a list of human-readable problems; empty when valid. */
export function validateOffer({ salary, startDate, expires, bonus }) {
  const errors = [];
  const pay = Number(salary);
  if (!Number.isFinite(pay) || pay <= 0) errors.push('Enter a base salary.');
  if (bonus !== null && bonus !== undefined && bonus !== '') {
    const extra = Number(bonus);
    if (!Number.isFinite(extra) || extra < 0) errors.push('The signing bonus cannot be negative.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate ?? ''))) errors.push('Pick a start date.');
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(String(expires))) errors.push('The expiry date is malformed.');
  if (expires && /^\d{4}-\d{2}-\d{2}$/.test(String(startDate ?? '')) && expires > startDate) {
    errors.push('The offer should expire before the start date.');
  }
  return errors;
}

/** Sent, unanswered, and expiring within `withinDays` (or already expired). */
export function expiringOffers(offers, { withinDays = 3, now = new Date() } = {}) {
  return offers.filter((o) => {
    if (o.status !== OFFER_STATUS.SENT || !o.expires) return false;
    const msLeft = parseISODate(o.expires) - now;
    return msLeft < withinDays * 86400000;
  });
}

/**
 * The default offer letter body. Lines whose placeholders all come up
 * empty (an offer without a bonus, an unsigned letter) are dropped at
 * render time, so one template covers every offer.
 */
export const DEFAULT_OFFER_TEMPLATE = `{{sentDate}} · {{company}}

Dear {{name}},

We are delighted to offer you the position of {{job}}{{team}}. We believe your experience will make a real difference here, and we hope you feel the same.

The key terms of this offer:

  Position      {{job}}
  Base salary   {{salary}} per year
  Signing bonus {{bonus}}
  Equity        {{equity}}
  Start date    {{startDate}}

This offer remains open until {{expires}}.

{{notes}}

We are excited about what we can build together.

Warm regards,
The {{company}} team

{{signature}}`;

export const OFFER_TEMPLATE_VARIABLES = [
  'name',
  'job',
  'team',
  'company',
  'salary',
  'bonus',
  'equity',
  'startDate',
  'expires',
  'notes',
  'sentDate',
  'signature',
];

/** The effective letter template: the settings override, or the default. */
export function offerTemplate(settings) {
  const stored = settings?.offerTemplate;
  return typeof stored === 'string' && stored.trim() ? stored : DEFAULT_OFFER_TEMPLATE;
}

/** Every placeholder value the letter template can use. */
export function offerLetterVars(offer, candidate, job, { companyName = 'Our company', now = new Date() } = {}) {
  return {
    name: candidate.name,
    job: job.title,
    team: job.department ? ` on our ${job.department} team` : '',
    company: companyName,
    salary: formatMoney(offer.salary, offer.currency),
    bonus: offer.bonus ? formatMoney(offer.bonus, offer.currency) : '',
    equity: offer.equity ?? '',
    startDate: formatDate(offer.startDate, now),
    expires: offer.expires ? formatDate(offer.expires, now) : '',
    notes: offer.notes ?? '',
    sentDate: formatTimestamp(offer.sentAt, now) || 'Draft',
    signature:
      offer.status === OFFER_STATUS.SIGNED && offer.signerName
        ? `----------------------------------------\nSigned electronically by ${offer.signerName}\non ${formatTimestamp(offer.signedAt, now)}`
        : '',
  };
}

/**
 * Render a letter template: placeholders substitute, a line whose
 * placeholders all render empty is removed (that is how optional terms
 * disappear), and leftover blank runs collapse.
 */
export function renderOfferLetter(template, vars) {
  const lines = [];
  for (const line of String(template ?? '').split('\n')) {
    const placeholders = [...line.matchAll(/\{\{\s*(\w+)\s*\}\}/g)];
    // Own keys only, agreeing with renderTemplate: an inherited property
    // like {{hasOwnProperty}} must count as empty here, not keep the line.
    if (placeholders.length > 0 && placeholders.every(([, key]) => !(Object.hasOwn(vars, key) && String(vars[key] ?? '').trim()))) {
      continue;
    }
    lines.push(renderTemplate(line, vars));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The offer letter as plain text — ready to paste into a document or email.
 * E-signature flow: the letter is sent, and the recorded signature (typed
 * full name + timestamp) is stored on the offer itself. Pass `template`
 * (see offerTemplate) to apply the user's customized wording.
 */
export function offerLetterText(offer, candidate, job, { companyName = 'Our company', now = new Date(), template = DEFAULT_OFFER_TEMPLATE } = {}) {
  return renderOfferLetter(template, offerLetterVars(offer, candidate, job, { companyName, now }));
}
