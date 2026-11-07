/**
 * Operational reports: rent roll, delinquency, vacancy, leases ending,
 * deposits held, unpaid bills, maintenance, owners. Financial statements
 * live in financials.js.
 *
 * Every function is pure: (store, params, { today, ledger }) -> data.
 * Money is integer cents; dates are 'YYYY-MM-DD'.
 */
import { ACC } from './accounts.js';
import { addDays, diffDays, localDate } from './dates.js';
import { billStatus, leaseBalanceAsOf, leaseEffect } from './ledger.js';
import { effectiveEnd, isExpiring, leaseStatus, monthlyRent, renewalStatus as leaseRenewalStatus, tenantName, unitLabel } from './leases.js';
import { displayName, personName, primaryEmail, primaryPhone } from './format.js';
import { OPEN_TASK, OPEN_WORK_ORDER } from './counts.js';

const propSet = (ids) => (Array.isArray(ids) && ids.length ? new Set(ids) : null);
const inProps = (set, id) => !set || set.has(id);
const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
const byName = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
const createdDate = (r) => localDate(r.createdAt);

function names(store, lease) {
  return (lease?.tenantIds || []).map((id) => tenantName(store.get('tenants', id))).filter(Boolean).join(', ');
}

function labelFor(store, lease) {
  return unitLabel(store.get('properties', lease.propertyId), store.get('units', lease.unitId));
}

/** Active properties, or the ones asked for (inactive ones included). */
function properties(store, propertyIds) {
  const set = propSet(propertyIds);
  return store.all('properties').filter((p) => (set ? set.has(p.id) : p.active !== false));
}

/** The lease occupying a unit on a date. */
function leaseOn(leases, unitId, date) {
  return leases.find((l) => l.unitId === unitId && leaseStatus(l, date) === 'active') || null;
}

// ---- Rentals ---------------------------------------------------------------------------

/** One row per unit with its lease on `asOf`. */
export function rentRoll(store, { propertyIds = null, asOf = null } = {}, { today, ledger }) {
  const date = asOf || today;
  // For a past date, balances and deposits are what they were then.
  const past = date < today;
  const held = past ? depositsHeldByLease(store, date) : null;
  const leases = store.all('leases').filter((l) => !l.draft);
  const props = properties(store, propertyIds);
  const rows = [];
  for (const p of props) {
    const units = store.all('units').filter((u) => u.propertyId === p.id);
    for (const u of units) {
      const lease = leaseOn(leases, u.id, date);
      const info = lease ? ledger.lease(lease.id) : null;
      rows.push({
        propertyId: p.id,
        property: p.name,
        unitId: u.id,
        unit: u.name,
        label: unitLabel(p, u),
        leaseId: lease?.id || null,
        status: lease ? 'occupied' : 'vacant',
        tenants: lease ? names(store, lease) : '',
        start: lease?.start || '',
        end: lease ? effectiveEnd(lease) || lease.end || '' : '',
        marketRent: Number(u.marketRent) || 0,
        rent: lease ? monthlyRent(lease, date) : 0,
        deposit: info ? (past ? held.get(lease.id) || 0 : info.deposits) : 0,
        balance: info ? (past ? leaseBalanceAsOf(info, date) : info.balance) : 0,
      });
    }
  }
  rows.sort((a, b) => byName(a.property, b.property) || byName(a.unit, b.unit));
  const occupied = rows.filter((r) => r.status === 'occupied').length;
  return {
    rows,
    totals: {
      units: rows.length,
      occupied,
      vacant: rows.length - occupied,
      occupancy: rows.length ? occupied / rows.length : 0,
      marketRent: sum(rows, 'marketRent'),
      rent: sum(rows, 'rent'),
      deposit: sum(rows, 'deposit'),
      balance: sum(rows, 'balance'),
    },
  };
}

export const AGING_BUCKETS = [
  { id: 'b0', label: '0 to 30 days', max: 30 },
  { id: 'b31', label: '31 to 60 days', max: 60 },
  { id: 'b61', label: '61 to 90 days', max: 90 },
  { id: 'b91', label: 'Over 90 days', max: Infinity },
];

function bucketOf(days) {
  return AGING_BUCKETS.find((b) => days <= b.max).id;
}

