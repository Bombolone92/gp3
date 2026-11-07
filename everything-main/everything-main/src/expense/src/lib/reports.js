/** Expense reports: a bundle of expenses that moves through a fixed lifecycle. */

import { totalsByCurrency } from './money.js';
import { monthLabel } from './dates.js';

export const REPORT_STATUSES = ['draft', 'submitted', 'approved', 'reimbursed'];

export const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  reimbursed: 'Reimbursed',
};

/** Forward step, or null when the report is at the end of its life. */
export function nextStatus(status) {
  const i = REPORT_STATUSES.indexOf(status);
  return i === -1 || i === REPORT_STATUSES.length - 1 ? null : REPORT_STATUSES[i + 1];
}

export function canTransition(from, to) {
  const a = REPORT_STATUSES.indexOf(from);
  const b = REPORT_STATUSES.indexOf(to);
  if (a === -1 || b === -1) return false;
  // Forward one step, or back to draft from submitted (withdraw).
  return b === a + 1 || (from === 'submitted' && to === 'draft');
}

/** The verb shown on the primary button for a given status. */
export function transitionLabel(status) {
  return { draft: 'Submit report', submitted: 'Mark approved', approved: 'Mark reimbursed' }[status] || null;
}

/** Expenses can only be added or removed while the report is a draft. */
export function isEditable(report) {
  return !report || report.status === 'draft';
}

export function reportExpenses(report, expenses) {
  return expenses.filter((e) => e.reportId === report.id);
}

export function reportTotals(report, expenses) {
  const list = reportExpenses(report, expenses);
  return {
    count: list.length,
    byCurrency: totalsByCurrency(list),
    withReceipt: list.filter((e) => !!e.receiptPath).length,
    reconciled: list.filter((e) => e.reconciled).length,
  };
}

export function suggestReportTitle(monthKeyStr) {
  return `${monthLabel(monthKeyStr)} expenses`;
}

/** Stamp the timestamp field that belongs to the new status. */
export function applyTransition(report, to, now = Date.now()) {
  const stamp = { submitted: 'submittedAt', approved: 'approvedAt', reimbursed: 'reimbursedAt' }[to];
  const next = { ...report, status: to, updatedAt: now };
  if (stamp) next[stamp] = now;
  if (to === 'draft') { next.submittedAt = null; }
  return next;
}
