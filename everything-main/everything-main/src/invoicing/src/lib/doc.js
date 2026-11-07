/**
 * Document logic shared by views, the store, and tests.
 *
 * Stored status is deliberately minimal, everything else derives:
 *   invoice: 'draft' | 'sent' | 'void'   (paid/partial/overdue/writtenOff
 *                                         derive from payments, the due date,
 *                                         and doc.writeOff)
 *   quote:   'draft' | 'sent' | 'accepted' | 'declined'
 *                                        (expired/invoiced derive from the
 *                                         valid-until date and the link)
 */

import { round2 } from './util.js';
import { docTotals } from './money.js';
import { yearOf, todayISO } from './dates.js';

/**
 * The named taxes settings prescribe for new documents. An account that
 * predates the list (or emptied it) falls back to the single default
 * rate/label pair, which Settings keeps in step with the list's first entry.
 */
export function settingsTaxes(settings) {
  if (Array.isArray(settings?.taxes) && settings.taxes.length) {
    return settings.taxes
      .map((t) => ({ label: String(t.label || '').trim(), rate: Number(t.rate) || 0 }))
      .filter((t) => t.rate > 0);
  }
  const rate = Number(settings?.taxRate) || 0;
  return rate > 0 ? [{ label: settings?.taxLabel || 'Tax', rate }] : [];
}

/**
 * Where a new document's taxes start. A client's single-rate override
 * replaces the whole list — it exists for the simple situations ("this
 * client is tax-exempt", "this client is billed at 8%"), and zero is a real
 * answer, exactly as in billingDefaults().
 */
export function defaultTaxes(settings, client = null) {
  const override = client?.taxRate;
  if (override !== '' && override !== null && override !== undefined
    && Number.isFinite(Number(override))) {
    const rate = Math.min(100, Math.max(0, Number(override)));
    return rate > 0 ? [{ label: settings?.taxLabel || 'Tax', rate }] : [];
  }
  return settingsTaxes(settings);
}

export const KIND = {
  invoice: { label: 'Invoice', plural: 'Invoices' },
  quote: { label: 'Estimate', plural: 'Estimates' },
};

/**
 * Has this invoice been given up on? A write-off says "this was genuinely
 * billed and will never be paid", which is a different statement from Void
 * ("this should never have existed") — the money stays invoiced, it just
 * stops being owed. Absent means today's behavior exactly.
 */
export function isWrittenOff(doc) {
  return !!doc?.writeOff && typeof doc.writeOff === 'object';
}

/**
 * The date this invoice is measured late against: the earliest installment
 * still open when it carries a payment schedule, its own due date otherwise.
 * An invoice whose every installment is settled but which still owes
 * something (a late fee added afterwards) falls back to the last installment,
 * then to the invoice's own date — there is always a date to be late against.
 */
export function dueDateFor(doc, installments = null) {
  const rows = installments || (Array.isArray(doc?.schedule) ? docTotals(doc).installments : []);
  if (rows.length) {
    const next = rows.find((r) => r.open > 0.005);
    return next?.dueDate || rows[rows.length - 1].dueDate || doc?.dueDate || '';
  }
  return doc?.dueDate || '';
}

/**
 * Display status of a document as of `today` ('YYYY-MM-DD').
 *
 * Without a date, the two readings that depend on the clock — overdue and
 * expired — are never reached, and what comes back is what the document says
 * about itself: paid, void, accepted, declined. That is the reading a static
 * rendering wants (the public share page is written once and read for weeks),
 * because it changes only when the document does, and every such change
 * republishes the page.
 */
