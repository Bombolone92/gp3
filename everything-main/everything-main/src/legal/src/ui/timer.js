/**
 * The running timer in the top bar. One timer per person and device, kept in
 * localStorage so it survives reloads and keeps counting while the tab is
 * closed (elapsed time is computed from timestamps, never from ticks).
 *
 *   { running, startedAt (ms), accumulated (ms), matterId, description, categoryId }
 */
import { app, lookup } from '../app.js';
import { confirmDialog } from './dialog.js';
import { formatClock } from '../core/duration.js';
import { matterLabel } from '../core/format.js';

const listeners = new Set();
let memoryState = null; // used when storage is unavailable

const key = () => `legal.timer.${app.user?.uuid || (app.demo ? 'demo' : 'local')}`;
const blank = () => ({ running: false, startedAt: 0, accumulated: 0, matterId: '', description: '', categoryId: '' });

export function getTimer() {
  try {
    const raw = JSON.parse(localStorage.getItem(key()) || 'null');
    return raw && typeof raw === 'object' ? { ...blank(), ...raw } : blank();
  } catch {
    return memoryState || blank();
  }
}

function save(state) {
  memoryState = state;
  try {
    localStorage.setItem(key(), JSON.stringify(state));
  } catch {}
  for (const fn of listeners) fn(state);
}

export function onTimerChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Milliseconds on the clock right now. */
export function elapsedMs(state = getTimer(), now = Date.now()) {
  return (Number(state.accumulated) || 0) + (state.running ? Math.max(0, now - (Number(state.startedAt) || now)) : 0);
}

export function startTimer(patch = {}) {
  const s = getTimer();
  if (s.running) return save({ ...s, ...patch });
  save({ ...s, ...patch, running: true, startedAt: Date.now() });
}

/**
 * Start (or resume) the timer on a matter. Time already on the clock for a
 * different matter belongs to that matter: it is offered as a time entry
 * first, and the timer only switches once that entry is saved. Resolves
 * true when the timer is running on the matter.
 */
export async function startTimerOn(matterId) {
  const s = getTimer();
  const ms = elapsedMs(s);
  if (!s.matterId || s.matterId === matterId || ms < 60000) {
    const fresh = s.matterId && s.matterId !== matterId; // under a minute on another matter
    if (fresh) save({ ...blank(), matterId, running: true, startedAt: Date.now() });
    else startTimer({ matterId });
    return true;
  }
  const from = lookup.matter(s.matterId);
  const to = lookup.matter(matterId);
  const ok = await confirmDialog({
    title: 'Switch the timer?',
    message: `The timer has ${formatClock(ms)} on ${from ? matterLabel(from) : 'another matter'}. Save that time as an entry first, then the timer starts on ${to ? matterLabel(to) : 'this matter'}.`,
    confirmLabel: 'Save and switch',
  });
  if (!ok) return false;
  const cur = getTimer();
  const { openActivityDialog } = await import('../views/dialogs.js');
  const saved = await openActivityDialog({ kind: 'time', minutes: Math.max(1, Math.round(elapsedMs(cur) / 60000)), matterId: cur.matterId, description: cur.description });
  if (!saved) return false;
  save({ ...blank(), matterId, running: true, startedAt: Date.now() });
  return true;
}

export function pauseTimer() {
  const s = getTimer();
  if (!s.running) return;
  save({ ...s, running: false, accumulated: elapsedMs(s), startedAt: 0 });
}

export function toggleTimer() {
  if (getTimer().running) pauseTimer();
  else startTimer();
}

export function updateTimer(patch) {
  save({ ...getTimer(), ...patch });
}

export function resetTimer() {
  save(blank());
}

// Another tab changed the timer.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === key()) for (const fn of listeners) fn(getTimer());
  });
}
