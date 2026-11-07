/**
 * Counts that need attention, for navigation badges and the dashboard.
 * Pure: takes the store, today, and a ledger index.
 */
import { billStatus } from './ledger.js';
import { isExpiring, leaseStatus, renewalStatus } from './leases.js';
import { pluralize } from './format.js';

export const OPEN_WORK_ORDER = new Set(['new', 'assigned', 'in-progress', 'waiting']);
export const OPEN_TASK = new Set(['new', 'in-progress', 'waiting']);
/** Task kinds that are requests from outside: residents, owners and other contacts. */
export const INCOMING_KINDS = new Set(['resident', 'owner', 'contact']);

export function navCounts(store, today, ledger) {
  const settings = store.state.settings;
  const leases = store.all('leases');

  let owing = 0;
  for (const l of leases) if (!l.draft && ledger.lease(l.id).balance > 0) owing++;

  const expiring = leases.filter((l) => isExpiring(l, today, settings.leases?.noticeDays ?? 60) && renewalStatus(l) === 'not-started' && !leases.some((n) => n.renewsLeaseId === l.id)).length;

  let overdueBills = 0;
  for (const t of store.all('transactions')) if (t.kind === 'bill' && billStatus(t, ledger.bill(t.id), today) === 'overdue') overdueBills++;

  const newApplicants = store.all('applicants').filter((a) => a.status === 'new').length;
  const newWorkOrders = store.all('workOrders').filter((w) => w.status === 'new').length;
  const incoming = store.all('tasks').filter((t) => t.status === 'new' && INCOMING_KINDS.has(t.kind)).length;

  return {
    balances: { n: owing, label: `${pluralize(owing, 'lease')} with a balance due` },
    renewals: { n: expiring, label: `${pluralize(expiring, 'lease')} expiring without a renewal started` },
    bills: { n: overdueBills, label: `${pluralize(overdueBills, 'bill')} overdue` },
    applicants: { n: newApplicants, label: `${pluralize(newApplicants, 'new applicant')}` },
    workOrders: { n: newWorkOrders, label: `${pluralize(newWorkOrders, 'new work order')}` },
    tasks: { n: incoming, label: `${pluralize(incoming, 'new request')}` },
  };
}

/** Portfolio occupancy for today: { units, occupied, vacant, rate }. */
export function occupancyStats(store, today) {
  const units = store.all('units').filter((u) => store.get('properties', u.propertyId)?.active !== false);
  const occupiedIds = new Set(store.all('leases').filter((l) => leaseStatus(l, today) === 'active').map((l) => l.unitId));
  const occupied = units.filter((u) => occupiedIds.has(u.id)).length;
  return { units: units.length, occupied, vacant: units.length - occupied, rate: units.length ? occupied / units.length : 0 };
}