export function docStatus(doc, today = null) {
  if (doc.kind === 'quote') {
    if (doc.invoiceId) return 'invoiced';
    if (doc.status === 'accepted' || doc.status === 'declined' || doc.status === 'draft') return doc.status;
    if (today && doc.validUntil && doc.validUntil < today) return 'expired';
    return 'sent';
  }
  if (doc.status === 'void') return 'void';
  if (doc.status === 'draft') return 'draft';
  const { paid, balance, installments } = docTotals(doc);
  // Nothing left to collect is settled, whatever brought it to zero: money
  // received, or an invoice that asked for nothing in the first place (a
  // whole-invoice discount, a complimentary line). Reading those as overdue
  // left them in the red badge for good, with no way to ever clear them.
  if (balance <= 0.005) return 'paid';
  // Settled first, written off second: if the money did arrive after all,
  // the invoice is paid, whatever was once given up on — and reports read
  // the same way, counting only what is still unpaid as written off.
  if (isWrittenOff(doc)) return 'writtenOff';
  // On a payment plan the invoice is late as soon as the earliest unpaid
  // installment's date has passed, not when the final one has: the whole
  // point of the plan is that each part has its own deadline.
  const dueBy = dueDateFor(doc, installments);
  if (today && dueBy && dueBy < today) return 'overdue';
  if (paid > 0.005) return 'partial';
  return 'sent';
}

/**
 * Status metadata for rendering. `tone` maps to a CSS class; labels are
 * always shown as text beside the tone so color never carries the meaning
 * alone.
 */
export const STATUS_META = {
  draft: { label: 'Draft', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'info' },
  partial: { label: 'Partly paid', tone: 'warn' },
  paid: { label: 'Paid', tone: 'ok' },
  overdue: { label: 'Overdue', tone: 'bad' },
  void: { label: 'Void', tone: 'neutral' },
  // Neutral, not bad: a write-off is a decision that has been taken, not a
  // problem still waiting on the user.
  writtenOff: { label: 'Written off', tone: 'neutral' },
  accepted: { label: 'Accepted', tone: 'ok' },
  declined: { label: 'Declined', tone: 'bad' },
  expired: { label: 'Expired', tone: 'warn' },
  invoiced: { label: 'Invoiced', tone: 'ok' },
};

/**
 * The longest payment terms (or estimate validity) the app will honour: ten
 * years of days. There has to be a ceiling somewhere, because far enough out
 * a date stops existing at all — and the paper would then carry a due date
 * of 'NaN-NaN-NaN' rather than refuse the number.
 */
export const MAX_TERM_DAYS = 3650;

/**
 * A stored term as a usable number of days. Zero is a real answer ("due on
 * receipt"), so only a missing or unusable value falls back.
 */
export function termDays(value, fallback = 14) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(n)) return fallback;
  return Math.min(MAX_TERM_DAYS, Math.max(0, Math.round(n)));
}

/**
 * 'INV-' + 7 -> 'INV-0007'. Wide numbers keep their full width. A {YYYY}
 * token in the prefix resolves to the issue year — 'INV-{YYYY}-' numbers as
 * 'INV-2026-0007' — from `dateISO` when given, today otherwise, so a
 * backdated document is numbered for the year it belongs to.
 */
export function formatDocNumber(prefix, n, dateISO = null) {
  const resolved = String(prefix || '').replaceAll('{YYYY}', yearOf(dateISO || todayISO()));
  return `${resolved}${String(Math.max(1, Math.floor(Number(n) || 1))).padStart(4, '0')}`;
}

/**
 * An invoice is "open" when money is still expected on it: it has been
 * issued, is not void, is not written off, and carries a balance.
 */
export function isOpenInvoice(doc, today) {
  if (doc.kind !== 'invoice') return false;
  const s = docStatus(doc, today);
  return s === 'sent' || s === 'partial' || s === 'overdue';
}

/**
 * Where you stand with one client, per currency: what you have billed them
 * (drafts excluded — nothing was sent yet), what they have paid, and what is
 * still owed. Void invoices count for nothing, and estimates are not money.
 * A written-off invoice was still billed, so it stays in `billed` and leaves
 * `open` — which is the whole difference between writing off and voiding.
 */
