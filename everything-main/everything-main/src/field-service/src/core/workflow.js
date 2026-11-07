/**
 * The work pipeline: request -> quote -> job (visits) -> invoice -> payment.
 * Pure operations on a store, shared by every view so a conversion behaves
 * the same no matter where it starts.
 */
import { newId } from './ids.js';
import { addDays, today as localToday } from './dates.js';
import { generateVisitDates } from './recurrence.js';
import { termDays } from './settings.js';
import { computeTotals } from './totals.js';
import { invoiceBalance } from './status.js';

const cloneItems = (items = []) => items.map((it) => ({ ...it, id: newId() }));

// Conversions wait on the network for a document number; a second click in
// that window must not create a second job or invoice.
const busy = new Map();
function once(key, fn) {
  if (busy.has(key)) return busy.get(key);
  const p = Promise.resolve()
    .then(fn)
    .finally(() => busy.delete(key));
  busy.set(key, p);
  return p;
}

/**
 * Apply what a form changed (before -> after) onto the record as it is now,
 * so saving an edit page does not undo changes made elsewhere meanwhile
 * (sent from another device, a visit completed, a note added).
 */
export function applyEdits(current, before, after) {
  const out = { ...current };
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;
    if (after[k] === undefined) delete out[k];
    else out[k] = after[k];
  }
  return out;
}

export function blankItem(product) {
  if (!product) return { id: newId(), name: '', description: '', qty: 1, unitPrice: 0, unitCost: 0, taxable: true };
  return {
    id: newId(),
    productId: product.id,
    name: product.name,
    description: product.description || '',
    qty: 1,
    unitPrice: product.unitPrice || 0,
    unitCost: product.unitCost || 0,
    taxable: product.taxable !== false,
  };
}

/** Default tax rate from settings, as a number. */
export function defaultTaxRate(settings) {
  const t = (settings.taxes || []).find((x) => x.id === settings.defaultTaxId);
  return t ? Number(t.rate) || 0 : 0;
}

/**
 * Visits for a job schedule. Completed visits are always kept; open ones are
 * regenerated from the schedule, reusing ids for dates that already had a
 * visit so links (and per-visit notes) survive a schedule change.
 */
export function buildVisits(schedule, assignees = [], existing = [], today = localToday()) {
  const kept = existing.filter((v) => v.completedAt || v.invoiceId);
  const open = new Map(existing.filter((v) => !v.completedAt && !v.invoiceId && v.date).map((v) => [v.date, v]));
  if (!schedule?.start) {
    // Unscheduled: keep exactly one undated placeholder visit.
    const placeholder = existing.find((v) => !v.date && !v.completedAt) || { id: newId(), date: null, start: '', end: '', assignees, completedAt: null };
    return [...kept, { ...placeholder, assignees }];
  }
  const keptDates = new Set(kept.map((v) => v.date));
  // Up to the last finished visit (and never past today) the schedule is
  // history: a visit moved to another day or deleted there is not brought
  // back as a late one.
  const lastKept = kept.reduce((max, v) => (v.date && v.date > max && v.date < today ? v.date : max), '');
  // A one-off job's single visit moves with its date, keeping its id and notes.
  const lone = (schedule.repeat || 'none') === 'none' ? existing.filter((v) => !v.completedAt && !v.invoiceId) : [];
  const visits = [...kept];
  for (const date of generateVisitDates(schedule)) {
    if (keptDates.has(date)) continue;
    const prev = open.get(date) || (lone.length === 1 ? lone[0] : null);
    if (!prev && date < lastKept) continue;
    visits.push({
      id: prev?.id || newId(),
      date,
      start: schedule.anytime ? '' : schedule.startTime || '',
      end: schedule.anytime ? '' : schedule.endTime || '',
      assignees: [...assignees],
      completedAt: null,
      notes: prev?.notes || '',
    });
  }
  return visits.sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
}

export async function createQuote(store, data = {}) {
  const settings = store.state.settings;
  const number = await store.nextNumber('quotes');
  return store.put('quotes', {
    number,
    clientId: data.clientId || null,
    propertyId: data.propertyId || null,
    title: data.title || '',
    items: data.items?.length ? data.items : [blankItem()],
    taxRate: data.taxRate ?? defaultTaxRate(settings),
    discount: data.discount || null,
    deposit: data.deposit || null,
    message: data.message ?? settings.quotes.message,
    disclaimer: data.disclaimer ?? settings.quotes.disclaimer,
    notes: data.notes || '',
    status: 'draft',
    requestId: data.requestId || null,
    ...data.extra,
  });
}

