/**
 * Shared runtime context: the store, the signed-in user, and helpers views
 * use often. Set once at boot.
 */
import { today as todayISO } from './core/dates.js';
import { vehicleName, contactName } from './core/format.js';

export const app = {
  store: null,
  user: null, // { username, uuid } or null in the demo
  demo: false,
  env: 'web',
  avatarUrl: null,
  team: null, // { url, role, business } when working in a shared fleet
  workspaces: null,
  reloading: false, // the app is reloading itself (see reloadApp)
  today: () => todayISO(),
  settings: () => app.store.state.settings,
};

/** Collections a driver may add to and edit. Enforced again by the team server. */
export const DRIVER_COLLECTIONS = new Set(['inspections', 'fuel', 'issues', 'meters', 'comments']);

export function role() {
  return app.team ? app.team.role : 'owner';
}

/** Whether the current person may change records in a collection. */
export function canEdit(coll) {
  return role() !== 'driver' || DRIVER_COLLECTIONS.has(coll);
}

/**
 * Whether the current person may delete records in a collection. Drivers
 * keep history intact: the team server refuses their deletes, except of
 * comments they wrote, which the comments panel checks on its own.
 */
export function canDelete(coll) {
  return canEdit(coll) && role() !== 'driver';
}

export function canManageSettings() {
  return role() === 'owner' || role() === 'admin';
}

/** Look up helpers with null safety. */
export const lookup = {
  vehicle: (id) => app.store.get('vehicles', id),
  vehicleName: (id) => (id ? vehicleName(app.store.get('vehicles', id)) : ''),
  contact: (id) => app.store.get('contacts', id),
  contactName: (id) => (id ? contactName(app.store.get('contacts', id)) : ''),
  vendor: (id) => app.store.get('vendors', id),
  vendorName: (id) => app.store.get('vendors', id)?.name || '',
  task: (id) => app.store.get('serviceTasks', id),
  taskName: (id) => app.store.get('serviceTasks', id)?.name || '',
  part: (id) => app.store.get('parts', id),
  group: (id) => app.settings().groups?.find((g) => g.id === id) || null,
  groupName: (id) => app.settings().groups?.find((g) => g.id === id)?.name || '',
};

/**
 * Reload on purpose (switching fleets, a changed role, signing out).
 * Changes not sent yet are written to the device cache first and go out
 * after the reload, so the page does not ask whether to leave over them.
 */
export async function reloadApp({ reload = () => location.reload() } = {}) {
  await app.store?.persistCache();
  app.reloading = true;
  reload();
}

/** Display name for the person using the app (for "reported by", comments). */
export function myName() {
  if (app.demo) return 'Demo user';
  return app.user?.username || '';
}