/**
 * Open charges by age on a date. Payments and credits settle the oldest
 * charges first; what is left is bucketed by the charge date.
 */
export function agingFor(leaseInfo, asOf) {
  const debits = [];
  let credit = 0;
  for (const l of leaseInfo.lines) {
    if (l.date > asOf) break;
    if (l.kind === 'apply-prepayment') continue; // moves money within the lease, no effect on what is owed
    if (l.amount > 0) debits.push({ date: l.date, amount: l.amount });
    else credit += -l.amount;
  }
  const out = { b0: 0, b31: 0, b61: 0, b91: 0, total: 0, oldest: null };
  for (const d of debits) {
    const used = Math.min(credit, d.amount);
    credit -= used;
    const open = d.amount - used;
    if (!open) continue;
    out[bucketOf(diffDays(d.date, asOf))] += open;
    out.total += open;
    if (!out.oldest) out.oldest = d.date;
  }
  return out;
}

/** Leases that owe money on `asOf`, with aging buckets. */
export function delinquency(store, { asOf = null, propertyIds = null, minBalance = 1 } = {}, { today, ledger }) {
  const date = asOf || today;
  const set = propSet(propertyIds);
  const rows = [];
  for (const lease of store.all('leases')) {
    if (lease.draft || !inProps(set, lease.propertyId)) continue;
    const info = ledger.lease(lease.id);
    if (!info.lines.length) continue;
    const a = agingFor(info, date);
    if (a.total < minBalance) continue;
    let lastPaymentDate = '';
    for (const l of info.lines) {
      if (l.date > date) break;
      if (l.kind === 'payment') lastPaymentDate = l.date;
    }
    rows.push({
      leaseId: lease.id,
      propertyId: lease.propertyId,
      unitId: lease.unitId,
      label: labelFor(store, lease),
      tenants: names(store, lease),
      status: leaseStatus(lease, date),
      evictionPending: !!lease.evictionPending,
      ...a,
      lastPaymentDate,
      daysLate: a.oldest ? diffDays(a.oldest, date) : 0,
    });
  }
  rows.sort((x, y) => y.total - x.total);
  return { rows, totals: { leases: rows.length, b0: sum(rows, 'b0'), b31: sum(rows, 'b31'), b61: sum(rows, 'b61'), b91: sum(rows, 'b91'), total: sum(rows, 'total') } };
}

/** Units with no active lease on `asOf`, with days vacant and rent lost so far. */
export function vacancy(store, { asOf = null, propertyIds = null } = {}, { today }) {
  const date = asOf || today;
  const leases = store.all('leases').filter((l) => !l.draft);
  const rows = [];
  for (const p of properties(store, propertyIds)) {
    for (const u of store.all('units').filter((x) => x.propertyId === p.id)) {
      if (leaseOn(leases, u.id, date)) continue;
      const mine = leases.filter((l) => l.unitId === u.id);
      const ended = mine
        .map((l) => effectiveEnd(l))
        .filter((d) => d && d < date)
        .sort()
        .pop();
      const next = mine
        .filter((l) => l.start > date)
        .sort((a, b) => (a.start < b.start ? -1 : 1))[0];
      const since = ended ? addDays(ended, 1) : createdDate(u) || null;
      const days = since && since <= date ? diffDays(since, date) : 0;
      rows.push({
        propertyId: p.id,
        unitId: u.id,
        label: unitLabel(p, u),
        property: p.name,
        unit: u.name,
        vacantSince: since || '',
        days,
        marketRent: Number(u.marketRent) || 0,
        lostRent: Math.round(((Number(u.marketRent) || 0) * days * 12) / 365),
        listed: !!u.listing?.listed,
        available: u.listing?.available || '',
        nextLeaseId: next?.id || null,
        nextMoveIn: next?.start || '',
      });
    }
  }
  rows.sort((a, b) => b.days - a.days || byName(a.label, b.label));
  return { rows, totals: { units: rows.length, marketRent: sum(rows, 'marketRent'), lostRent: sum(rows, 'lostRent'), listed: rows.filter((r) => r.listed).length } };
}

