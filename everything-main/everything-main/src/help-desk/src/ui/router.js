/**
 * Hash routing. Routes are '#/segment/segment?query'. `go()` navigates;
 * listeners get { path: [...segments], query, hash } on every change.
 */
import { confirmDialog } from './dialog.js';

const listeners = new Set();
const guards = new Set();
let shown = location.hash;

export function parse(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [p, q] = raw.split('?');
  const path = p.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  return { path, query: Object.fromEntries(new URLSearchParams(q || '')), hash: `#/${raw}` };
}

export function go(target, { replace = false } = {}) {
  const hash = target.startsWith('#') ? target : `#${target.startsWith('/') ? '' : '/'}${target}`;
  if (hash === location.hash) return emit();
  if (replace) {
    history.replaceState(null, '', hash);
    emit();
  } else location.hash = hash;
}

export function onRoute(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  shown = location.hash;
  const r = parse();
  for (const fn of listeners) fn(r);
}

/**
 * Hold navigation while `isDirty()` says the screen has unsaved changes:
 * links, the browser's Back button and shortcuts then ask before leaving.
 * Returns a function that removes the guard.
 */
export function guardLeave(isDirty) {
  guards.add(isDirty);
  return () => guards.delete(isDirty);
}

const DISCARD = { title: 'Discard your changes?', message: 'You have changes that are not saved yet.', confirmLabel: 'Discard', danger: true, cancelLabel: 'Keep editing' };

/**
 * Ask before leaving the screen some other way than navigating (switching
 * desks, signing out). True when there is nothing unsaved or the person
 * chose to discard it.
 */
export async function confirmLeave() {
  if (![...guards].some((dirty) => dirty())) return true;
  return confirmDialog(DISCARD);
}

let asking = false;
let bypass = false;
let depth = history.length;
async function onHashChange() {
  const target = location.hash;
  // A link or go() adds a history entry; Back and Forward move between them.
  const pushed = history.length > depth;
  depth = history.length;
  if (target === shown) return;
  if (bypass || ![...guards].some((dirty) => dirty())) {
    bypass = false;
    return emit();
  }
  // Stay on this screen (and its address) while asking: step back off a new
  // entry, or put the address back after Back or Forward.
  if (pushed) history.back();
  else history.replaceState(null, '', shown);
  if (asking) return;
  asking = true;
  const ok = await confirmDialog(DISCARD);
  asking = false;
  if (!ok) return;
  if (pushed) {
    bypass = true;
    location.hash = target;
  } else {
    history.replaceState(null, '', target);
    emit();
  }
}

window.addEventListener('hashchange', onHashChange);

export function current() {
  return parse();
}