export async function createJob(store, data = {}) {
  const settings = store.state.settings;
  const number = await store.nextNumber('jobs');
  const schedule = data.schedule || { start: null, repeat: 'none' };
  const assignees = data.assignees || [];
  return store.put('jobs', {
    number,
    clientId: data.clientId || null,
    propertyId: data.propertyId || null,
    title: data.title || '',
    instructions: data.instructions || '',
    schedule,
    assignees,
    items: data.items?.length ? data.items : [],
    taxRate: data.taxRate ?? defaultTaxRate(settings),
    discount: data.discount || null,
    billing: data.billing || settings.jobs?.defaultBilling || 'on_completion',
    quoteId: data.quoteId || null,
    requestId: data.requestId || null,
    notes: data.notes || '',
    visits: buildVisits(schedule, assignees, []),
  });
}

export async function createInvoice(store, data = {}) {
  const settings = store.state.settings;
  const number = await store.nextNumber('invoices');
  const issueDate = data.issueDate || data.today;
  const terms = data.terms || settings.invoices.terms;
  return store.put('invoices', {
    number,
    clientId: data.clientId || null,
    propertyId: data.propertyId || null,
    jobIds: data.jobIds || [],
    visitIds: data.visitIds || [],
    subject: data.subject || 'For services rendered',
    items: data.items?.length ? data.items : [blankItem()],
    taxRate: data.taxRate ?? defaultTaxRate(settings),
    discount: data.discount || null,
    issueDate,
    terms,
    dueDate: data.dueDate || addDays(issueDate, termDays(terms) ?? 30),
    message: data.message ?? settings.invoices.message,
    disclaimer: data.disclaimer ?? settings.invoices.disclaimer,
    notes: data.notes || '',
    sentAt: null,
  });
}

export function requestToQuote(store, requestId) {
  return once(`req:${requestId}`, () => requestToQuoteNow(store, requestId));
}

async function requestToQuoteNow(store, requestId) {
  const req = store.get('requests', requestId);
  if (req?.convertedTo?.type === 'quote' && store.get('quotes', req.convertedTo.id)) return store.get('quotes', req.convertedTo.id);
  if (!req) return null;
  const quote = await createQuote(store, {
    clientId: req.clientId,
    propertyId: req.propertyId,
    title: req.title,
    notes: req.details ? `From request: ${req.details}` : '',
    requestId: req.id,
  });
  store.patch('requests', req.id, { convertedTo: { type: 'quote', id: quote.id } });
  return quote;
}

export function requestToJob(store, requestId) {
  return once(`req:${requestId}`, () => requestToJobNow(store, requestId));
}

async function requestToJobNow(store, requestId) {
  const req = store.get('requests', requestId);
  if (req?.convertedTo?.type === 'job' && store.get('jobs', req.convertedTo.id)) return store.get('jobs', req.convertedTo.id);
  if (!req) return null;
  const job = await createJob(store, {
    clientId: req.clientId,
    propertyId: req.propertyId,
    title: req.title,
    instructions: req.details || '',
    requestId: req.id,
  });
  store.patch('requests', req.id, { convertedTo: { type: 'job', id: job.id } });
  return job;
}

/** Approved quote -> job. Optional items the client did not pick are dropped. */
export function quoteToJob(store, quoteId) {
  return once(`quote:${quoteId}`, () => quoteToJobNow(store, quoteId));
}

async function quoteToJobNow(store, quoteId) {
  const quote = store.get('quotes', quoteId);
  if (!quote) return null;
  if (quote.jobId && store.get('jobs', quote.jobId)) return store.get('jobs', quote.jobId);
  const items = cloneItems((quote.items || []).filter((it) => !it.optional || it.selected)).map((it) => ({ ...it, optional: false, selected: undefined }));
  const job = await createJob(store, {
    clientId: quote.clientId,
    propertyId: quote.propertyId,
    title: quote.title,
    items,
    taxRate: quote.taxRate,
    discount: quote.discount,
    quoteId: quote.id,
    requestId: quote.requestId,
    notes: quote.notes,
  });
  store.patch('quotes', quote.id, {
    jobId: job.id,
    status: 'approved',
    approvedAt: quote.approvedAt || new Date().toISOString(),
  });
  return job;
}

/**
 * Job -> invoice. For per-visit billing pass the visits to bill; otherwise
 * the whole job is billed once.
 */
export function jobToInvoice(store, jobId, opts = {}) {
  return once(`job:${jobId}`, () => jobToInvoiceNow(store, jobId, opts));
}

