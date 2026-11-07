/**
 * Shared runtime context: the store, the signed-in person, their role, and
 * helpers views use often. Set once at boot.
 */
import { today as todayISO } from './core/dates.js';
import { personName } from './core/format.js';

export const app = {
  store: null,
  user: null, // { username, uuid } or null in the demo
  demo: false,
  env: 'web',
  avatarUrl: null,
  team: null, // { url, role, school } when working through a school server
  workspaces: null,
  // In a school with family access: { guardianId, studentIds } for a parent,
  // { staffId } for staff. In the demo's family preview, the chosen family.
  me: { guardianId: null, staffId: null, studentIds: null },
  demoRole: null, // 'director' | 'family' in the demo
  today: () => todayISO(),
  settings: () => app.store.state.settings,
};

// Kiosk mode survives reloads, other addresses, and browser restarts (a
// tablet's browser is often closed and reopened), so it is kept in
// localStorage per person and school; only leaving the kiosk clears it.
// The director's own school stays 'own' when it runs through its server.
const KIOSK_KEY = 'childcare.kiosk';
const kioskScope = () => (app.user ? `${app.user.uuid}|${app.team && app.team.role !== 'owner' ? app.team.url : 'own'}` : null);

function kioskScopes() {
  try {
    const v = JSON.parse(localStorage.getItem(KIOSK_KEY) || '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}

export function setKioskLock(on) {
  app.kioskLock = on;
  const scope = kioskScope();
  if (!scope) return; // the demo keeps it in memory
  const all = kioskScopes();
  if (on) all.add(scope);
  else all.delete(scope);
  try {
    localStorage.setItem(KIOSK_KEY, JSON.stringify([...all]));
  } catch {}
}

/** At boot: whether this device was left in kiosk mode for this person and school. */
export function restoreKioskLock() {
  const scope = kioskScope();
  // A family cannot open the kiosk, so it could never be left.
  app.kioskLock = Boolean(scope && !isFamily() && kioskScopes().has(scope));
  return app.kioskLock;
}

/** 'owner' | 'admin' | 'staff' | 'parent' */
export function role() {
  if (app.demo) return app.demoRole === 'family' ? 'parent' : 'owner';
  return app.team?.role || 'owner';
}

export const isFamily = () => role() === 'parent';
export const isManager = () => role() === 'owner' || role() === 'admin';
export const canBill = isManager;

/** The children this person may see: everyone for staff, theirs for a family. */
export function myStudents() {
  const all = app.store.all('students');
  if (!isFamily()) return all;
  const ids = new Set(app.me.studentIds || []);
  return all.filter((s) => ids.has(s.id));
}

/** How the signed-in person is named on records they create. */
export function myName() {
  const s = app.store;
  if (app.me.staffId) {
    const m = s.get('staff', app.me.staffId);
    if (m) return personName(m);
  }
  if (app.me.guardianId) {
    const g = s.get('guardians', app.me.guardianId);
    if (g) return personName(g);
  }
  if (app.demo) return app.demoRole === 'family' ? 'Family' : 'Director';
  return app.user?.username || 'Staff';
}

export const lookup = {
  student: (id) => app.store.get('students', id),
  room: (id) => app.store.get('rooms', id),
  staff: (id) => app.store.get('staff', id),
  guardian: (id) => app.store.get('guardians', id),
};
