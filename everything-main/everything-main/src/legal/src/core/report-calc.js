/**
 * Report calculations. Pure functions over plain records; amounts are
 * integer cents and durations are minutes. Date ranges are inclusive
 * "YYYY-MM-DD" strings, and an empty bound means unbounded.
 */
import { activityAmount, billTotals, billBalance, agingBuckets, ledger, txAmount } from './finance.js';
import { addMonths, diffDays, startOfMonth, endOfMonth } from './dates.js';
import { practiceAreaName, stagesFor, categoryName } from './settings.js';

const inRange = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to);
const isIssued = (b) => b && b.status !== 'draft' && b.status !== 'pending' && b.status !== 'void';

/** The last n months ending with the month of `today`: ['2026-05', ..., '2026-10']. */
export function lastMonths(today, n = 12) {
  const first = addMonths(startOfMonth(today), -(n - 1));
  return Array.from({ length: n }, (_, i) => addMonths(first, i).slice(0, 7));
}

/** Months covered by [from, to], as 'YYYY-MM' keys. */
export function monthsBetween(from, to) {
  if (!from || !to || from > to) return [];
  const out = [];
  for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) out.push(m.slice(0, 7));
  return out;
}

// ---- Billing --------------------------------------------------------------------

/** Billed (by issue date) and collected (by payment date) per month. */
export function revenueByMonth({ bills, payments, months }) {
  const rows = new Map(months.map((m) => [m, { month: m, billed: 0, collected: 0 }]));
  for (const b of bills) {
    if (!isIssued(b)) continue;
    const r = rows.get(String(b.issueDate).slice(0, 7));
    if (r) r.billed += billTotals(b).total;
  }
  for (const p of payments) {
    const r = rows.get(String(p.date).slice(0, 7));
    if (r) r.collected += Number(p.amountCents) || 0;
  }
  return [...rows.values()];
}

/** Open balances by client and age: [{ clientId, current, d30, d60, d90, d90plus, total, bills }]. */
export function agingByClient({ bills, payments, today }) {
  // Each bill's own payments, so balances are not a scan of every payment.
  const paysByBill = new Map();
  for (const p of payments) {
    if (!p.billId) continue;
    if (!paysByBill.has(p.billId)) paysByBill.set(p.billId, []);
    paysByBill.get(p.billId).push(p);
  }
  const byClient = new Map();
  for (const b of bills) {
    const pays = paysByBill.get(b.id) || [];
    if (billBalance(b, pays) <= 0) continue;
    const key = b.clientId || '';
    if (!byClient.has(key)) byClient.set(key, { clientId: key, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, bills: 0 });
    const r = byClient.get(key);
    const a = agingBuckets([b], pays, today);
    for (const k in a) r[k] += a[k];
    r.bills += 1;
  }
  return [...byClient.values()].map((r) => ({ ...r, total: r.current + r.d30 + r.d60 + r.d90 + r.d90plus })).sort((x, y) => y.total - x.total);
}

/**
 * A client's statement: bills as charges and payments as credits, oldest
 * first, with a running balance. Rows before `from` roll into an opening
 * balance.
 */
export function clientLedger({ clientId, bills, payments, from = '', to = '' }) {
  const mine = bills.filter((b) => b.clientId === clientId && isIssued(b));
  const ids = new Set(mine.map((b) => b.id));
  const entries = [
    ...mine.map((b) => ({ date: b.issueDate, kind: 'bill', ref: b, description: `Bill #${b.number}`, charge: billTotals(b).total, credit: 0 })),
    ...payments
      .filter((p) => ids.has(p.billId) || (!p.billId && p.contactId === clientId))
      .map((p) => ({ date: p.date, kind: 'payment', ref: p, description: 'Payment received', charge: 0, credit: Number(p.amountCents) || 0 })),
  ].sort((a, b) => (a.date === b.date ? (a.kind === 'bill' ? -1 : 1) : a.date < b.date ? -1 : 1));
  let opening = 0;
  const rows = [];
  let bal = 0;
  for (const e of entries) {
    if (to && e.date > to) continue;
    bal += e.charge - e.credit;
    if (from && e.date < from) {
      opening = bal;
      continue;
    }
    rows.push({ ...e, balance: bal });
  }
  return { opening, rows, closing: bal, charges: rows.reduce((s, r) => s + r.charge, 0), credits: rows.reduce((s, r) => s + r.credit, 0) };
}

// ---- Productivity ------------------------------------------------------------------