async function jobToInvoiceNow(store, jobId, { visitIds = null, today } = {}) {
  const job = store.get('jobs', jobId);
  if (!job) return null;
  if (visitIds) {
    // Visits billed in the meantime are not billed twice, and with none
    // left there is nothing to bill (not the whole job instead).
    visitIds = visitIds.filter((id) => !(job.visits || []).find((v) => v.id === id)?.invoiceId);
    if (!visitIds.length) return null;
  }
  let items = cloneItems(job.items);
  let subject = job.title ? `For services rendered: ${job.title}` : 'For services rendered';
  let discount = job.discount || null;
  if (visitIds?.length) {
    // Each visit bills the job's line items once, with the job's discount
    // applying to each visit (the per-visit price the job shows).
    const visits = (job.visits || []).filter((v) => visitIds.includes(v.id));
    if (discount?.type === 'amt') discount = { ...discount, value: (Number(discount.value) || 0) * visits.length };
    items = visits.flatMap((v) => cloneItems(job.items).map((it) => ({ ...it, description: [it.description, v.date ? `Visit on ${v.date}` : ''].filter(Boolean).join('\n') })));
    subject = `${job.title || 'Services'}, ${visits.length} visit${visits.length === 1 ? '' : 's'}`;
  }
  const invoice = await createInvoice(store, {
    clientId: job.clientId,
    propertyId: job.propertyId,
    jobIds: [job.id],
    visitIds: visitIds || [],
    subject,
    items,
    taxRate: job.taxRate,
    discount,
    today,
  });
  if (visitIds?.length) {
    store.patch('jobs', job.id, (j) => {
      j.visits = j.visits.map((v) => (visitIds.includes(v.id) ? { ...v, invoiceId: invoice.id } : v));
      return j;
    });
  }
  return invoice;
}

/**
 * Delete a quote, job or request and unlink what pointed at it, so the quote
 * or request it came from can be converted again. Returns an undo function.
 */
export function removeDoc(store, coll, id) {
  const removed = store.remove(coll, id);
  if (!removed) return () => {};
  const type = { quotes: 'quote', jobs: 'job' }[coll];
  const quotes = coll === 'jobs' ? store.all('quotes').filter((q) => q.jobId === id).map((q) => q.id) : [];
  const requests = type ? store.all('requests').filter((r) => r.convertedTo?.type === type && r.convertedTo.id === id).map((r) => r.id) : [];
  for (const q of quotes) store.patch('quotes', q, { jobId: null });
  for (const r of requests) store.patch('requests', r, { convertedTo: null });
  return () => {
    store.restore(coll, removed);
    // Link back, unless it was converted again in the meantime.
    for (const q of quotes) if (!store.get('quotes', q)?.jobId) store.patch('quotes', q, { jobId: id });
    for (const r of requests) if (!store.get('requests', r)?.convertedTo) store.patch('requests', r, { convertedTo: { type, id } });
  };
}

/**
 * Remove a team member: they come off job crews and upcoming (from today)
 * visits, events and site assessments, and a running timer is stopped at
 * `stamp`. Finished work keeps its history. Returns an undo function.
 */
export function removeTeamMember(store, memberId, { today, stamp }) {
  const removed = store.remove('team', memberId);
  if (!removed) return () => {};
  const before = [];
  const strip = (ids) => (ids || []).filter((id) => id !== memberId);
  const upcoming = (item) => !item.completedAt && (!item.date || item.date >= today) && (item.assignees || []).includes(memberId);
  for (const j of store.all('jobs')) {
    if (!(j.assignees || []).includes(memberId) && !(j.visits || []).some(upcoming)) continue;
    before.push(['jobs', j]);
    store.patch('jobs', j.id, (x) => {
      x.assignees = strip(x.assignees);
      x.visits = (x.visits || []).map((v) => (upcoming(v) ? { ...v, assignees: strip(v.assignees) } : v));
      return x;
    });
  }
  for (const ev of store.all('events')) {
    if (!upcoming(ev)) continue;
    before.push(['events', ev]);
    store.patch('events', ev.id, { assignees: strip(ev.assignees) });
  }
  for (const r of store.all('requests')) {
    if (!r.assessment || !upcoming(r.assessment)) continue;
    before.push(['requests', r]);
    store.patch('requests', r.id, { assessment: { ...r.assessment, assignees: strip(r.assessment.assignees) } });
  }
  for (const e of store.all('timeEntries')) {
    if (e.memberId !== memberId || !e.start || e.end) continue;
    before.push(['timeEntries', e]);
    store.patch('timeEntries', e.id, { end: stamp });
  }
  return () => {
    store.restore('team', removed);
    for (const [coll, rec] of before) store.put(coll, rec);
  };
}

export function setVisitComplete(store, jobId, visitId, done) {
  return store.patch('jobs', jobId, (j) => {
    j.visits = (j.visits || []).map((v) => (v.id === visitId ? { ...v, completedAt: done ? new Date().toISOString() : null } : v));
    return j;
  });
}

