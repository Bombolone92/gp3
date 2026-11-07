/**
 * Leases: status, terms, occupancy, and automatic posting.
 *
 * A lease's rent and any other monthly charges are `recurring` items:
 *   { id, accountId, amount, day, start, end?, memo, postedThrough }
 * `postedThrough` is the last due date already charged. Posting walks each
 * item forward from there, so charges are never posted twice and a charge
 * someone deleted on purpose is not recreated.
 *
 * Auto-posted transactions get ids derived from the lease, item and date.
 * When two devices (or two team members) post at the same moment they write
 * the same records instead of duplicates.
 */
import { ACC } from './accounts.js';
import { addDays, addMonths, diffDays, endOfMonth, pad, toISODate } from './dates.js';
import { buildCharge, buildApplyPrepayment, leaseBalanceAsOf } from './ledger.js';
import { newId } from './ids.js';

/** Days after the grace period ends that a late fee is still posted automatically. */
const LATE_FEE_WINDOW = 45;

export const LEASE_STATUS = {
  draft: { label: 'Draft', tone: 'neutral' },
  future: { label: 'Future', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  past: { label: 'Past', tone: 'neutral' },
};

/** The last day the tenant is responsible for, or null when open-ended. */
export function effectiveEnd(lease) {
  if (lease.moveOut?.date) return lease.moveOut.date;
  if (lease.type === 'fixed') return lease.end || null;
  return null;
}

export function leaseStatus(lease, today) {
  if (lease.draft) return 'draft';
  if (lease.start && lease.start > today) return 'future';
  const end = effectiveEnd(lease);
  if (end && end < today) return 'past';
  return 'active';
}

/** Days until the term ends (fixed-term leases only), or null. */
export function daysLeft(lease, today) {
  if (lease.draft || !lease.end || lease.type === 'at-will' || lease.moveOut?.date) return null;
  const d = diffDays(today, lease.end);
  return d >= 0 ? d : null;
}

/** Fixed-term leases whose term ends within `days` and have no move-out yet. */
export function isExpiring(lease, today, days = 60) {
  const d = daysLeft(lease, today);
  return d !== null && d <= days && leaseStatus(lease, today) === 'active';
}

export function renewalStatus(lease) {
  return lease.renewal?.status || 'not-started';
}

export const RENEWAL_STATUS = {
  'not-started': { label: 'Not started', tone: 'neutral' },
  offered: { label: 'Offer sent', tone: 'info' },
  accepted: { label: 'Renewing', tone: 'success' },
  declined: { label: 'Moving out', tone: 'warning' },
};

export function rentItem(lease) {
  return (lease.recurring || []).find((r) => r.accountId === ACC.rent) || null;
}

/**
 * Monthly rent on a date: the rent items in effect that day. Before rent
 * starts (a future lease, or a first month charged separately) it is the
 * first rent to come; after it stops, the last rent charged. A scheduled
 * change counts only from its own start date. Without a date, today's
 * device date.
 */
export function monthlyRent(lease, date = null) {
  const on = date || toISODate(new Date());
  const items = (lease.recurring || []).filter((r) => r.accountId === ACC.rent);
  const total = (list) => list.reduce((s, r) => s + (r.amount || 0), 0);
  const current = items.filter((r) => (!r.start || r.start <= on) && (!r.end || r.end >= on));
  if (current.length) return total(current);
  const next = items.filter((r) => r.start > on).map((r) => r.start).sort()[0];
  if (next) return total(items.filter((r) => r.start === next));
  const last = items.map((r) => r.end || '').filter((e) => e && e < on).sort().pop();
  return last ? total(items.filter((r) => r.end === last)) : 0;
}

export function leaseTenants(store, lease) {
  return (lease.tenantIds || []).map((id) => store.get('tenants', id)).filter(Boolean);
}

export function tenantName(t) {
  if (!t) return '';
  return [t.firstName, t.lastName].filter(Boolean).join(' ') || t.company || 'Unnamed';
}

export function leaseLabel(store, lease) {
  const unit = store.get('units', lease.unitId);
  const property = store.get('properties', lease.propertyId);
  return unitLabel(property, unit);
}

export function unitLabel(property, unit) {
  if (!property) return unit?.name || '';
  if (!unit || property.singleUnit) return property.name;
  return `${property.name} · ${unit.name}`;
}

/** Leases on a unit, newest first. */
export function unitLeases(store, unitId) {
  return store
    .all('leases')
    .filter((l) => l.unitId === unitId)
    .sort((a, b) => (a.start < b.start ? 1 : -1));
}

/** The lease occupying a unit today (active, not draft), or null. */
export function currentLease(store, unitId, today) {
  return unitLeases(store, unitId).find((l) => leaseStatus(l, today) === 'active') || null;
}

/** Occupancy index: unitId -> active lease. One pass over leases. */
export function occupancy(leases, today) {
  const m = new Map();
  for (const l of leases) if (leaseStatus(l, today) === 'active' && !m.has(l.unitId)) m.set(l.unitId, l);
  return m;
}

// ---- Recurring dates ------------------------------------------------------------

function dayInMonth(year, month, day) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(Math.max(1, day), last))}`;
}

/**
 * Monthly due dates for a recurring item in (after, upTo], limited to the
 * item's own start and end.
 */
export function dueDates(item, after, upTo, limit = 120) {
  const out = [];
  const from = item.start && (!after || item.start > after) ? addDays(item.start, -1) : after;
  if (!from) return out;
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (let i = 0; i < limit + 2 && out.length < limit; i++) {
    const d = dayInMonth(y, m, item.day || 1);
    if (d > upTo || (item.end && d > item.end)) break;
    if (d > from && (!item.start || d >= item.start)) out.push(d);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The first rent due date on or after `date`, using the lease's rent day. */
export function nextDueDate(item, date) {
  return dueDates({ ...item, start: null, end: null }, addDays(date, -1), addMonths(date, 2), 1)[0] || date;
}

// ---- Posting ------------------------------------------------------------------

/**
 * Work out what needs posting today. Pure: returns
 *   { transactions: [...], leasePatches: Map(leaseId -> changes) }
 * index is a ledgerIndex (for prepaid credit and late fee checks).
 */
export function computePostings({ leases, index, settings, today, accountsById = new Map(), exists = () => false }) {
  const txs = [];
  const patches = new Map();
  const ahead = Math.max(0, Number(settings.accounting?.postDaysAhead) || 0);
  const horizon = addDays(today, ahead);

  for (const lease of leases) {
    if (lease.draft) continue;
    const status = leaseStatus(lease, today);
    if (status === 'past') {
      const end = effectiveEnd(lease) || '';
      const unposted = lease.recurring?.some((r) => (r.postedThrough || '') < end);
      // Late fees being tracked can still be due for the last month or two.
      const lastRent = (lease.recurring || []).filter((r) => r.accountId === ACC.rent).map((r) => r.postedThrough || '').sort().pop() || '';
      const feesDue = !!lease.lateFeesThrough && lease.lateFeesThrough < lastRent.slice(0, 7) && lastRent >= addDays(today, -LATE_FEE_WINDOW);
      if (!unposted && !feesDue) continue;
    }
    const end = effectiveEnd(lease);
    const info = index.lease(lease.id);
    let prepaid = info.prepaid; // credit available to apply to new charges
    const recurring = (lease.recurring || []).map((r) => ({ ...r }));
    let changed = false;

    for (const item of recurring) {
      if (!item.amount || !item.accountId) continue;
      const upTo = end && end < horizon ? end : horizon;
      // Monthly items post once per calendar month: after the last posted
      // due date, the next one is in a later month even if the due day
      // was changed since.
      const after = item.postedThrough ? endOfMonth(item.postedThrough) : addDays(item.start || lease.start, -1);
      const dates = dueDates({ ...item, start: item.start || lease.start, end: item.end || end }, after, upTo, 36);
      for (const date of dates) {
        const id = `rc-${lease.id}-${item.id}-${date}`;
        // Already posted (by another device, or before this lease record
        // was saved from an older copy): it is in the ledger and the index.
        if (exists(id)) {
          item.postedThrough = date;
          changed = true;
          continue;
        }
        const charge = buildCharge({
          lease,
          id,
          date,
          dueDate: date,
          auto: true,
          memo: item.memo || accountsById.get?.(item.accountId)?.name || 'Rent',
          items: [{ accountId: item.accountId, amount: item.amount }],
        });
        txs.push(charge);
        if (prepaid > 0) {
          const apply = Math.min(prepaid, item.amount);
          prepaid -= apply;
          txs.push(buildApplyPrepayment({ lease, id: `ap-${id}`, date, items: [{ accountId: item.accountId, amount: apply }] }));
        }
        item.postedThrough = date;
        changed = true;
      }
    }
    if (changed) patches.set(lease.id, { recurring });

    // Late fees: one per month, when rent is still unpaid after the grace period.
    const policy = lease.lateFee?.enabled === false ? null : { ...settings.lateFee, ...(lease.lateFee || {}) };
    // Every rent item counts: a rent change stops one item and adds another.
    const rents = recurring.filter((r) => r.accountId === ACC.rent && r.postedThrough);
    if (policy?.enabled && rents.length) {
      const grace = Math.max(0, Number(policy.graceDays) || 0);
      let through = lease.lateFeesThrough || '';
      const firstStart = rents.map((r) => r.start || lease.start).sort()[0];
      const after = through ? `${through}-31` : addDays(firstStart, -1);
      // The first due date in each month, with the rent due that month.
      const byMonth = new Map();
      for (const r of rents) {
        for (const d of dueDates({ ...r, start: r.start || lease.start, end: r.end || end }, after, r.postedThrough, 24)) {
          const m = byMonth.get(d.slice(0, 7));
          if (!m) byMonth.set(d.slice(0, 7), { date: d, amount: r.amount || 0 });
          else {
            if (d < m.date) m.date = d;
            m.amount += r.amount || 0;
          }
        }
      }
      const dues = [...byMonth.values()].sort((x, y) => (x.date < y.date ? -1 : 1)).slice(0, 24);
      // Charges about to be posted in this run count toward the balance.
      const pendingLines = txs
        .filter((t) => t.leaseId === lease.id)
        .flatMap((t) => t.lines.filter((l) => l.accountId === ACC.ar || l.accountId === ACC.prepaid).map((l) => ({ date: t.date, amount: l.amount, forAccountId: l.forAccountId, prepaid: l.accountId === ACC.prepaid })));
      const lines = pendingLines.length ? [...info.lines, ...pendingLines].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) : info.lines;
      for (const { date: due, amount: rentDue } of dues) {
        const check = addDays(due, grace);
        if (check >= today) break; // still within the grace period
        const month = due.slice(0, 7);
        const owed = leaseBalanceAsOf({ lines }, check, { forAccountId: ACC.rent });
        // A fee is posted only while it is recent; months long past are
        // marked as checked but not back-billed (as with rent, old months
        // are charged only on purpose).
        const recent = check >= addDays(today, -LATE_FEE_WINDOW);
        if (recent && owed >= Math.max(1, Number(policy.minBalance) || 0)) {
          const fee = policy.kind === 'percent' ? Math.round((rentDue * (Number(policy.percent) || 0)) / 100) : Number(policy.amount) || 0;
          if (fee > 0) {
            txs.push(
              buildCharge({
                lease,
                id: `lf-${lease.id}-${month}`,
                date: addDays(check, 1),
                dueDate: addDays(check, 1),
                auto: true,
                memo: `Late fee for ${monthName(month)} rent`,
                items: [{ accountId: ACC.lateFees, amount: fee }],
              }),
            );
          }
        }
        through = month;
      }
      if (through && through !== (lease.lateFeesThrough || '')) patches.set(lease.id, { ...(patches.get(lease.id) || {}), lateFeesThrough: through });
    }
  }
  return { transactions: txs, leasePatches: patches };
}

function monthName(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Apply computePostings to a store. Returns the number of charges posted. */
export function postDue(store, { index, settings, today }) {
  const accountsById = new Map(store.all('accounts').map((a) => [a.id, a]));
  const exists = (id) => !!store.get('transactions', id);
  const { transactions, leasePatches } = computePostings({ leases: store.all('leases'), index, settings, today, accountsById, exists });
  // Skip anything that already exists (posted by another device).
  // Charges on sample leases are sample records too, so removing the sample
  // portfolio takes them along.
  const sampleLeases = new Set(store.all('leases').filter((l) => l.sample).map((l) => l.id));
  const fresh = transactions.filter((t) => !store.get('transactions', t.id)).map((t) => (sampleLeases.has(t.leaseId) ? { ...t, sample: true } : t));
  if (fresh.length) store.bulkPut('transactions', fresh);
  for (const [id, changes] of leasePatches) store.patch('leases', id, changes);
  return fresh.filter((t) => t.kind === 'charge').length;
}

/** A new recurring item. */
export function newRecurring({ accountId = ACC.rent, amount = 0, day = 1, start, end = null, memo = '', postedThrough = null } = {}) {
  return { id: newId(), accountId, amount, day, start, end, memo, postedThrough };
}

/**
 * When posting should begin for a new lease: the lease start, or for a lease
 * that started in the past, the current month's due date so old months are
 * not charged unless asked for.
 */
export function defaultPostingStart(lease, today) {
  if (!lease.start || lease.start >= today) return lease.start;
  const monthStart = `${today.slice(0, 7)}-01`;
  return lease.start > monthStart ? lease.start : monthStart;
}