/** Tenants on active leases, one row per tenant per lease. */
export function currentTenants(store, { propertyIds = null } = {}, { today }) {
  const set = propSet(propertyIds);
  const rows = [];
  for (const lease of store.all('leases')) {
    if (leaseStatus(lease, today) !== 'active' || !inProps(set, lease.propertyId)) continue;
    for (const id of lease.tenantIds || []) {
      const t = store.get('tenants', id);
      if (!t) continue;
      rows.push({ tenantId: t.id, name: personName(t), company: t.company || '', email: primaryEmail(t), phone: primaryPhone(t), leaseId: lease.id, label: labelFor(store, lease), start: lease.start, end: effectiveEnd(lease) || lease.end || '' });
    }
  }
  rows.sort((a, b) => byName(a.label, b.label) || byName(a.name, b.name));
  return { rows, totals: { tenants: rows.length } };
}

export function tenantVehicles(store, { propertyIds = null } = {}, { today }) {
  const out = [];
  for (const r of currentTenants(store, { propertyIds }, { today }).rows) {
    const t = store.get('tenants', r.tenantId);
    for (const v of t.vehicles || []) out.push({ ...r, make: v.make || '', model: v.model || '', color: v.color || '', plate: v.plate || '', year: v.year || '' });
  }
  return { rows: out, totals: { vehicles: out.length } };
}

/** A lease statement: opening balance, every transaction in range, running balance. */
export function tenantLedger(store, { leaseId, from = null, to = null } = {}) {
  const lease = store.get('leases', leaseId);
  if (!lease) return { lease: null, opening: 0, rows: [], closing: 0, totals: { charges: 0, credits: 0 } };
  const txs = store
    .all('transactions')
    .filter((t) => !t.voided && t.lines.some((l) => l.leaseId === leaseId))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));
  let opening = 0;
  const rows = [];
  for (const tx of txs) {
    if (to && tx.date > to) continue;
    const effect = leaseEffect(tx, leaseId);
    if (!effect) continue;
    if (from && tx.date < from) {
      opening += effect;
      continue;
    }
    rows.push({ txId: tx.id, date: tx.date, kind: tx.kind, memo: tx.memo || '', ref: tx.ref || '', charge: effect > 0 ? effect : 0, credit: effect < 0 ? -effect : 0, balance: 0 });
  }
  let bal = opening;
  for (const r of rows) r.balance = bal += r.charge - r.credit;
  return { lease, label: labelFor(store, lease), tenants: names(store, lease), opening, rows, closing: bal, totals: { charges: sum(rows, 'charge'), credits: sum(rows, 'credit') } };
}

/** Security deposits held per lease on `asOf` (credits to the deposits account). */
/** leaseId -> security deposit collected and still held at the end of `date`. */
function depositsHeldByLease(store, date) {
  const held = new Map();
  const unpaid = new Map(); // receivable still open on deposit charges
  for (const tx of store.all('transactions')) {
    if (tx.voided || tx.date > date) continue;
    for (const l of tx.lines) {
      if (!l.leaseId) continue;
      if (l.accountId === ACC.depositsHeld) held.set(l.leaseId, (held.get(l.leaseId) || 0) - l.amount);
      else if (l.accountId === ACC.ar && l.forAccountId === ACC.depositsHeld) unpaid.set(l.leaseId, (unpaid.get(l.leaseId) || 0) + l.amount);
    }
  }
  // Only what was actually collected is held.
  const out = new Map();
  for (const [leaseId, charged] of held) out.set(leaseId, Math.max(0, charged - Math.max(0, unpaid.get(leaseId) || 0)));
  return out;
}

export function depositsHeld(store, { asOf = null, propertyIds = null } = {}, { today }) {
  const date = asOf || today;
  const set = propSet(propertyIds);
  const rows = [];
  for (const [leaseId, amount] of depositsHeldByLease(store, date)) {
    if (!amount) continue;
    const lease = store.get('leases', leaseId);
    if (!lease || !inProps(set, lease.propertyId)) continue;
    rows.push({ leaseId, label: labelFor(store, lease), tenants: names(store, lease), status: leaseStatus(lease, date), start: lease.start, end: effectiveEnd(lease) || lease.end || '', expected: Number(lease.deposit) || 0, amount });
  }
  rows.sort((a, b) => byName(a.label, b.label));
  return { rows, totals: { leases: rows.length, amount: sum(rows, 'amount'), expected: sum(rows, 'expected') } };
}