export function updateVisit(store, jobId, visitId, changes) {
  return store.patch('jobs', jobId, (j) => {
    j.visits = (j.visits || []).map((v) => (v.id === visitId ? { ...v, ...changes } : v));
    return j;
  });
}

/** Close a job: open visits are removed so it stops showing as late. */
export function closeJob(store, jobId) {
  return store.patch('jobs', jobId, (j) => {
    j.visits = (j.visits || []).filter((v) => v.completedAt || v.invoiceId);
    j.closedAt = new Date().toISOString();
    return j;
  });
}

export function reopenJob(store, jobId) {
  return store.patch('jobs', jobId, (j) => {
    delete j.closedAt;
    return j;
  });
}

export async function duplicateDoc(store, coll, id, today = localToday()) {
  const src = store.get(coll, id);
  if (!src) return null;
  const copy = structuredClone(src);
  delete copy.id;
  delete copy.createdAt;
  delete copy.updatedAt;
  delete copy.sentAt;
  delete copy.approvedAt;
  delete copy.jobId;
  delete copy.archived;
  delete copy.badDebt;
  delete copy.badDebtAt;
  delete copy.closedAt;
  // Never sent, and files stay with the original: deleting a shared file
  // from the copy would delete it from the original too.
  delete copy.emails;
  delete copy.attachments;
  copy.items = cloneItems(copy.items);
  // The copy's work has not been done yet.
  if (copy.checklist) copy.checklist = copy.checklist.map((it) => ({ ...it, done: false }));
  copy.number = await store.nextNumber(coll);
  if (coll === 'quotes') copy.status = 'draft';
  if (coll === 'jobs') {
    // A copy starts unscheduled rather than with visits in the past.
    if (copy.schedule?.start && copy.schedule.start < today) copy.schedule = { ...copy.schedule, start: null };
    copy.visits = buildVisits(copy.schedule?.start ? copy.schedule : null, copy.assignees, []);
  }
  if (coll === 'invoices') {
    copy.visitIds = [];
    copy.issueDate = today;
    copy.dueDate = addDays(today, termDays(copy.terms) ?? 30);
  }
  if (coll === 'quotes') delete copy.validUntil;
  copy.title = copy.title ? `${copy.title} (copy)` : copy.title;
  return store.put(coll, copy);
}

/** Everything that hangs off a client, for cascading deletes and counts. */
export function clientRecords(store, clientId) {
  const out = {};
  for (const coll of ['requests', 'quotes', 'jobs', 'invoices', 'payments']) {
    out[coll] = store.all(coll).filter((r) => r.clientId === clientId);
  }
  return out;
}

export function deleteClientCascade(store, clientId) {
  const linked = clientRecords(store, clientId);
  for (const [coll, recs] of Object.entries(linked)) store.bulkRemove(coll, recs.map((r) => r.id));
  // Tasks and events stay on the schedule, just no longer tied to the client.
  for (const ev of store.all('events')) if (ev.clientId === clientId) store.patch('events', ev.id, { clientId: null });
  return store.remove('clients', clientId);
}

// Invoices grouped by client, once per invoices list (a new list whenever
// invoices change), so a balance for every client on the clients page does
// not scan every invoice for each one.
const invoicesByClient = new WeakMap();

/** Outstanding balance across a client's sent invoices. */
export function clientBalance(store, clientId) {
  const payments = store.all('payments');
  const invoices = store.all('invoices');
  let byClient = invoicesByClient.get(invoices);
  if (!byClient) {
    byClient = new Map();
    for (const inv of invoices) {
      if (!byClient.has(inv.clientId)) byClient.set(inv.clientId, []);
      byClient.get(inv.clientId).push(inv);
    }
    invoicesByClient.set(invoices, byClient);
  }
  let sum = 0;
  for (const inv of byClient.get(clientId) || []) {
    if (inv.badDebt || !inv.sentAt) continue;
    sum += Math.max(0, invoiceBalance(inv, payments));
  }
  return sum;
}

export function clientLifetimeValue(store, clientId) {
  let sum = 0;
  for (const p of store.all('payments')) if (p.clientId === clientId && !p.voided) sum += p.amount || 0;
  return sum;
}

export function recordPayment(store, { invoiceId, clientId, amount, method = 'cash', date, reference = '', notes = '' }) {
  const inv = invoiceId ? store.get('invoices', invoiceId) : null;
  return store.put('payments', {
    invoiceId: invoiceId || null,
    clientId: clientId || inv?.clientId || null,
    amount,
    method,
    date,
    reference,
    notes,
  });
}

export function docTotal(doc) {
  return computeTotals(doc).total;
}
