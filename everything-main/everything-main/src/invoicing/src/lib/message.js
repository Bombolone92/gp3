/**
 * The messages that carry a document to a client.
 *
 * The app has no server and never will, so "send" means composing the mail
 * in the user's own client (`mailto:`) or handing them the text to paste.
 * Everything here is pure: templates in, subject and body out, so the
 * wording can be tested and edited rather than hardcoded in a view.
 */

import { docTotals, fmtMoney } from './money.js';
import { dueDateFor } from './doc.js';
import { fmtDate } from './dates.js';

/** Templates the user can edit, in the order Settings lists them. */
export const TEMPLATE_KEYS = ['invoice', 'quote', 'reminderUpcoming', 'reminderDue', 'reminderLate'];

export const TEMPLATE_LABELS = {
  invoice: 'Invoice email',
  quote: 'Estimate email',
  reminderUpcoming: 'Reminder · before the due date',
  reminderDue: 'Reminder · just overdue',
  reminderLate: 'Reminder · 30+ days late',
};

export const DEFAULT_TEMPLATES = {
  invoice: {
    subject: 'Invoice {number} from {business}',
    body: 'Hi {client},\n\n'
      + 'Invoice {number} for {total} is ready, due {dueDate}.\n\n'
      + 'View or download it here: {link}\n'
      + 'Pay online: {payLink}\n\n'
      + 'Thank you,\n{business}',
  },
  quote: {
    subject: 'Estimate {number} from {business}',
    body: 'Hi {client},\n\n'
      + 'Here is estimate {number} for {total}.\n\n'
      + 'View it here: {link}\n'
      + 'This estimate is valid until {validUntil}.\n\n'
      + 'Let me know if you have any questions.\n\n'
      + '{business}',
  },
  // Reminders escalate in tone, not in volume: the balance, the date, and a
  // way to pay are what actually gets an invoice settled.
  reminderUpcoming: {
    subject: 'Invoice {number} is due {dueDate}',
    body: 'Hi {client},\n\n'
      + 'A friendly reminder that invoice {number} for {balance} is due {dueDate}.\n\n'
      + 'View or download it here: {link}\n'
      + 'Pay online: {payLink}\n\n'
      + 'Thank you,\n{business}',
  },
  reminderDue: {
    subject: 'Reminder: invoice {number} is overdue',
    body: 'Hi {client},\n\n'
      + 'Invoice {number} for {balance} was due {dueDate}, so it is now {days} overdue. '
      + 'If it is already on its way, please ignore this note.\n\n'
      + 'View or download it here: {link}\n'
      + 'Pay online: {payLink}\n\n'
      + 'Thank you,\n{business}',
  },
  reminderLate: {
    subject: 'Second reminder: invoice {number} is {days} overdue',
    body: 'Hi {client},\n\n'
      + 'Invoice {number} for {balance} is now {days} overdue and still unpaid.\n\n'
      + 'Could you let me know when it will be settled, or tell me if something is holding it up?\n\n'
      + 'View or download it here: {link}\n'
      + 'Pay online: {payLink}\n\n'
      + 'Thank you,\n{business}',
  },
};

/** Placeholders offered for a template, as the Settings legend lists them. */
export function placeholdersFor(key) {
  const common = [
    ['number', 'document number'],
    ['client', 'client name'],
    ['business', 'your business name'],
    ['total', 'document total'],
    ['link', 'link to the online copy'],
  ];
  if (key === 'quote') return [...common, ['validUntil', 'valid-until date'], ['issueDate', 'issue date']];
  const invoiceKeys = [
    ...common,
    ['balance', 'amount still due'],
    ['dueDate', 'due date'],
    ['payLink', 'pay-online link'],
    ['issueDate', 'issue date'],
  ];
  if (key === 'reminderUpcoming') return [...invoiceKeys, ['daysUntil', 'time left, e.g. “3 days”']];
  if (key.startsWith('reminder')) return [...invoiceKeys, ['days', 'how late it is, e.g. “12 days”']];
  return invoiceKeys;
}

/** The user's template for a key, falling back to the shipped default. */
export function templateFor(settings, key) {
  const fallback = DEFAULT_TEMPLATES[key] || DEFAULT_TEMPLATES.invoice;
  const saved = settings?.templates?.[key];
  return {
    subject: typeof saved?.subject === 'string' && saved.subject.trim() ? saved.subject : fallback.subject,
    body: typeof saved?.body === 'string' && saved.body.trim() ? saved.body : fallback.body,
  };
}