// ---- Leasing -------------------------------------------------------------------------------

/** Leases whose term (or move-out) ends in [from, to]. */
export function leasesEnding(store, { from, to, propertyIds = null } = {}, { today }) {
  const set = propSet(propertyIds);
  const rows = [];
  for (const lease of store.all('leases')) {
    if (lease.draft || !inProps(set, lease.propertyId)) continue;
    const end = lease.moveOut?.date || lease.end;
    if (!end || (from && end < from) || (to && end > to)) continue;
    rows.push({
      leaseId: lease.id,
      label: labelFor(store, lease),
      tenants: names(store, lease),
      type: lease.type,
      start: lease.start,
      end,
      moveOut: !!lease.moveOut?.date,
      rent: monthlyRent(lease, end < today ? end : today),
      renewal: lease.moveOut?.date ? 'declined' : leaseRenewalStatus(lease),
      daysLeft: diffDays(today, end),
    });
  }
  rows.sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
  return { rows, totals: { leases: rows.length, rent: sum(rows, 'rent') } };
}

/** Renewal pipeline: leases expiring within `days`, plus any with a renewal underway. */
export function renewalStatus(store, { days = null, propertyIds = null } = {}, { today }) {
  const set = propSet(propertyIds);
  const window = days ?? store.state?.settings?.leases?.noticeDays ?? 60;
  const rows = [];
  for (const lease of store.all('leases')) {
    if (lease.draft || !inProps(set, lease.propertyId)) continue;
    const status = leaseRenewalStatus(lease);
    const underway = status !== 'not-started' && leaseStatus(lease, today) === 'active';
    if (!isExpiring(lease, today, window) && !underway) continue;
    const rent = monthlyRent(lease, today);
    rows.push({ leaseId: lease.id, label: labelFor(store, lease), tenants: names(store, lease), end: lease.end, daysLeft: lease.end ? diffDays(today, lease.end) : null, rent, status, offerRent: lease.renewal?.offerRent || 0, change: lease.renewal?.offerRent ? lease.renewal.offerRent - rent : 0 });
  }
  rows.sort((a, b) => (a.end || '9999') < (b.end || '9999') ? -1 : 1);
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  return { rows, totals: { leases: rows.length, counts } };
}

export function applicantsReport(store, { from = null, to = null, status = '', source = '' } = {}) {
  const rows = [];
  for (const a of store.all('applicants')) {
    const d = a.appliedOn || createdDate(a);
    if ((from && d < from) || (to && d > to)) continue;
    if (status && a.status !== status) continue;
    if (source && (a.source || '') !== source) continue;
    const p = store.get('properties', a.propertyId);
    const u = store.get('units', a.unitId);
    rows.push({ applicantId: a.id, name: personName(a), email: a.email || '', phone: a.phone || '', label: p ? unitLabel(p, u) : '', appliedOn: d, moveIn: a.moveIn || '', income: Number(a.income) || 0, status: a.status || 'new', source: a.source || 'Unknown' });
  }
  rows.sort((a, b) => (a.appliedOn < b.appliedOn ? 1 : -1));
  const byStatus = {};
  const bySource = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    bySource[r.source] = (bySource[r.source] || 0) + 1;
  }
  return { rows, totals: { applicants: rows.length, byStatus, bySource } };
}

// ---- Accounting -------------------------------------------------------------------------------

export const BILL_AGING = [
  { id: 'current', label: 'Not yet due' },
  { id: 'd1', label: '1 to 30 days late', max: 30 },
  { id: 'd31', label: '31 to 60 days late', max: 60 },
  { id: 'd61', label: '61 to 90 days late', max: 90 },
  { id: 'd91', label: 'Over 90 days late', max: Infinity },
];