/** How many months [from, to] covers: each calendar month counts by the share of its days in the range. */
function monthsCovered(from, to) {
  let total = 0;
  for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) {
    const last = endOfMonth(m);
    total += (diffDays(from > m ? from : m, to < last ? to : last) + 1) / (diffDays(m, last) + 1);
  }
  return total;
}

/**
 * Hours and value per firm user in the range. The monthly target is
 * prorated to the length of the range, counted only up to `today` when the
 * range runs into the future (so "This month" compares against the target
 * to date). Realization is the value of work that made it onto issued
 * bills, as a share of billable work recorded.
 */
export function hoursByUser({ activities, users, bills, from, to, today = null }) {
  const issued = new Set(bills.filter(isIssued).map((b) => b.id));
  let start = from;
  let end = today && to && to > today && (!from || from <= today) ? today : to;
  if (!start || !end) {
    // An open-ended range counts from the first time recorded, up to today (or the last time recorded).
    const dates = activities.filter((a) => a.kind === 'time' && inRange(a.date, from, to)).map((a) => a.date);
    if (!start) start = dates.reduce((x, d) => (!x || d < x ? d : x), '');
    if (!end) end = today || dates.reduce((x, d) => (d > x ? d : x), '');
  }
  // A range that starts after it ends (only future-dated time so far) has no target yet.
  const months = start && end && start <= end ? monthsCovered(start, end) : 0;
  const rows = new Map(
    users.map((u) => [
      u.id,
      // Deactivated users keep their recorded hours but have no target.
      { userId: u.id, name: u.name, billableMinutes: 0, nonBillableMinutes: 0, workedValue: 0, billedValue: 0, targetMinutes: u.active === false ? 0 : Math.round((Number(u.targetHours) || 0) * 60 * months) },
    ]),
  );
  for (const a of activities) {
    if (a.kind !== 'time' || !inRange(a.date, from, to) || !rows.has(a.userId)) continue;
    const r = rows.get(a.userId);
    const m = Number(a.minutes) || 0;
    if (a.billable === false) r.nonBillableMinutes += m;
    else {
      r.billableMinutes += m;
      r.workedValue += activityAmount(a);
      if (a.billId && issued.has(a.billId)) r.billedValue += activityAmount(a);
    }
  }
  return [...rows.values()]
    .map((r) => ({
      ...r,
      totalMinutes: r.billableMinutes + r.nonBillableMinutes,
      utilization: r.targetMinutes ? r.billableMinutes / r.targetMinutes : null,
      realization: r.workedValue ? r.billedValue / r.workedValue : null,
    }))
    .filter((r) => r.totalMinutes || r.targetMinutes);
}

/** Time and expenses by category in the range. */
export function activityByCategory({ activities, settings, from, to }) {
  const rows = new Map();
  for (const a of activities) {
    if (!inRange(a.date, from, to)) continue;
    // Uncategorized flat fees get their own row rather than joining uncategorized time.
    const key = `${a.kind === 'expense' ? 'expense' : 'time'}:${a.categoryId || (a.kind === 'flat' ? 'flat' : '')}`;
    if (!rows.has(key))
      rows.set(key, {
        key,
        kind: a.kind === 'expense' ? 'expense' : 'time',
        categoryId: a.categoryId || '',
        name: categoryName(settings, a.categoryId) || (a.kind === 'flat' ? 'Flat fees' : 'Uncategorized'),
        count: 0,
        minutes: 0,
        amount: 0,
        billableAmount: 0,
      });
    const r = rows.get(key);
    r.count += 1;
    if (a.kind === 'time') r.minutes += Number(a.minutes) || 0;
    const v = activityAmount(a);
    r.amount += v;
    if (a.billable !== false) r.billableAmount += v;
  }
  return [...rows.values()].sort((x, y) => y.amount - x.amount || y.minutes - x.minutes);
}

// ---- Matters ------------------------------------------------------------------------

/** Matter counts per practice area by status, plus open matters per stage. */
export function mattersByArea({ matters, settings }) {
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) rows.set(id, { practiceAreaId: id, name: practiceAreaName(settings, id) || 'No practice area', open: 0, pending: 0, closed: 0, stages: new Map() });
    return rows.get(id);
  };
  for (const m of matters) {
    const r = row(m.practiceAreaId || '');
    r[m.status === 'closed' ? 'closed' : m.status === 'pending' ? 'pending' : 'open'] += 1;
    if (m.status !== 'closed') {
      const sid = m.stageId || '';
      r.stages.set(sid, (r.stages.get(sid) || 0) + 1);
    }
  }
  return [...rows.values()]
    .map((r) => ({
      ...r,
      total: r.open + r.pending + r.closed,
      stageList: [
        ...stagesFor(settings, r.practiceAreaId).map((s) => ({ id: s.id, name: s.name, count: r.stages.get(s.id) || 0 })),
        ...(r.stages.get('') ? [{ id: '', name: 'No stage', count: r.stages.get('') }] : []),
      ],
    }))
    .sort((a, b) => b.open + b.pending - (a.open + a.pending) || a.name.localeCompare(b.name));
}