/** Every template, defaults filled in — the shape the Settings editor works on. */
export function allTemplates(settings) {
  return Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, templateFor(settings, k)]));
}

/**
 * Substitute {placeholders} in a body.
 *
 * A line holding a placeholder that has no value is left out entirely, which
 * is what makes one template work for an invoice with a pay link and one
 * without: put the optional parts on their own lines. Unknown placeholders
 * are left visible, so a typo shows up instead of silently deleting text —
 * and "unknown" is measured against the values themselves, never what every
 * object inherits: `key in values` counted {constructor} and {toString} as
 * known and pasted a lump of JavaScript source into the message.
 */
export function fillTemplate(text, values = {}) {
  const kept = [];
  for (const line of String(text ?? '').split('\n')) {
    let empty = false;
    const filled = line.replace(/\{(\w+)\}/g, (match, key) => {
      if (!Object.hasOwn(values, key)) return match;
      const value = values[key];
      if (value === null || value === undefined || value === '') { empty = true; return ''; }
      return String(value);
    });
    if (empty) continue;
    kept.push(filled.replace(/[ \t]+$/, ''));
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Subjects are one line: substitute, then tidy the spacing. */
export function fillSubject(text, values = {}) {
  return String(text ?? '')
    .replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(values, key) ? String(values[key] ?? '') : match))
    .replace(/\s+/g, ' ')
    .trim();
}

/** What a client is called in a greeting. */
export function clientGreeting(client) {
  return (client?.name || client?.company || '').trim() || 'there';
}

/**
 * The placeholder values for one document.
 * `link` is the public share URL and `payLink` the checkout URL; either may
 * be empty, and the lines carrying them then drop out of the message.
 */
export function messageValues(doc, client, settings, { link = '', payLink = '', extra = {} } = {}) {
  const t = docTotals(doc);
  const isInvoice = doc.kind === 'invoice';
  const dueDate = isInvoice ? dueDateFor(doc) : '';
  return {
    number: doc.number || '',
    client: clientGreeting(client),
    business: (settings?.business?.name || '').trim(),
    total: fmtMoney(t.total, doc.currency),
    balance: fmtMoney(t.balance, doc.currency),
    // Invoices always say something about timing; the paper says "on
    // receipt" when there is no due date, so the message matches it. On an
    // invoice split into installments the date that matters is the earliest
    // one still open — the same date {days} counts from, and the one the
    // statement flags as overdue — so a reminder cannot say "was due
    // 31 Dec, so it is now 201 days overdue".
    dueDate: isInvoice ? (dueDate ? fmtDate(dueDate) : 'on receipt') : '',
    validUntil: !isInvoice && doc.validUntil ? fmtDate(doc.validUntil) : '',
    issueDate: doc.issueDate ? fmtDate(doc.issueDate) : '',
    link: link || '',
    payLink: payLink || '',
    ...extra,
  };
}

/**
 * buildMessage(doc, client, settings, { link, payLink, templateKey, extra })
 * -> { subject, body }
 */
export function buildMessage(doc, client, settings, opts = {}) {
  const key = opts.templateKey || (doc.kind === 'quote' ? 'quote' : 'invoice');
  const tpl = templateFor(settings, key);
  const values = messageValues(doc, client, settings, opts);
  return {
    subject: fillSubject(tpl.subject, values),
    body: fillTemplate(tpl.body, values),
  };
}

/**
 * A mailto: URL for one recipient. The address is stripped of anything that
 * could end the field early and smuggle in extra headers, and the parts are
 * percent-encoded (never form-encoded: a '+' for a space would show up
 * literally in some mail clients).
 */
export function mailtoUrl({ to = '', subject = '', body = '' } = {}) {
  // '#' belongs in the strip set too: it starts the URL fragment, which
  // would swallow the ?subject=&body= that follow and silently discard
  // the composed message.
  const address = String(to).trim().replace(/[\s<>()[\]:;,"?&%#]/g, '');
  const query = [
    subject ? `subject=${encodeURIComponent(subject)}` : '',
    body ? `body=${encodeURIComponent(body)}` : '',
  ].filter(Boolean).join('&');
  return `mailto:${address}${query ? `?${query}` : ''}`;
}

/** Loose sanity check for the To field; mail clients own the real rules. The
 *  length cap is the worker's (src/workers/email-worker.js lowerEmail): an
 *  address past it is dropped there without a word, so it is refused here. */
export function looksLikeEmail(value) {
  const s = String(value || '').trim();
  return s.length <= 254 && /^[^\s@,;]+@[^\s@,;.]+\.[^\s@,;]+$/.test(s);
}
