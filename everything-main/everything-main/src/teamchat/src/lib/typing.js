/**
 * The typing signal, kept cheap: every keystroke burst is a KV write paid by
 * the workspace owner, so the composer reports "typing" at most once per
 * window, and "stopped" once, on send or clear. Pure, so the throttle is
 * unit tested with fake timers.
 *
 *   const t = typingSignal({ send: (first) => api..., stop: () => api..., windowMs: 4000 });
 *   t.typed();   // on every input event
 *   t.stopped(); // on send, clear, or leaving
 *
 * `send`'s `first` is true only for the write that starts a burst (the
 * worker signals events subscribers on that write alone; see the design
 * doc's events signalling section): a refresh sent later in an already
 * `active` burst is not one, since a client woken by the first write already
 * switches to the faster typing poll cadence on its own.
 */
export const TYPING_WINDOW_MS = 4000;
/** How long an entry counts as "typing" after its last write. */
export const TYPING_TTL_MS = 8000;

export function typingSignal({ send, stop, windowMs = TYPING_WINDOW_MS, now = Date.now }) {
  let lastSent = 0;
  let active = false;
  let idle = null;
  const clearIdle = () => {
    if (idle) clearTimeout(idle);
    idle = null;
  };
  return {
    typed() {
      const t = now();
      if (t - lastSent >= windowMs) {
        const first = !active;
        lastSent = t;
        active = true;
        Promise.resolve(send(first)).catch(() => {});
      }
      // Fell silent without sending: say so once, so nothing lingers.
      clearIdle();
      idle = setTimeout(() => this.stopped(), windowMs + 1000);
    },
    stopped() {
      clearIdle();
      if (!active) return;
      active = false;
      lastSent = 0;
      Promise.resolve(stop()).catch(() => {});
    },
    isActive: () => active,
  };
}

/** Compose the "X is typing" line for a list of names. */
export function typingText(names) {
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return 'Several people are typing';
}