/** Matters opened and closed per month. */
export function mattersByMonth({ matters, months }) {
  const rows = new Map(months.map((m) => [m, { month: m, opened: 0, closed: 0 }]));
  for (const m of matters) {
    const o = rows.get(String(m.openDate || '').slice(0, 7));
    if (o) o.opened += 1;
    if (m.status === 'closed') {
      const c = rows.get(String(m.closedDate || '').slice(0, 7));
      if (c) c.closed += 1;
    }
  }
  return [...rows.values()];
}

/**
 * Per matter: billable work recorded, billed, collected, and unbilled work
 * in progress. Activities and bills are limited to the range when given;
 * collections follow payment dates.
 */
export function matterProfitability({ matters, activities, bills, payments, from = '', to = '' }) {
  const rows = new Map(matters.map((m) => [m.id, { matterId: m.id, worked: 0, workedMinutes: 0, billed: 0, collected: 0, wip: 0 }]));
  for (const a of activities) {
    const r = rows.get(a.matterId);
    if (!r || a.billable === false || !inRange(a.date, from, to)) continue;
    const v = activityAmount(a);
    r.worked += v;
    if (a.kind === 'time') r.workedMinutes += Number(a.minutes) || 0;
    if (!a.billId) r.wip += v;
  }
  for (const b of bills) {
    const r = rows.get(b.matterId);
    if (r && isIssued(b) && inRange(b.issueDate, from, to)) r.billed += billTotals(b).total;
  }
  for (const p of payments) {
    const r = rows.get(p.matterId);
    if (r && inRange(p.date, from, to)) r.collected += Number(p.amountCents) || 0;
  }
  return [...rows.values()]
    .filter((r) => r.worked || r.billed || r.collected || r.wip)
    .map((r) => ({ ...r, collectionRate: r.billed ? r.collected / r.billed : null }))
    .sort((a, b) => b.collected - a.collected || b.worked - a.worked);
}

// ---- Trust ----------------------------------------------------------------------------

/** Trust funds held per matter (only matters that ever had trust activity or a minimum). */
export function trustByMatter({ matters, transactions, accounts }) {
  const trustIds = new Set(accounts.filter((a) => a.type === 'trust').map((a) => a.id));
  // One pass over the transactions, not one per matter.
  const balances = new Map();
  for (const t of transactions) if (trustIds.has(t.accountId)) balances.set(t.matterId, (balances.get(t.matterId) || 0) + txAmount(t));
  return matters
    .filter((m) => balances.has(m.id) || Number(m.trustMinimumCents) > 0)
    .map((m) => {
      const balance = balances.get(m.id) || 0;
      const minimum = Number(m.trustMinimumCents) || 0;
      return { matterId: m.id, clientId: m.clientId, balance, minimum, low: minimum > 0 && balance < minimum };
    })
    .sort((a, b) => b.balance - a.balance);
}

/** Trust ledger rows in the range with an opening balance carried in. */
export function trustLedgerRows({ transactions, accounts, accountId = '', matterId = '', from = '', to = '' }) {
  const trustIds = new Set(accounts.filter((a) => a.type === 'trust').map((a) => a.id));
  const list = transactions.filter((t) => trustIds.has(t.accountId) && (!accountId || t.accountId === accountId) && (!matterId || t.matterId === matterId) && (!to || t.date <= to));
  // Account ledgers start from the accounts' opening balances, as on the accounts page; matter ledgers from zero.
  const base = matterId ? 0 : accounts.reduce((sum, a) => sum + (trustIds.has(a.id) && (!accountId || a.id === accountId) ? Number(a.openingBalanceCents) || 0 : 0), 0);
  const all = ledger(list, { opening: base });
  const before = from ? all.filter((r) => r.date < from) : [];
  const rows = from ? all.filter((r) => r.date >= from) : all;
  const opening = before.length ? before[before.length - 1].balance : base;
  let deposits = 0;
  let withdrawals = 0;
  for (const r of rows) {
    if (r.type === 'withdrawal') withdrawals += Math.abs(Number(r.amountCents) || 0);
    else deposits += Math.abs(Number(r.amountCents) || 0);
  }
  return { opening, rows, deposits, withdrawals, closing: rows.length ? rows[rows.length - 1].balance : opening };
}
