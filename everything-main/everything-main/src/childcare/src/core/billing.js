/**
 * Tuition billing. Everything is integer cents.
 *
 *   plans     { id, name, amountCents, frequency: 'weekly' | 'monthly', description }
 *   student   { ..., plans: [{ planId, amountCents? }] }   amountCents overrides the plan
 *   invoices  { id, number, studentId, issueDate, dueDate, period?, items: [{ id, description, amountCents, qty }], status: 'open' | 'void', memo }
 *   payments  { id, studentId, amountCents, date, method, reference, note, kind: 'payment' | 'credit' }
 *
 * Payments belong to a child's account rather than to one invoice, and are
 * applied to the oldest open invoices first. A family can pay a lump sum and
 * every statement still shows the right balance.
 */
import { addDays, startOfWeek, startOfMonth, endOfMonth, formatDate } from './dates.js';
import { newId } from './ids.js';

/** A line's quantity: missing means one, but zero is zero (the statement shows it as nothing). */
export const qtyOf = (it) => {
  const q = it.qty === undefined || it.qty === null || it.qty === '' ? 1 : Number(it.qty);
  return Number.isFinite(q) ? q : 1;
};

/** One line's amount in cents. */
export const lineTotal = (it) => Math.round((Number(it.amountCents) || 0) * qtyOf(it));

export function invoiceTotal(inv) {
  return (inv?.items || []).reduce((sum, it) => sum + lineTotal(it), 0);
}

const byDue = (a, b) => (a.dueDate || a.issueDate || '').localeCompare(b.dueDate || b.issueDate || '') || (Number(a.number) || 0) - (Number(b.number) || 0);

/**
 * The account of one child: invoices with their paid amount and status,
 * plus totals. status: 'paid' | 'partial' | 'overdue' | 'due' | 'void'.
 */
export function account(studentId, invoices, payments, today) {
  const mine = invoices.filter((i) => i.studentId === studentId);
  const paidIn = payments.filter((p) => p.studentId === studentId).reduce((s, p) => s + (Number(p.amountCents) || 0), 0);
  let left = paidIn;
  const rows = [];
  for (const inv of [...mine].sort(byDue)) {
    const total = invoiceTotal(inv);
    if (inv.status === 'void') {
      rows.push({ invoice: inv, total, paid: 0, balance: 0, status: 'void' });
      continue;
    }
    const paid = Math.min(Math.max(left, 0), total);
    left -= paid;
    const balance = total - paid;
    const status = balance <= 0 ? 'paid' : inv.dueDate && inv.dueDate < today ? 'overdue' : paid > 0 ? 'partial' : 'due';
    rows.push({ invoice: inv, total, paid, balance, status });
  }
  const billed = rows.filter((r) => r.status !== 'void').reduce((s, r) => s + r.total, 0);
  return {
    rows,
    billed,
    paid: paidIn,
    balance: billed - paidIn, // negative means credit on account
    overdue: rows.filter((r) => r.status === 'overdue').reduce((s, r) => s + r.balance, 0),
  };
}

/** Balances for every child with any billing activity: Map(studentId -> account). */
export function allAccounts(invoices, payments, today) {
  const ids = new Set([...invoices.map((i) => i.studentId), ...payments.map((p) => p.studentId)]);
  const out = new Map();
  for (const id of ids) if (id) out.set(id, account(id, invoices, payments, today));
  return out;
}

export const STATUS_META = {
  paid: { label: 'Paid', tone: 'success' },
  partial: { label: 'Partly paid', tone: 'info' },
  due: { label: 'Due', tone: 'neutral' },
  overdue: { label: 'Overdue', tone: 'danger' },
  void: { label: 'Void', tone: 'neutral' },
};

/** Receivables aging buckets in cents: current, 1-30, 31-60, 61-90, 90+. */
export function aging(accounts, today) {
  const b = { current: 0, d30: 0, d60: 0, d90: 0, older: 0 };
  for (const acc of accounts.values()) {
    for (const r of acc.rows) {
      if (r.balance <= 0 || r.status === 'void') continue;
      const due = r.invoice.dueDate || r.invoice.issueDate;
      const late = due && due < today ? Math.round((Date.parse(today) - Date.parse(due)) / 86400000) : 0;
      if (late <= 0) b.current += r.balance;
      else if (late <= 30) b.d30 += r.balance;
      else if (late <= 60) b.d60 += r.balance;
      else if (late <= 90) b.d90 += r.balance;
      else b.older += r.balance;
    }
  }
  return b;
}

/** The billing period containing `day` for a frequency: { key, start, label }. */
export function periodFor(frequency, day, weekStart = 1) {
  if (frequency === 'weekly') {
    const start = startOfWeek(day, weekStart);
    return { key: `weekly:${start}`, start, label: `Week of ${formatDate(start, { month: 'short', day: 'numeric' })}` };
  }
  const start = startOfMonth(day);
  return { key: `monthly:${start.slice(0, 7)}`, start, label: formatDate(start, { month: 'long', year: 'numeric' }) };
}

/**
 * Invoices that a billing run would create for a period: one per active
 * child with plans of that frequency, started by the period's end, and no
 * invoice for the period yet.
 * Pure: returns drafts without numbers; the caller numbers and saves them.
 */
export function planBillingRun({ students, plans, invoices }, { frequency, day, dueDays = 7, weekStart = 1 }) {
  const period = periodFor(frequency, day, weekStart);
  const planById = new Map(plans.map((p) => [p.id, p]));
  const done = new Set(invoices.filter((i) => i.period === period.key && i.status !== 'void').map((i) => i.studentId));
  const last = frequency === 'weekly' ? addDays(period.start, 6) : endOfMonth(period.start);
  const drafts = [];
  for (const s of students) {
    if (s.status !== 'active' || done.has(s.id)) continue;
    // Enrolled with a start date after this period: nothing to bill yet.
    if (s.startDate && s.startDate > last) continue;
    const items = [];
    for (const sp of s.plans || []) {
      const plan = planById.get(sp.planId);
      if (!plan || plan.frequency !== frequency) continue;
      const amount = Number.isFinite(sp.amountCents) ? sp.amountCents : plan.amountCents;
      items.push({ id: newId(), description: `${plan.name}, ${period.label}`, amountCents: amount, qty: 1 });
    }
    if (!items.length) continue;
    drafts.push({ studentId: s.id, issueDate: day, dueDate: addDays(period.start > day ? period.start : day, dueDays), period: period.key, items, status: 'open' });
  }
  return { period, drafts };
}

/** Sum of the plans a child is enrolled in, per frequency. */
export function planTotals(student, plans) {
  const out = { weekly: 0, monthly: 0 };
  for (const sp of student?.plans || []) {
    const plan = plans.find((p) => p.id === sp.planId);
    if (!plan) continue;
    out[plan.frequency] += Number.isFinite(sp.amountCents) ? sp.amountCents : plan.amountCents;
  }
  return out;
}

/** Collected (payments, not credits) by month: [{ month, cents }]. */
export function collectedByMonth(payments, from, to) {
  const out = new Map();
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); ) {
    out.set(m, 0);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  for (const p of payments) {
    if (p.kind === 'credit') continue;
    const m = (p.date || '').slice(0, 7);
    if (out.has(m)) out.set(m, out.get(m) + (Number(p.amountCents) || 0));
  }
  return [...out].map(([month, cents]) => ({ month, cents }));
}
