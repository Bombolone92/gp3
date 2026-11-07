/**
 * Business reports, computed from the store on demand. Every function takes
 * plain arrays so they are easy to test.
 */
import { computeTotals, amountPaid, lineTotal, isIncluded } from './totals.js';
import { addMonths, startOfMonth, endOfMonth, diffDays, formatDate, localDate } from './dates.js';
import { invoiceStatus } from './status.js';

/** Months between from and to (inclusive), as { key: 'YYYY-MM', start, end, label }. */
export function monthBuckets(from, to) {
  const out = [];
  for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) {
    out.push({ key: m.slice(0, 7), start: m, end: endOfMonth(m), label: formatDate(m, { month: 'short' }) });
    if (out.length > 60) break;
  }
  return out;
}

/** Collected (payments) and invoiced (sent invoices) per month. */
export function revenueByMonth({ payments, invoices }, from, to) {
  const months = monthBuckets(from, to);
  const idx = new Map(months.map((m, i) => [m.key, i]));
  const collected = months.map(() => 0);
  const invoiced = months.map(() => 0);
  for (const p of payments) {
    if (p.voided || !p.date || p.date < from || p.date > to) continue;
    const i = idx.get(p.date.slice(0, 7));
    if (i !== undefined) collected[i] += p.amount || 0;
  }
  for (const inv of invoices) {
    if (!inv.sentAt || inv.badDebt || !inv.issueDate || inv.issueDate < from || inv.issueDate > to) continue;
    const i = idx.get(inv.issueDate.slice(0, 7));
    if (i !== undefined) invoiced[i] += computeTotals(inv).total;
  }
  return months.map((m, i) => ({ ...m, collected: collected[i], invoiced: invoiced[i] }));
}

/** Outstanding balances grouped by how late they are. */
export function agedReceivables({ invoices, payments }, today) {
  const buckets = [
    { id: 'current', label: 'Not yet due', amount: 0, count: 0 },
    { id: 'd30', label: '1 to 30 days late', amount: 0, count: 0 },
    { id: 'd60', label: '31 to 60 days late', amount: 0, count: 0 },
    { id: 'd90', label: '61 to 90 days late', amount: 0, count: 0 },
    { id: 'd90p', label: 'Over 90 days late', amount: 0, count: 0 },
  ];
  for (const inv of invoices) {
    const s = invoiceStatus(inv, today, payments);
    if (s !== 'awaiting_payment' && s !== 'past_due') continue;
    const bal = computeTotals(inv).total - amountPaid(inv.id, payments);
    if (bal <= 0) continue;
    const late = inv.dueDate ? diffDays(inv.dueDate, today) : 0;
    const b = late <= 0 ? buckets[0] : late <= 30 ? buckets[1] : late <= 60 ? buckets[2] : late <= 90 ? buckets[3] : buckets[4];
    b.amount += bal;
    b.count += 1;
  }
  return buckets;
}

/** Revenue per product or service from invoices issued in the range. */
export function revenueByItem(invoices, from, to, limit = 8) {
  const map = new Map();
  for (const inv of invoices) {
    if (!inv.sentAt || inv.badDebt || !inv.issueDate || inv.issueDate < from || inv.issueDate > to) continue;
    for (const it of inv.items || []) {
      if (!isIncluded(it)) continue;
      const key = (it.name || 'Other').trim() || 'Other';
      map.set(key, (map.get(key) || 0) + lineTotal(it));
    }
  }
  return [...map].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount).slice(0, limit);
}

/** Top clients by payments received in the range. */
export function topClients(payments, from, to, limit = 8) {
  const map = new Map();
  for (const p of payments) {
    if (p.voided || !p.date || p.date < from || p.date > to || !p.clientId) continue;
    map.set(p.clientId, (map.get(p.clientId) || 0) + (p.amount || 0));
  }
  return [...map].map(([clientId, amount]) => ({ clientId, amount })).sort((a, b) => b.amount - a.amount).slice(0, limit);
}

/** Quote funnel for quotes created in the range. */
export function quoteFunnel(quotes, from, to) {
  const inRange = quotes.filter((q) => localDate(q.createdAt) >= from && localDate(q.createdAt) <= to);
  const sent = inRange.filter((q) => q.sentAt || q.status !== 'draft');
  const won = inRange.filter((q) => q.status === 'approved' || q.jobId);
  const value = (l) => l.reduce((s, q) => s + computeTotals(q).total, 0);
  return {
    created: inRange.length,
    sent: sent.length,
    won: won.length,
    rate: sent.length ? Math.round((won.length / sent.length) * 100) : 0,
    sentValue: value(sent),
    wonValue: value(won),
  };
}

/** Clients created in range grouped by lead source. */
export function leadSources(clients, from, to) {
  const map = new Map();
  for (const c of clients) {
    const d = localDate(c.createdAt);
    if (!d || d < from || d > to) continue;
    const k = c.leadSource || 'Not specified';
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/** Visits completed per team member in the range. */
export function visitsByMember(jobs, from, to) {
  const map = new Map();
  for (const j of jobs) {
    for (const v of j.visits || []) {
      if (!v.completedAt || !v.date || v.date < from || v.date > to) continue;
      const ids = v.assignees?.length ? v.assignees : ['unassigned'];
      for (const id of ids) map.set(id, (map.get(id) || 0) + 1);
    }
  }
  return map;
}

export function expensesByCategory(expenses, from, to) {
  const map = new Map();
  for (const x of expenses) {
    if (!x.date || x.date < from || x.date > to) continue;
    const k = x.category || 'Other';
    map.set(k, (map.get(k) || 0) + (x.amount || 0));
  }
  return [...map].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
}