/** Unpaid and partly paid bills on `asOf`, aged by due date. */
export function unpaidBills(store, { asOf = null, propertyIds = null, vendorId = '' } = {}, { today }) {
  const date = asOf || today;
  const set = propSet(propertyIds);
  // With a property filter, a bill shared with other properties counts only
  // its lines (and the parts of payments) for the chosen properties.
  const paid = new Map();
  const paidInAll = new Map(); // what each bill has been paid in total
  for (const tx of store.all('transactions')) {
    if (tx.voided || tx.kind !== 'bill-payment' || tx.date > date) continue;
    for (const a of tx.allocations || []) paidInAll.set(a.billId, (paidInAll.get(a.billId) || 0) + a.amount);
    if (set) for (const l of tx.lines) if (l.accountId === ACC.ap && l.billId && set.has(l.propertyId)) paid.set(l.billId, (paid.get(l.billId) || 0) + l.amount);
  }
  if (!set) for (const [id, v] of paidInAll) paid.set(id, v);
  const rows = [];
  for (const bill of store.all('transactions')) {
    if (bill.kind !== 'bill' || bill.voided || bill.date > date) continue;
    if (vendorId && bill.vendorId !== vendorId) continue;
    if (set && !bill.lines.some((l) => set.has(l.propertyId))) continue;
    // A bill paid in full is not unpaid on any property, even where older
    // payments rounded a cent onto another property.
    const billTotal = -bill.lines.filter((l) => l.accountId === ACC.ap).reduce((s, l) => s + l.amount, 0);
    if (billTotal - (paidInAll.get(bill.id) || 0) <= 0) continue;
    const total = -bill.lines.filter((l) => l.accountId === ACC.ap && (!set || set.has(l.propertyId))).reduce((s, l) => s + l.amount, 0);
    const balance = total - (paid.get(bill.id) || 0);
    if (balance <= 0) continue;
    const late = bill.dueDate && bill.dueDate < date ? diffDays(bill.dueDate, date) : 0;
    const bucket = late <= 0 ? 'current' : BILL_AGING.find((b) => b.max && late <= b.max).id;
    const vendor = store.get('vendors', bill.vendorId);
    rows.push({ billId: bill.id, vendorId: bill.vendorId, vendor: vendor ? displayName(vendor) : 'Unknown vendor', date: bill.date, dueDate: bill.dueDate || bill.date, ref: bill.ref || '', memo: bill.memo || '', total, paid: total - balance, balance, daysLate: Math.max(0, late), bucket });
  }
  rows.sort((a, b) => byName(a.vendor, b.vendor) || (a.dueDate < b.dueDate ? -1 : 1));
  const totals = { bills: rows.length, total: sum(rows, 'total'), balance: sum(rows, 'balance') };
  for (const b of BILL_AGING) totals[b.id] = rows.filter((r) => r.bucket === b.id).reduce((s, r) => s + r.balance, 0);
  return { rows, totals };
}

// ---- Maintenance ----------------------------------------------------------------------------

