/**
 * Status rules. Most statuses are derived from the record and today's date
 * instead of being stored, so they can never go stale ("Late" becomes true
 * at midnight without anyone touching the job).
 *
 * Each status has a label and a tone the UI maps to a color:
 * neutral | info | success | warning | danger | accent
 */
import { computeTotals, amountPaid } from './totals.js';

export const STATUS_META = {
  // Requests
  new: { label: 'New', tone: 'info' },
  assessment_scheduled: { label: 'Assessment scheduled', tone: 'accent' },
  assessment_overdue: { label: 'Overdue', tone: 'danger' },
  assessment_complete: { label: 'Assessment complete', tone: 'success' },
  converted: { label: 'Converted', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
  // Quotes
  draft: { label: 'Draft', tone: 'neutral' },
  awaiting_response: { label: 'Awaiting response', tone: 'warning' },
  changes_requested: { label: 'Changes requested', tone: 'danger' },
  approved: { label: 'Approved', tone: 'success' },
  // Jobs
  unscheduled: { label: 'Unscheduled', tone: 'warning' },
  late: { label: 'Late', tone: 'danger' },
  today: { label: 'Today', tone: 'accent' },
  upcoming: { label: 'Upcoming', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  requires_invoicing: { label: 'Requires invoicing', tone: 'warning' },
  completed: { label: 'Completed', tone: 'neutral' },
  // Invoices
  awaiting_payment: { label: 'Awaiting payment', tone: 'info' },
  past_due: { label: 'Past due', tone: 'danger' },
  paid: { label: 'Paid', tone: 'success' },
  bad_debt: { label: 'Bad debt', tone: 'neutral' },
  // Clients
  lead: { label: 'Lead', tone: 'info' },
  client_active: { label: 'Active', tone: 'success' },
};

export function statusLabel(status) {
  return STATUS_META[status]?.label ?? status;
}

export function statusTone(status) {
  return STATUS_META[status]?.tone ?? 'neutral';
}

export function requestStatus(req, today) {
  if (req.archived) return 'archived';
  if (req.convertedTo) return 'converted';
  const a = req.assessment;
  if (a?.completedAt) return 'assessment_complete';
  if (a?.date) return a.date < today ? 'assessment_overdue' : 'assessment_scheduled';
  return 'new';
}

export function quoteStatus(quote) {
  if (quote.archived) return 'archived';
  if (quote.jobId) return 'converted';
  return quote.status || 'draft';
}

/** Visits that still need doing, sorted by date. */
export function openVisits(job) {
  return (job.visits || []).filter((v) => !v.completedAt).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

export function isJobComplete(job) {
  if (job.closedAt) return true;
  const visits = job.visits || [];
  return visits.length > 0 && visits.every((v) => v.completedAt);
}

// Lookups built once per list, as amountPaid does: the store hands out a new
// list whenever a collection changes, so a cached set never goes stale, and
// a status for every job or client no longer rescans every invoice.
const setsByList = new WeakMap();
function idSet(list, key) {
  let byKey = setsByList.get(list);
  if (!byKey) setsByList.set(list, (byKey = new Map()));
  let set = byKey.get(key);
  if (!set) {
    set = new Set(key === 'jobIds' ? list.flatMap((r) => r.jobIds || []) : list.map((r) => r[key]));
    byKey.set(key, set);
  }
  return set;
}

/**
 * invoices: the invoices collection (used to tell whether the job was
 * billed). A job counts as invoiced as soon as any invoice lists it, a
 * draft included: the next step then belongs to the invoice.
 */
export function jobStatus(job, today, invoices = []) {
  if (job.archived) return 'archived';
  const invoiced = idSet(invoices, 'jobIds').has(job.id);
  // Per-visit jobs are billed as they go: any finished visit not billed yet.
  const unbilled = job.billing === 'per_visit' && (job.visits || []).some((v) => v.completedAt && !v.invoiceId);
  if (isJobComplete(job)) {
    // A per-visit job bills its visits one by one: once none is left
    // unbilled (closed before any visit was done included) it is done.
    if (job.billing === 'per_visit') return unbilled ? 'requires_invoicing' : 'completed';
    return invoiced || job.billing === 'none' ? 'completed' : 'requires_invoicing';
  }
  const open = openVisits(job);
  const dated = open.filter((v) => v.date);
  if (dated.some((v) => v.date < today)) return 'late';
  if (unbilled) return 'requires_invoicing';
  if (!dated.length) return 'unscheduled';
  if (dated.some((v) => v.date === today)) return 'today';
  if (dated[0].date > today) return 'upcoming';
  return 'active';
}

/** What a job waiting to be invoiced will bill: per-visit jobs bill each finished, unbilled visit. */
export function amountToInvoice(job) {
  const { total } = computeTotals(job);
  if (job.billing !== 'per_visit') return total;
  return total * (job.visits || []).filter((v) => v.completedAt && !v.invoiceId).length;
}

export function invoiceBalance(invoice, payments) {
  const { total } = computeTotals(invoice);
  return total - amountPaid(invoice.id, payments);
}

export function invoiceStatus(invoice, today, payments = []) {
  if (invoice.badDebt) return 'bad_debt';
  if (!invoice.sentAt && invoice.status !== 'sent') {
    // A draft that already got paid in full still reads as paid.
    const { total } = computeTotals(invoice);
    if (total > 0 && amountPaid(invoice.id, payments) >= total) return 'paid';
    return 'draft';
  }
  const balance = invoiceBalance(invoice, payments);
  if (balance <= 0) return 'paid';
  if (invoice.dueDate && invoice.dueDate < today) return 'past_due';
  return 'awaiting_payment';
}

export function clientStatus(client, { jobs = [], invoices = [] } = {}) {
  if (client.archived) return 'archived';
  const hasWork = idSet(jobs, 'clientId').has(client.id) || idSet(invoices, 'clientId').has(client.id);
  return hasWork ? 'client_active' : 'lead';
}
