/**
 * Shared runtime context: the store, the signed-in user, and helpers views
 * use often. Set once at boot.
 */
import { today as todayISO } from './core/dates.js';

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
};

/** Look up helpers with null safety. */
export const lookup = {
  client: (id) => app.store.get('clients', id),
  member: (id) => app.store.get('team', id),
  members: (ids = []) => ids.map((id) => app.store.get('team', id)).filter(Boolean),
  property: (client, propertyId) => client?.properties?.find((p) => p.id === propertyId) || client?.properties?.[0] || null,
};
