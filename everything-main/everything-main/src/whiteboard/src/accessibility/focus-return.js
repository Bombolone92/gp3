// The control that opened a panel, when focus is on one of its triggers;
// otherwise nothing, and closing the panel focuses the canvas, as after a
// shortcut there.
export const opener = (triggers) => {
  const active = document.activeElement;
  return active?.closest?.(triggers) ? active : null;
};

// Closing a panel returns focus to what opened it while that is still on
// the page and usable, and otherwise to the fallback, such as the canvas.
export function returnFocus(origin, fallback) {
  const usable =
    origin?.isConnected && !origin.disabled && !origin.closest("[hidden]");
  (usable ? origin : fallback)?.focus();
}
