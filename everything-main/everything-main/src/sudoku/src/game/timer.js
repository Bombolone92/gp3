/**
 * The game clock.
 *
 * Time is read from an injected `now` rather than Date.now() so the tests can
 * step it, and accumulated on pause rather than tracked by an interval: a tab
 * that gets backgrounded stops receiving timer callbacks but keeps its wall
 * clock, and a player who returns to find ten missing minutes is right to be
 * annoyed. The interval only drives repainting.
 */

/**
 * @param {object} [options]
 * @param {() => number} [options.now] Clock source, in milliseconds.
 * @param {number} [options.elapsedMs] Time already banked, when resuming.
 */
export function createTimer({ now = () => Date.now(), elapsedMs = 0 } = {}) {
  let banked = Math.max(0, elapsedMs);
  let startedAt = null;

  return {
    start() {
      if (startedAt === null) startedAt = now();
      return this;
    },
    pause() {
      if (startedAt !== null) {
        banked += Math.max(0, now() - startedAt);
        startedAt = null;
      }
      return this;
    },
    reset(to = 0) {
      banked = Math.max(0, to);
      startedAt = null;
      return this;
    },
    get running() {
      return startedAt !== null;
    },
    /** Total elapsed time, whether running or paused. */
    get elapsedMs() {
      return banked + (startedAt === null ? 0 : Math.max(0, now() - startedAt));
    },
  };
}

/**
 * Milliseconds as `m:ss`, or `h:mm:ss` once it runs over an hour.
 * @param {number} ms
 */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
