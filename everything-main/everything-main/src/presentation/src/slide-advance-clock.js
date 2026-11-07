// Browser timers use signed 32-bit delays; OOXML advTm is unsigned 32-bit.
const MAX_TIMEOUT = 2 ** 31 - 1;

// Readiness represents actual effect completion, rather than an estimated
// animation duration. Tokens invalidate both timers and outgoing effects.
export function createSlideAdvanceClock(onAdvance) {
  let disposed = false,
    paused = false,
    ready = false;
  let delay,
    handle,
    selection = 0,
    timer = 0;
  function cancelTimer() {
    timer++;
    clearTimeout(handle);
    handle = undefined;
  }
  function arm() {
    if (disposed || paused || !ready || delay === undefined) return;
    const deadline = performance.now() + delay;
    const token = timer;
    function chunk() {
      handle = setTimeout(
        () => {
          if (disposed || paused || token !== timer) return;
          if (performance.now() < deadline) chunk();
          else {
            handle = undefined;
            delay = undefined;
            onAdvance();
          }
        },
        Math.min(MAX_TIMEOUT, Math.max(0, deadline - performance.now())),
      );
    }
    chunk();
  }
  function clear() {
    selection++;
    cancelTimer();
    delay = undefined;
    ready = false;
    paused = false;
  }
  return {
    get paused() {
      return paused;
    },
    select(ms, readiness) {
      if (disposed) return;
      if (ms !== undefined && (!Number.isFinite(ms) || ms < 0))
        throw new RangeError(
          "Slide advance delay must be finite and nonnegative",
        );
      clear();
      delay = ms;
      if (ms === undefined) return;
      const token = selection;
      if (readiness === undefined) {
        ready = true;
        arm();
      } else
        Promise.resolve(readiness).then(
          () => {
            if (disposed || selection !== token) return;
            ready = true;
            arm();
          },
          () => {
            if (selection === token) clear();
          },
        );
    },
    setPaused(value) {
      if (disposed || paused === value) return;
      cancelTimer();
      paused = value;
      // Resuming restarts the full current dwell. Explicit
      // navigation also resumes the show through select().
      if (!paused) arm();
    },
    clear,
    dispose() {
      clear();
      disposed = true;
    },
  };
}
