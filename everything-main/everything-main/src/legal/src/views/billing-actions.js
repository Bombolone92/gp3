/** Bill workflow actions shared by the bills list and the bill page. */
import { app } from '../app.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { billPaid } from '../core/finance.js';
import { billActivityIds, nextApprovalStatus } from '../core/billing-ops.js';
import { addDays, diffDays } from '../core/dates.js';

const store = () => app.store;

/** Make a bill's activities unbilled again (when it is voided or deleted). */
export function releaseActivities(bill, lineFilter = () => true) {
  const s = store();
  const lines = (bill.lines || []).filter(lineFilter);
  for (const id of billActivityIds({ lines })) {
    const a = s.get('activities', id);
    if (a && a.billId === bill.id) s.patch('activities', id, { billId: null });
  }
  const m = s.get('matters', bill.matterId);
  if (m?.billing?.flatFeeBilled && lines.some((l) => l.kind === 'flat' && !l.activityId)) s.patch('matters', m.id, (cur) => ({ ...cur, billing: { ...cur.billing, flatFeeBilled: false } }));
}

/**
 * Fields for a bill being issued. A generated draft whose dates were never
 * set by hand is issued as of today, keeping its payment terms, so a draft
 * held for review isn't overdue the moment it goes out.
 */
function issuedFields(b, now) {
  const fields = { status: 'issued', approvedAt: b.approvedAt || now };
  const today = app.today();
  if (b.autoDates && b.issueDate < today) Object.assign(fields, { issueDate: today, dueDate: addDays(today, diffDays(b.issueDate, b.dueDate)) });
  if (b.autoDates) fields.autoDates = false;
  return fields;
}

export function approveBills(list) {
  const now = new Date().toISOString();
  let issued = 0;
  for (const b of list) {
    const next = nextApprovalStatus(b.status);
    if (next === 'issued') issued++;
    store().patch('bills', b.id, next === 'issued' ? { ...issuedFields(b, now), approvedAt: now } : { status: next, approvedAt: now });
  }
  // Drafts move to pending approval; pending bills are approved and issued.
  const submitted = list.length - issued;
  const n = (k) => `${k} ${k === 1 ? 'bill' : 'bills'}`;
  toast(
    list.length === 1
      ? `Bill #${list[0].number} ${issued ? 'approved and issued' : 'submitted for approval'}`
      : [issued ? `${n(issued)} approved and issued` : '', submitted ? `${n(submitted)} submitted for approval` : ''].filter(Boolean).join(', '),
  );
}

export function issueBills(list) {
  const now = new Date().toISOString();
  for (const b of list) store().patch('bills', b.id, issuedFields(b, now));
  toast(list.length === 1 ? `Bill #${list[0].number} issued` : `${list.length} bills issued`);
}

/** Void bills without payments; their work becomes unbilled again. Resolves true when done. */
export async function voidBills(list) {
  list = list.filter((b) => b.status !== 'void');
  if (!list.length) return false;
  const blockedByPayments = () => {
    const pays = store().all('payments');
    const paid = list.find((b) => billPaid(b, pays) > 0);
    if (paid) toast(`Bill #${paid.number} has payments. Delete its payments before voiding it.`, { type: 'error', duration: 6000 });
    return !!paid;
  };
  if (blockedByPayments()) return false;
  const ok = await confirmDialog({
    title: list.length === 1 ? `Void bill #${list[0].number}?` : `Void ${list.length} bills?`,
    message: 'Voided bills stay on record with a zero balance. Their time and expenses become unbilled again so they can be billed later.',
    confirmLabel: 'Void',
    danger: true,
  });
  if (!ok) return false;
  // A payment, a void, or a delete may have arrived while the question was open.
  list = list.map((b) => store().get('bills', b.id)).filter((b) => b && b.status !== 'void');
  if (!list.length || blockedByPayments()) return false;
  const now = new Date().toISOString();
  for (const b of list) {
    releaseActivities(b);
    store().patch('bills', b.id, { status: 'void', voidedAt: now });
  }
  toast(list.length === 1 ? `Bill #${list[0].number} voided` : `${list.length} bills voided`);
  return true;
}

/** Delete draft or pending bills; their work becomes unbilled again. */
export async function deleteDrafts(list) {
  list = list.filter((b) => b.status === 'draft' || b.status === 'pending');
  if (!list.length) return false;
  const ok = await confirmDialog({
    title: list.length === 1 ? `Delete draft bill #${list[0].number}?` : `Delete ${list.length} draft bills?`,
    message: 'The time and expenses on them become unbilled again.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return false;
  // Only bills that are still drafts (one may have been issued meanwhile).
  list = list.map((b) => store().get('bills', b.id)).filter((b) => b && (b.status === 'draft' || b.status === 'pending'));
  if (!list.length) return false;
  for (const b of list) releaseActivities(b);
  store().bulkRemove(
    'bills',
    list.map((b) => b.id),
  );
  toast(list.length === 1 ? 'Draft bill deleted' : `${list.length} draft bills deleted`);
  return true;
}