export function clientTotals(docs, today) {
  const billed = {};
  const collected = {};
  const open = {};
  const add = (map, currency, value) => {
    map[currency] = round2((map[currency] || 0) + value);
  };
  for (const doc of docs || []) {
    if (doc.kind !== 'invoice' || doc.status === 'void') continue;
    const t = docTotals(doc);
    if (doc.status !== 'draft') add(billed, doc.currency, t.total);
    if (Math.abs(t.paid) > 0.005) add(collected, doc.currency, t.paid);
    if (isOpenInvoice(doc, today)) add(open, doc.currency, t.balance);
  }
  return { billed, collected, open };
}

/** Does a document belong in this slice of a client's history? */
export function matchesClientFilter(doc, filter, today) {
  if (filter === 'all') return true;
  if (filter === 'quote') return doc.kind === 'quote';
  if (filter === 'open') return isOpenInvoice(doc, today);
  const status = docStatus(doc, today);
  if (filter === 'paid') return doc.kind === 'invoice' && status === 'paid';
  return status === filter;
}

/**
 * Where a new document starts: the global defaults, with a client's own
 * billing overrides applied where they have any.
 *
 * An empty override inherits, but a zero does not: a tax-exempt client is
 * exactly the case this exists for, so `taxRate: 0` has to survive.
 */
export function billingDefaults(settings, client = null) {
  const s = settings || {};
  const number = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const currency = typeof client?.currency === 'string' && client.currency.trim()
    ? client.currency.trim()
    : (s.currency || 'USD');
  const taxRate = number(client?.taxRate) ?? (number(s.taxRate) ?? 0);
  const terms = number(client?.paymentTermsDays) ?? (number(s.paymentTermsDays) ?? 14);
  const notes = typeof client?.notes === 'string' && client.notes.trim()
    ? client.notes
    : (s.defaultNotes || '');
  return {
    currency,
    taxRate: Math.min(100, Math.max(0, taxRate)),
    paymentTermsDays: termDays(terms),
    notes,
  };
}

/**
 * Copies of line items that share nothing with their source: an item's own
 * `taxes` list is an array of row objects, and a spread of the item alone
 * would leave source and copy holding the same one — a later in-place edit
 * of either would quietly change the other.
 */
export function copyItems(items) {
  return (items || []).map((it) => ({
    ...it,
    ...(Array.isArray(it.taxes) ? { taxes: it.taxes.map((t) => ({ ...t })) } : {}),
  }));
}

/** Build the invoice produced by converting a quote. Pure; ids come from the caller. */
export function invoiceFromQuote(quote, { id, number, issueDate, dueDate }) {
  return {
    id,
    kind: 'invoice',
    number,
    clientId: quote.clientId,
    issueDate,
    dueDate,
    currency: quote.currency,
    items: copyItems(quote.items),
    taxRate: quote.taxRate || 0,
    ...(Array.isArray(quote.taxes) ? { taxes: quote.taxes.map((t) => ({ ...t })) } : {}),
    taxInclusive: !!quote.taxInclusive,
    discountType: quote.discountType || 'none',
    discountValue: quote.discountValue || 0,
    // The client's PO number belongs to the engagement, not the paper it
    // started on: the invoice their AP department pays must carry it too.
    reference: quote.reference || '',
    // An accepted quote's deposit is the whole point of asking for one on
    // the estimate: the invoice it becomes asks for the same money up front.
    deposit: quote.deposit ? { ...quote.deposit } : null,
    ...(Array.isArray(quote.schedule)
      ? { schedule: quote.schedule.map((r) => ({ ...r })) }
      : {}),
    language: quote.language || '',
    // The sentence a zero-tax document is required to carry is a choice made
    // on this document: 'none' says "these papers carry no such sentence",
    // and dropping it made the invoice fall back to the client's or the
    // account's wording — printing a zero-rating claim the estimate had
    // deliberately switched off.
    taxNote: quote.taxNote || '',
    // Likewise the rate the user typed for this engagement. A starting point,
    // editable like every other field carried over; without it the invoice
    // comes back with none and quietly drops out of the consolidated figures.
    ...(Number(quote.fxRate) > 0 ? { fxRate: Number(quote.fxRate) } : {}),
    notes: quote.notes || '',
    status: 'draft',
    payments: [],
    quoteId: quote.id,
  };
}
