/**
 * Shared runtime context: the store, the signed-in person, and lookups views
 * use often. Set once at boot.
 */
import { today as todayISO } from './core/dates.js';
import { contactName } from './core/format.js';

export const app = {
  store: null,
  user: null, // { username, uuid } of the Puter account, or null in the demo
  demo: false,
  env: 'web',
  avatarUrl: null,
  team: null, // { url, role, business } when working in a shared firm
  workspaces: null,
  today: () => todayISO(),
  settings: () => app.store.state.settings,
  /** The firm user record for the person using the app (see meId). */
  me: () => app.store.get('users', meId()) || null,
};

/**
 * Which firm user is "me": the one linked to this Puter username, else the
 * first active lawyer (a solo practitioner's own record).
 */
export function meId() {
  const users = app.store.all('users');
  if (app.user?.username) {
    const linked = users.find((u) => u.puterUsername && u.puterUsername.toLowerCase() === app.user.username.toLowerCase());
    if (linked) return linked.id;
  }
  const first = users.filter((u) => u.active !== false).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return (first.find((u) => u.role === 'lawyer') || first[0])?.id || null;
}

export const lookup = {
  contact: (id) => app.store.get('contacts', id),
  contactName: (id) => (id ? contactName(app.store.get('contacts', id)) : ''),
  matter: (id) => app.store.get('matters', id),
  user: (id) => app.store.get('users', id),
  userName: (id) => app.store.get('users', id)?.name || '',
  activeUsers: () =>
    app.store
      .all('users')
      .filter((u) => u.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name)),
  trustAccounts: () => app.store.all('accounts').filter((a) => a.type === 'trust'),
  operatingAccounts: () => app.store.all('accounts').filter((a) => a.type === 'operating'),
  defaultAccount: (type) => {
    const list = app.store.all('accounts').filter((a) => a.type === type);
    return list.find((a) => a.isDefault) || list[0] || null;
  },
};
