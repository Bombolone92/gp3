/**
 * Chess clocks: two countdowns and a Fischer increment.
 *
 * Remaining time is never decremented on a tick. Each side has a settled
 * balance in `_left`, and the side whose clock is running is additionally
 * charged for the wall time since `_since` — so a throttled or skipped timer
 * (a background tab, a sleeping laptop) costs accuracy in the display only,
 * never in the time actually charged. `_left` changes only when the clock
 * changes hands, which lets `baseline()` hand back the state as of the start
 * of the current turn for undo to restore.
 */

/** Below this the display switches to tenths, and the clock reads as low. */
export const LOW_TIME_MS = 20000;

/**
 * Offered time controls, in menu order. `initial` of 0 means no clock at all.
 * Ids cross the wire between peers and land in saved games, so treat them as
 * a stable format: add ids rather than renaming them.
 */
export const TIME_CONTROLS = [
  { id: 'unlimited', label: 'No limit', initial: 0, increment: 0, group: null },
  { id: '1+0', label: '1 + 0', initial: 60000, increment: 0, group: 'Bullet' },
  { id: '2+1', label: '2 + 1', initial: 120000, increment: 1000, group: 'Bullet' },
  { id: '3+0', label: '3 + 0', initial: 180000, increment: 0, group: 'Blitz' },
  { id: '3+2', label: '3 + 2', initial: 180000, increment: 2000, group: 'Blitz' },
  { id: '5+0', label: '5 + 0', initial: 300000, increment: 0, group: 'Blitz' },
  { id: '5+3', label: '5 + 3', initial: 300000, increment: 3000, group: 'Blitz' },
  { id: '10+0', label: '10 + 0', initial: 600000, increment: 0, group: 'Rapid' },
  { id: '15+10', label: '15 + 10', initial: 900000, increment: 10000, group: 'Rapid' },
];

export const DEFAULT_TIME_ID = 'unlimited';

const BY_ID = new Map(TIME_CONTROLS.map((control) => [control.id, control]));

/** Look up a time control by id; null for unknown ids and for "no limit". */
export function timeControl(id) {
  const control = BY_ID.get(id) || null;
  return control && control.initial > 0 ? control : null;
}

/** Is `id` one of the offered controls (including "unlimited")? */
export function isTimeId(id) {
  return BY_ID.has(id);
}

/**
 * Clock face: `m:ss` normally, `h:mm:ss` from an hour up, and `m:ss.t` once
 * the time is low enough that tenths matter. Seconds are truncated, so the
 * clock reads 0:00 exactly when the time is gone.
 */
export function formatClock(ms) {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const seconds = Math.floor(tenths / 10);
  const minutes = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, '0');
  if (ms < LOW_TIME_MS) return `${minutes}:${ss}.${tenths % 10}`;
  if (minutes < 60) return `${minutes}:${ss}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${ss}`;
}

/** Spoken form of a clock reading, for the status region. */
export function speakClock(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const parts = [];
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (rest || !minutes) parts.push(`${rest} second${rest === 1 ? '' : 's'}`);
  return parts.join(' ');
}

export class Clock {
  /**
   * @param {{initial: number, increment: number}|null} control null (or a
   *   control with no initial time) makes a disabled clock: every reading is
   *   Infinity and nothing ever flags, which is how "No limit" games run.
   * @param {() => number} now injectable monotonic clock, for tests
   */
  constructor(control = null, now = () => performance.now()) {
    this._now = now;
    this.control = control && control.initial > 0 ? control : null;
    const initial = this.control ? this.control.initial : 0;
    this._left = { w: initial, b: initial };
    this._running = null;
    this._since = 0;
  }

  get enabled() {
    return this.control !== null;
  }

  get increment() {
    return this.control ? this.control.increment : 0;
  }

  /** The color being charged right now, or null while the clock is stopped. */
  get running() {
    return this._running;
  }

  /** Time left for `color`, including whatever is being spent right now. */
  remaining(color) {
    if (!this.enabled) return Infinity;
    const spent = this._running === color ? this._now() - this._since : 0;
    return Math.max(0, this._left[color] - spent);
  }

  /** Both clocks as of the start of the current turn (what undo restores). */
  baseline() {
    return { w: this._left.w, b: this._left.b };
  }

  /** Both clocks as they read right now (what a save file records). */
  snapshot() {
    return { w: this.remaining('w'), b: this.remaining('b') };
  }

  /**
   * Hand the clock to `color`, or stop it with null. Charging happens here and
   * only here: re-asserting the side already running is a no-op, so callers
   * are free to treat this as "make the clock match the game".
   */
  setRunning(color) {
    const next = this.enabled ? color : null;
    if (next === this._running) return;
    if (this._running !== null) {
      const spent = this._now() - this._since;
      this._left[this._running] = Math.max(0, this._left[this._running] - spent);
      this._running = null;
    }
    if (next !== null) {
      this._running = next;
      this._since = this._now();
    }
  }

  /** Credit `color` with the increment for a completed move. */
  addIncrement(color) {
    if (this.enabled) this._left[color] += this.increment;
  }

  /** Overwrite one side's clock (a peer reporting its own time, or a resume). */
  set(color, ms) {
    if (!this.enabled) return;
    this._left[color] = Math.max(0, ms);
    if (this._running === color) this._since = this._now();
  }

  restore({ w, b }) {
    this.set('w', w);
    this.set('b', b);
  }

  /**
   * The side that has run out of time, or null. Only a running clock can
   * flag: a side that is not on the move cannot lose on time, however its
   * clock reads.
   */
  flagged() {
    if (!this.enabled || this._running === null) return null;
    return this.remaining(this._running) <= 0 ? this._running : null;
  }
}