/** Work orders due (or created, when undated) in [from, to]. */
export function workOrdersReport(store, { from = null, to = null, status = '', vendorId = '', propertyIds = null } = {}, { today, ledger }) {
  const set = propSet(propertyIds);
  const rows = [];
  for (const w of store.all('workOrders')) {
    const d = w.dueDate || createdDate(w);
    if ((from && d < from) || (to && d > to)) continue;
    if (status === 'open' ? !OPEN_WORK_ORDER.has(w.status) : status && w.status !== status) continue;
    if (vendorId && w.vendorId !== vendorId) continue;
    if (!inProps(set, w.propertyId)) continue;
    const p = store.get('properties', w.propertyId);
    const u = store.get('units', w.unitId);
    const v = store.get('vendors', w.vendorId);
    const billed = w.billId && ledger ? ledger.bill(w.billId).total : 0;
    rows.push({
      workOrderId: w.id,
      number: w.number,
      title: w.title,
      label: p ? unitLabel(p, u) : '',
      vendor: v ? displayName(v) : '',
      status: w.status,
      priority: w.priority || 'normal',
      dueDate: w.dueDate || '',
      completedOn: w.completedOn || '',
      overdue: !!w.dueDate && w.dueDate < today && OPEN_WORK_ORDER.has(w.status),
      cost: billed || Number(w.cost) || 0,
    });
  }
  rows.sort((a, b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1);
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  return { rows, totals: { workOrders: rows.length, open: rows.filter((r) => OPEN_WORK_ORDER.has(r.status)).length, overdue: rows.filter((r) => r.overdue).length, cost: sum(rows, 'cost'), byStatus } };
}

/** Vendor insurance: expired, expiring within `days`, missing, or current. */
export function vendorInsurance(store, { days = 60, includeCurrent = false } = {}, { today }) {
  const rows = [];
  for (const v of store.all('vendors')) {
    if (v.active === false) continue;
    const exp = v.insuranceExpires || '';
    const left = exp ? diffDays(today, exp) : null;
    const state = !exp ? 'missing' : left < 0 ? 'expired' : left <= days ? 'expiring' : 'current';
    if (state === 'current' && !includeCurrent) continue;
    rows.push({ vendorId: v.id, name: displayName(v), category: v.category || '', email: primaryEmail(v), phone: primaryPhone(v), expires: exp, daysLeft: left, state });
  }
  const order = { expired: 0, expiring: 1, missing: 2, current: 3 };
  rows.sort((a, b) => order[a.state] - order[b.state] || (a.expires || '9999').localeCompare(b.expires || '9999'));
  return { rows, totals: { vendors: rows.length, expired: rows.filter((r) => r.state === 'expired').length, expiring: rows.filter((r) => r.state === 'expiring').length, missing: rows.filter((r) => r.state === 'missing').length } };
}

export function openTasksReport(store, { assigneeId = '', propertyIds = null } = {}, { today }) {
  const set = propSet(propertyIds);
  const rows = [];
  for (const t of store.all('tasks')) {
    if (!OPEN_TASK.has(t.status)) continue;
    if (assigneeId && t.assigneeId !== assigneeId) continue;
    if (set && !set.has(t.propertyId)) continue;
    const p = store.get('properties', t.propertyId);
    rows.push({ taskId: t.id, number: t.number, title: t.title, kind: t.kind || 'todo', status: t.status, priority: t.priority || 'normal', dueDate: t.dueDate || '', overdue: !!t.dueDate && t.dueDate < today, assignee: store.get('team', t.assigneeId)?.name || '', label: p ? unitLabel(p, store.get('units', t.unitId)) : '' });
  }
  rows.sort((a, b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1);
  return { rows, totals: { tasks: rows.length, overdue: rows.filter((r) => r.overdue).length } };
}

// ---- Owners -------------------------------------------------------------------------------

/** All owners: properties, units, income, expenses and net for a period (by ownership share). */
export function ownerSummary(store, { from = null, to = null } = {}) {
  const accounts = new Map(store.all('accounts').map((a) => [a.id, a]));
  const byProp = new Map(); // propertyId -> { income, expense }
  for (const tx of store.all('transactions')) {
    if (tx.voided || (from && tx.date < from) || (to && tx.date > to)) continue;
    for (const l of tx.lines) {
      if (!l.propertyId) continue;
      const t = accounts.get(l.accountId)?.type;
      if (t !== 'income' && t !== 'expense') continue;
      const p = byProp.get(l.propertyId) || { income: 0, expense: 0 };
      if (t === 'income') p.income += -l.amount;
      else p.expense += l.amount;
      byProp.set(l.propertyId, p);
    }
  }
  const rows = [];
  for (const o of store.all('owners')) {
    let income = 0;
    let expense = 0;
    let props = 0;
    let units = 0;
    for (const p of store.all('properties')) {
      const share = (p.owners || []).find((s) => s.ownerId === o.id);
      if (!share) continue;
      const k = (Number(share.pct) || 0) / 100;
      props++;
      units += store.all('units').filter((u) => u.propertyId === p.id).length;
      const t = byProp.get(p.id) || { income: 0, expense: 0 };
      income += t.income * k;
      expense += t.expense * k;
    }
    income = Math.round(income);
    expense = Math.round(expense);
    rows.push({ ownerId: o.id, name: displayName(o), properties: props, units, income, expense, net: income - expense, fee: Number(o.managementFee) || 0 });
  }
  rows.sort((a, b) => byName(a.name, b.name));
  return { rows, totals: { owners: rows.length, income: sum(rows, 'income'), expense: sum(rows, 'expense'), net: sum(rows, 'net') } };
}
