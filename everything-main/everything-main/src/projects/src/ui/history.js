import { store } from '../lib/store.js';
import { History } from '../lib/history.js';
import { toast } from './toast.js';

/**
 * The undo stack the app actually uses: one per project, for the session.
 *
 * Views record what a gesture did as it happens, because the call site is the
 * only place that knows what the gesture *was* — "move to In progress", "set
 * due Aug 25" — and the store's mutators are the inverse it needs.
 *
 * Deliberately not: cross-project, and not surviving a reload. Restore points
 * (#20) and the trash own everything at that scale.
 */

const stacks = new Map();

export function historyFor(projectId) {
  if (!stacks.has(projectId)) stacks.set(projectId, new History());
  return stacks.get(projectId);
}

/**
 * record(projectId, { label, undo, redo })
 *
 * Called *after* the change has been made. `label` completes the sentence
 * "Undo …", so it reads as an action: "move to Done", "set due Aug 25".
 */
export function record(projectId, entry) {
  if (!projectId) return null;
  return historyFor(projectId).push(entry);
}

/**
 * Run a mutation and hand back both its result and the recurring occurrences
 * it spawned: `{ result, spawned }`, where each entry is
 * `{ taskId, next }` — the task that handed its series over, and the
 * successor that took it up.
 *
 * Completing a recurring task is one gesture on screen and two changes in the
 * document, so an inverse that only moves the card back would leave the
 * successor behind and the series stranded on a task marked closed. The store
 * announces every spawn as it happens; this is how a call site building an
 * inverse hears it.
 */
export function spawnedBy(projectId, run) {
  const spawned = [];
  const onSpawn = (e) => {
    const detail = e.detail;
    if (detail?.projectId !== projectId || !detail.next) return;
    spawned.push({ taskId: detail.taskId ?? null, next: detail.next });
  };
  store.addEventListener('recurrence-spawned', onSpawn);
  try {
    return { result: run(), spawned };
  } finally {
    store.removeEventListener('recurrence-spawned', onSpawn);
  }
}

/**
 * The other half of undoing a completion: take the successors back out and
 * reopen the series on the tasks that handed it over. A successor nobody ever
 * saw does not belong in the trash, so it is purged rather than left there.
 */
export function dropSpawned(projectId, spawned) {
  if (!spawned?.length) return;
  const ids = spawned.map((s) => s.next.id);
  store.bulkDeleteTasks(projectId, ids);
  store.bulkPurgeTasks(projectId, ids);
  const carriers = spawned.map((s) => s.taskId).filter(Boolean);
  if (carriers.length) {
    store.bulkUpdateTasks(projectId, carriers, { recurrenceClosed: false });
  }
}

export function clearHistory(projectId) {
  stacks.get(projectId)?.clear();
}

/** Every project but this one — what a project switch leaves behind. */
export function clearHistoryExcept(projectId) {
  for (const [id, stack] of stacks) if (id !== projectId) stack.clear();
}

export function clearAllHistory() {
  for (const stack of stacks.values()) stack.clear();
}

export function undoLabelFor(projectId) {
  return projectId ? historyFor(projectId).undoLabel : null;
}

export function redoLabelFor(projectId) {
  return projectId ? historyFor(projectId).redoLabel : null;
}

/**
 * Undo one step in a project, saying what it undid — and offering it back, so
 * a mistaken undo is one click away rather than a hunt for the redo binding.
 */
export function undoProject(projectId) {
  if (!projectId) return false;
  const stack = historyFor(projectId);
  const entry = stack.undo();
  if (!entry) {
    toast('Nothing to undo', { icon: 'undo' });
    return false;
  }
  toast(`Undid ${entry.label}`, {
    icon: 'undo',
    action: entry.redo ? { label: 'Redo', onClick: () => redoProject(projectId) } : null,
  });
  return true;
}

export function redoProject(projectId) {
  if (!projectId) return false;
  const entry = historyFor(projectId).redo();
  if (!entry) {
    toast('Nothing to redo', { icon: 'undo' });
    return false;
  }
  toast(`Redid ${entry.label}`, { icon: 'undo' });
  return true;
}

/* The ground moving under the stack, in the two cases the store announces
   itself. A conflict means another window's document won or is about to; a
   replayed outbox means work landed in an order this stack did not see.
   (A restored snapshot and a project switch are announced by their own call
   sites, which know more than an event does.) */
store.addEventListener('conflict', (e) => clearHistory(e.detail?.projectId));
store.addEventListener('outbox', (e) => { if (e.detail?.sent) clearAllHistory(); });
