/**
 * Shared runtime context: the store, the signed-in user, and helpers views
 * use often. Set once at boot.
 */
import { today as todayISO } from './core/dates.js';
import { ledgerIndex } from './core/ledger.js';
import { occupancy, tenantName, unitLabel } from './core/leases.js';

export const app = {
  store: null,
  user: null, // { username, uuid } or null in the demo
  demo: false,
  env: 'web',
  avatarUrl: null,
  team: null, // { url, role, business } when working in a team business
  workspaces: null,
  today: () => todayISO(),
  settings: () => app.store.state.settings,
  /** Every balance in the app comes from here (memoized on the ledger). */
  ledger: () => ledgerIndex(app.store),
};

/** Look up helpers with null safety. */
export const lookup = {
  property: (id) => app.store.get('properties', id),
  unit: (id) => app.store.get('units', id),
  lease: (id) => app.store.get('leases', id),
  tenant: (id) => app.store.get('tenants', id),
  owner: (id) => app.store.get('owners', id),
  vendor: (id) => app.store.get('vendors', id),
  account: (id) => app.store.get('accounts', id),
  member: (id) => app.store.get('team', id),
  members: (ids = []) => ids.map((id) => app.store.get('team', id)).filter(Boolean),
  tenants: (ids = []) => ids.map((id) => app.store.get('tenants', id)).filter(Boolean),
  tenantNames: (lease) => (lease?.tenantIds || []).map((id) => tenantName(app.store.get('tenants', id))).filter(Boolean).join(', '),
  /** "Maple Court · 2B" (or just the property name for a single-unit property). */
  unitLabel: (unitId) => {
    const unit = app.store.get('units', unitId);
    return unitLabel(unit ? app.store.get('properties', unit.propertyId) : null, unit);
  },
  leaseLabel: (lease) => {
    if (!lease) return '';
    return unitLabel(app.store.get('properties', lease.propertyId), app.store.get('units', lease.unitId));
  },
  unitsOf: (propertyId) => app.store.all('units').filter((u) => u.propertyId === propertyId),
  accountsById: () => derived('accountsById', ['accounts'], () => new Map(app.store.all('accounts').map((a) => [a.id, a]))),
};

const derivedCache = new Map();

/**
 * Memoize a value derived from some collections; recomputed when any of
 * them change (or when the day changes, for date-based values).
 */
export function derived(key, colls, compute, { daily = false } = {}) {
  const sig = colls.map((c) => app.store.revision(c)).join('.') + (daily ? `|${app.today()}` : '');
  const hit = derivedCache.get(key);
  if (hit && hit.sig === sig && hit.store === app.store) return hit.value;
  const value = compute();
  derivedCache.set(key, { sig, value, store: app.store });
  return value;
}

/** unitId -> active lease, for today. */
export function occupancyMap() {
  return derived('occupancy', ['leases'], () => occupancy(app.store.all('leases'), app.today()), { daily: true });
}
