/**
 * A bounded undo stack of *intents*.
 *
 * Undo existed only where an action was destructive — a toast after a delete,
 * an archive, a bulk edit. Everything the app is actually made of had no way
 * back: a card dragged one column too far, a timeline bar dropped on the wrong
 * week, an Alt+arrow held a beat too long. The only recovery was a daily
 * restore point, which is coarse by design and costs you everything else you
 * did that day.
 *
 * Each entry is a pair of functions and a label. They are inverse *mutations*
 * — `moveTask(id, fromColumn, fromIndex)` — not document snapshots: small,
 * cheap, exactly the shape the store's mutators already take, and no fight
 * with the debounced write or the stale-file check.
 *
 * One gesture is one entry. A drag that rewrites three orders internally is
 * still "move to In progress"; a bulk edit stays the single entry its toast
 * already implies.
 */

export const HISTORY_LIMIT = 50;

export class History {
  #undo = [];
  #redo = [];
  #limit;

  constructor({ limit = HISTORY_LIMIT } = {}) {
    this.#limit = Math.max(1, limit);
  }

  /**
   * Record something that has already happened. `undo` puts it back, `redo`
   * does it again, and `label` is how it is described — "Undo" alone is not
   * safe to press, "Undo move to In progress" is.
   */
  push({ label, undo, redo }) {
    if (typeof undo !== 'function') return null;
    const entry = { label: String(label ?? 'change'), undo, redo };
    this.#undo.push(entry);
    // A new action makes any future that was undone unreachable.
    this.#redo = [];
    if (this.#undo.length > this.#limit) this.#undo.shift();
    return entry;
  }

  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }

  get undoLabel() { return this.#undo[this.#undo.length - 1]?.label ?? null; }
  get redoLabel() { return this.#redo[this.#redo.length - 1]?.label ?? null; }

  get depth() { return this.#undo.length; }

  /** Undo the last entry and return it, or null when there is nothing to undo. */
  undo() {
    const entry = this.#undo.pop();
    if (!entry) return null;
    entry.undo();
    // Only what can be replayed is offered again.
    if (typeof entry.redo === 'function') this.#redo.push(entry);
    return entry;
  }

  redo() {
    const entry = this.#redo.pop();
    if (!entry) return null;
    entry.redo();
    this.#undo.push(entry);
    return entry;
  }

  /**
   * Forget everything. Called whenever the ground moves under the stack — a
   * conflict resolved, a restore point applied, offline work replayed — since
   * applying the inverse of a change that no longer exists is worse than
   * having no undo at all.
   */
  clear() {
    this.#undo = [];
    this.#redo = [];
  }
}
