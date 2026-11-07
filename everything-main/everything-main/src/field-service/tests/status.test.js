import { describe, it, expect } from 'vitest';
import { jobStatus, invoiceStatus, requestStatus, quoteStatus, clientStatus } from '../src/core/status.js';

const T = '2026-10-12';

describe('job status', () => {
  const job = (visits, extra = {}) => ({ id: 'j', visits, ...extra });
  it('is unscheduled without dated visits', () => expect(jobStatus(job([]), T)).toBe('unscheduled'));
  it('is late when an open visit is in the past', () => expect(jobStatus(job([{ date: '2026-10-10' }]), T)).toBe('late'));
  it('is today when a visit is today', () => expect(jobStatus(job([{ date: T }, { date: '2026-10-20' }]), T)).toBe('today'));
  it('is upcoming when every open visit is ahead', () => expect(jobStatus(job([{ date: '2026-10-20' }]), T)).toBe('upcoming'));
  it('requires invoicing once complete and unbilled', () => {
    const j = job([{ date: '2026-10-01', completedAt: 'x' }]);
    expect(jobStatus(j, T, [])).toBe('requires_invoicing');
    expect(jobStatus(j, T, [{ jobIds: ['j'] }])).toBe('completed');
  });
  it('requires invoicing for a per-visit job with a finished visit not billed yet', () => {
    const visits = [{ id: 'v1', date: '2026-10-05', completedAt: 'x' }, { id: 'v2', date: '2026-10-20' }];
    expect(jobStatus(job(visits, { billing: 'per_visit' }), T, [])).toBe('requires_invoicing');
    const billed = [{ ...visits[0], invoiceId: 'i1' }, visits[1]];
    expect(jobStatus(job(billed, { billing: 'per_visit' }), T, [{ jobIds: ['j'] }])).toBe('upcoming');
    // A late visit still comes first.
    expect(jobStatus(job([visits[0], { id: 'v3', date: '2026-10-10' }], { billing: 'per_visit' }), T, [])).toBe('late');
    // Finished, one visit billed, another not.
    const done = [{ ...visits[0], invoiceId: 'i1' }, { id: 'v2', date: '2026-10-08', completedAt: 'x' }];
    expect(jobStatus(job(done, { billing: 'per_visit' }), T, [{ jobIds: ['j'] }])).toBe('requires_invoicing');
  });
  it('completes a per-visit job closed with nothing left to bill', () => {
    // Closed before any visit was done: nothing to invoice.
    expect(jobStatus(job([], { billing: 'per_visit', closedAt: 'x' }), T, [])).toBe('completed');
    const billed = [{ id: 'v1', date: '2026-10-05', completedAt: 'x', invoiceId: 'i1' }];
    expect(jobStatus(job(billed, { billing: 'per_visit', closedAt: 'x' }), T, [])).toBe('completed');
    const unbilled = [{ id: 'v1', date: '2026-10-05', completedAt: 'x' }];
    expect(jobStatus(job(unbilled, { billing: 'per_visit', closedAt: 'x' }), T, [])).toBe('requires_invoicing');
  });
  it('respects archived', () => expect(jobStatus(job([], { archived: true }), T)).toBe('archived'));
});

describe('invoice status', () => {
  const inv = { id: 'i', items: [{ qty: 1, unitPrice: 10000 }], sentAt: '2026-10-01', dueDate: '2026-10-11' };
  it('is draft until sent', () => expect(invoiceStatus({ ...inv, sentAt: null }, T, [])).toBe('draft'));
  it('is past due after the due date', () => expect(invoiceStatus(inv, T, [])).toBe('past_due'));
  it('is awaiting payment before the due date', () => expect(invoiceStatus({ ...inv, dueDate: '2026-10-30' }, T, [])).toBe('awaiting_payment'));
  it('is paid when payments cover the total', () => expect(invoiceStatus(inv, T, [{ invoiceId: 'i', amount: 10000 }])).toBe('paid'));
  it('is bad debt when written off', () => expect(invoiceStatus({ ...inv, badDebt: true }, T, [])).toBe('bad_debt'));
});

describe('request, quote and client status', () => {
  it('tracks assessments', () => {
    expect(requestStatus({}, T)).toBe('new');
    expect(requestStatus({ assessment: { date: '2026-10-20' } }, T)).toBe('assessment_scheduled');
    expect(requestStatus({ assessment: { date: '2026-10-01' } }, T)).toBe('assessment_overdue');
    expect(requestStatus({ assessment: { date: '2026-10-01', completedAt: 'x' } }, T)).toBe('assessment_complete');
    expect(requestStatus({ convertedTo: { type: 'quote', id: 'q' } }, T)).toBe('converted');
  });
  it('marks quotes converted once a job exists', () => {
    expect(quoteStatus({ status: 'approved', jobId: 'j' })).toBe('converted');
    expect(quoteStatus({ status: 'approved' })).toBe('approved');
    expect(quoteStatus({})).toBe('draft');
  });
  it('treats clients without work as leads', () => {
    expect(clientStatus({ id: 'c' }, {})).toBe('lead');
    expect(clientStatus({ id: 'c' }, { jobs: [{ clientId: 'c' }] })).toBe('client_active');
  });
});
