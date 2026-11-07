import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildVisits, createQuote, quoteToJob, jobToInvoice, requestToQuote, requestToJob, setVisitComplete, closeJob, duplicateDoc, removeDoc, removeTeamMember, applyEdits, deleteClientCascade, clientBalance, clientLifetimeValue, recordPayment } from '../src/core/workflow.js';
import { jobStatus, invoiceStatus, quoteStatus } from '../src/core/status.js';
import { computeTotals } from '../src/core/totals.js';

let store;
beforeEach(async () => {
  store = createStore({ backend: createMemoryBackend(), flushDelay: 10_000 });
  await store.init();
});

describe('visits', () => {
  it('builds visits from a schedule and keeps completed ones on reschedule', () => {
    const schedule = { start: '2026-10-12', repeat: 'weekly', interval: 1, end: { type: 'count', count: 3 }, startTime: '09:00', endTime: '10:00' };
    const v1 = buildVisits(schedule, ['m1']);
    expect(v1.map((v) => v.date)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26']);
    expect(v1[0]).toMatchObject({ start: '09:00', end: '10:00', assignees: ['m1'] });
    v1[0].completedAt = 'done';
    const v2 = buildVisits({ ...schedule, start: '2026-10-13', end: { type: 'count', count: 2 } }, ['m2'], v1);
    expect(v2.map((v) => v.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-20']);
    expect(v2[0].completedAt).toBe('done');
    expect(v2[1].assignees).toEqual(['m2']);
  });

  it('does not bring back a visit moved or deleted before the last finished one', () => {
    const schedule = { start: '2026-10-05', repeat: 'weekly', interval: 1, end: { type: 'count', count: 4 }, startTime: '09:00', endTime: '10:00' };
    const v = buildVisits(schedule, ['m1']);
    // First visit moved a day later and done, second deleted, third done.
    const existing = [{ ...v[0], date: '2026-10-06', completedAt: 'x' }, { ...v[2], completedAt: 'x' }, v[3]];
    const after = buildVisits({ ...schedule, startTime: '08:00', endTime: '09:00' }, ['m1'], existing, '2026-10-22');
    expect(after.map((x) => [x.date, !!x.completedAt])).toEqual([
      ['2026-10-06', true],
      ['2026-10-19', true],
      ['2026-10-26', false],
    ]);
    expect(after[2]).toMatchObject({ id: v[3].id, start: '08:00' });
    // A visit ticked off ahead of time is not history yet.
    const early = buildVisits(schedule, ['m1'], [{ ...v[2], completedAt: 'x' }], '2026-10-08');
    expect(early.map((x) => x.date)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  });

  it('keeps ids for dates that already had a visit', () => {
    const schedule = { start: '2026-10-12', repeat: 'weekly', end: { type: 'count', count: 2 } };
    const a = buildVisits(schedule, []);
    const b = buildVisits({ ...schedule, startTime: '11:00' }, [], a);
    expect(b.map((v) => v.id)).toEqual(a.map((v) => v.id));
  });

  it('moves the visit of a one-off job to its new date, keeping its id and notes', () => {
    const before = [{ id: 'v1', date: '2026-10-14', start: '09:00', end: '10:00', assignees: [], completedAt: null, notes: 'Gate code 1234' }];
    const after = buildVisits({ start: '2026-10-16', repeat: 'none', startTime: '09:00', endTime: '10:00' }, [], before);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: 'v1', date: '2026-10-16', notes: 'Gate code 1234' });
    // Scheduling an unscheduled job keeps its placeholder visit too.
    const placeholder = buildVisits(null, []);
    expect(buildVisits({ start: '2026-10-16', repeat: 'none' }, [], placeholder)[0].id).toBe(placeholder[0].id);
  });

  it('uses one undated placeholder for unscheduled jobs', () => {
    const v = buildVisits(null, ['m']);
    expect(v).toHaveLength(1);
    expect(v[0].date).toBeNull();
  });
});

describe('saving edit forms', () => {
  it('applies only what the form changed onto the current record', () => {
    const before = { title: 'Old', notes: '', sentAt: null };
    const after = { ...before, title: 'New' };
    const current = { ...before, sentAt: '2026-10-12T10:00:00Z', emails: [{ to: ['a@b.c'] }] };
    expect(applyEdits(current, before, after)).toEqual({ title: 'New', notes: '', sentAt: '2026-10-12T10:00:00Z', emails: [{ to: ['a@b.c'] }] });
    expect(applyEdits({ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
  });
});

describe('pipeline', () => {
  it('runs request -> quote -> job -> invoice -> paid', async () => {
    const client = store.put('clients', { firstName: 'Ada', properties: [{ id: 'p1', street1: '1 Main' }] });
    const req = store.put('requests', { clientId: client.id, propertyId: 'p1', title: 'Hedges', details: 'Tall' });
    const quote = await requestToQuote(store, req.id);
    expect(quote).toMatchObject({ clientId: client.id, propertyId: 'p1', title: 'Hedges', status: 'draft', number: 1 });
    expect(store.get('requests', req.id).convertedTo).toEqual({ type: 'quote', id: quote.id });

    store.patch('quotes', quote.id, {
      items: [
        { id: 'a', name: 'Trim', qty: 2, unitPrice: 5000 },
        { id: 'b', name: 'Haul', qty: 1, unitPrice: 2000, optional: true },
        { id: 'c', name: 'Mulch', qty: 1, unitPrice: 3000, optional: true, selected: true },
      ],
    });
    const job = await quoteToJob(store, quote.id);
    expect(job.items.map((i) => i.name)).toEqual(['Trim', 'Mulch']);
    expect(store.get('quotes', quote.id)).toMatchObject({ status: 'approved', jobId: job.id });
    expect(await quoteToJob(store, quote.id)).toEqual(store.get('jobs', job.id));

    expect(jobStatus(store.get('jobs', job.id), '2026-10-12', [])).toBe('unscheduled');
    store.patch('jobs', job.id, (j) => ((j.visits = buildVisits({ start: '2026-10-10', repeat: 'none' }, [], j.visits)), j));
    const visitId = store.get('jobs', job.id).visits[0].id;
    expect(jobStatus(store.get('jobs', job.id), '2026-10-12', [])).toBe('late');
    setVisitComplete(store, job.id, visitId, true);
    expect(jobStatus(store.get('jobs', job.id), '2026-10-12', store.all('invoices'))).toBe('requires_invoicing');

    const inv = await jobToInvoice(store, job.id, { today: '2026-10-12' });
    expect(inv).toMatchObject({ clientId: client.id, jobIds: [job.id], issueDate: '2026-10-12', dueDate: '2026-11-11' });
    expect(jobStatus(store.get('jobs', job.id), '2026-10-12', store.all('invoices'))).toBe('completed');

    store.patch('invoices', inv.id, { sentAt: '2026-10-12T10:00:00Z' });
    recordPayment(store, { invoiceId: inv.id, amount: 13000, date: '2026-10-13' });
    expect(invoiceStatus(store.get('invoices', inv.id), '2026-10-13', store.all('payments'))).toBe('paid');
    expect(clientLifetimeValue(store, client.id)).toBe(13000);
    expect(clientBalance(store, client.id)).toBe(0);
  });

  it('bills individual visits and marks them invoiced', async () => {
    const job = store.put('jobs', { number: 1, clientId: 'c', billing: 'per_visit', items: [{ id: 'x', name: 'Mow', qty: 1, unitPrice: 6500 }], visits: [{ id: 'v1', date: '2026-10-01', completedAt: 'x' }, { id: 'v2', date: '2026-10-08', completedAt: 'x' }, { id: 'v3', date: '2026-10-15' }] });
    const inv = await jobToInvoice(store, job.id, { visitIds: ['v1', 'v2'], today: '2026-10-12' });
    expect(inv.items).toHaveLength(2);
    expect(store.get('jobs', job.id).visits.filter((v) => v.invoiceId === inv.id).map((v) => v.id)).toEqual(['v1', 'v2']);
    // Asking again bills nothing, rather than the whole job.
    expect(await jobToInvoice(store, job.id, { visitIds: ['v1', 'v2'], today: '2026-10-12' })).toBe(null);
    expect(store.all('invoices')).toHaveLength(1);
  });

  it('applies the job discount to each billed visit', async () => {
    const items = [{ id: 'x', name: 'Mow', qty: 1, unitPrice: 10000 }];
    const visits = [{ id: 'v1', date: '2026-10-01', completedAt: 'x' }, { id: 'v2', date: '2026-10-08', completedAt: 'x' }];
    const pct = store.put('jobs', { number: 1, clientId: 'c', billing: 'per_visit', items, discount: { type: 'pct', value: 10 }, visits });
    expect(computeTotals(await jobToInvoice(store, pct.id, { visitIds: ['v1', 'v2'], today: '2026-10-12' })).total).toBe(18000);
    const amt = store.put('jobs', { number: 2, clientId: 'c', billing: 'per_visit', items, discount: { type: 'amt', value: 1500 }, visits });
    expect(computeTotals(await jobToInvoice(store, amt.id, { visitIds: ['v1', 'v2'], today: '2026-10-12' })).total).toBe(17000);
  });

  it('lets a quote be converted again after its job is deleted, and undo links it back', async () => {
    const quote = await createQuote(store, { clientId: 'c', items: [{ id: 'i', name: 'Mow', qty: 1, unitPrice: 5000 }] });
    const job = await quoteToJob(store, quote.id, { today: '2026-10-12' });
    expect(quoteStatus(store.get('quotes', quote.id))).toBe('converted');
    const undo = removeDoc(store, 'jobs', job.id);
    expect(quoteStatus(store.get('quotes', quote.id))).not.toBe('converted');
    undo();
    expect(store.get('jobs', job.id)).toBeTruthy();
    expect(store.get('quotes', quote.id).jobId).toBe(job.id);
  });

  it('takes a removed team member off upcoming work only, and undo puts them back', () => {
    store.put('team', { id: 'm1', name: 'Sam' });
    const job = store.put('jobs', { number: 1, assignees: ['m1', 'm2'], visits: [{ id: 'old', date: '2026-10-01', completedAt: 'x', assignees: ['m1'] }, { id: 'next', date: '2026-10-20', assignees: ['m1', 'm2'] }] });
    const ev = store.put('events', { date: '2026-10-15', assignees: ['m1'] });
    const entry = store.put('timeEntries', { memberId: 'm1', date: '2026-10-12', start: '2026-10-12T08:00', end: null });
    const undo = removeTeamMember(store, 'm1', { today: '2026-10-12', stamp: '2026-10-12T12:00' });
    const j = store.get('jobs', job.id);
    expect(j.assignees).toEqual(['m2']);
    expect(j.visits.find((v) => v.id === 'old').assignees).toEqual(['m1']);
    expect(j.visits.find((v) => v.id === 'next').assignees).toEqual(['m2']);
    expect(store.get('events', ev.id).assignees).toEqual([]);
    expect(store.get('timeEntries', entry.id).end).toBe('2026-10-12T12:00');
    undo();
    expect(store.get('team', 'm1')).toBeTruthy();
    expect(store.get('jobs', job.id).visits.find((v) => v.id === 'next').assignees).toEqual(['m1', 'm2']);
    expect(store.get('timeEntries', entry.id).end).toBe(null);
  });

  it('turns requests into jobs directly', async () => {
    const req = store.put('requests', { clientId: 'c', title: 'Fix', details: 'Leak' });
    const job = await requestToJob(store, req.id);
    expect(job).toMatchObject({ title: 'Fix', instructions: 'Leak', requestId: req.id });
  });

  it('closes jobs by dropping unfinished visits', () => {
    const job = store.put('jobs', { visits: [{ id: 'a', date: '2026-10-01', completedAt: 'x' }, { id: 'b', date: '2026-10-20' }] });
    closeJob(store, job.id);
    const j = store.get('jobs', job.id);
    expect(j.visits.map((v) => v.id)).toEqual(['a']);
    expect(j.closedAt).toBeTruthy();
  });

  it('duplicates documents as fresh drafts', async () => {
    const q = await createQuote(store, { clientId: 'c', title: 'Fence', items: [{ id: 'i', name: 'Post', qty: 4, unitPrice: 100 }] });
    store.patch('quotes', q.id, { status: 'approved', sentAt: 'x', jobId: 'j', emails: [{ to: ['a@b.c'], at: 'x' }], attachments: [{ id: 'f', path: 'files/f-plan.pdf' }] });
    const copy = await duplicateDoc(store, 'quotes', q.id);
    expect(copy.emails).toBeUndefined();
    expect(copy.attachments).toBeUndefined();
    expect(copy).toMatchObject({ status: 'draft', title: 'Fence (copy)', number: 2 });
    expect(copy.sentAt).toBeUndefined();
    expect(copy.jobId).toBeUndefined();
    expect(copy.items[0].id).not.toBe('i');
  });

  it('duplicates a job with its checklist unticked', async () => {
    const job = store.put('jobs', { number: 1, title: 'Fence', items: [], checklist: [{ id: 'a', text: 'Bring ladder', done: true }, { id: 'b', text: 'Photo', done: false }] });
    const copy = await duplicateDoc(store, 'jobs', job.id, '2026-10-12');
    expect(copy.checklist).toEqual([{ id: 'a', text: 'Bring ladder', done: false }, { id: 'b', text: 'Photo', done: false }]);
    expect(store.get('jobs', job.id).checklist[0].done).toBe(true);
  });

  it('deletes a client with everything attached', () => {
    const c = store.put('clients', { firstName: 'Z' });
    store.put('quotes', { clientId: c.id });
    store.put('invoices', { clientId: c.id });
    store.put('quotes', { clientId: 'other' });
    const ev = store.put('events', { title: 'Call back', clientId: c.id });
    deleteClientCascade(store, c.id);
    expect(store.get('events', ev.id).clientId).toBe(null);
    expect(store.all('clients')).toHaveLength(0);
    expect(store.all('quotes').map((q) => q.clientId)).toEqual(['other']);
    expect(store.all('invoices')).toHaveLength(0);
  });
});
