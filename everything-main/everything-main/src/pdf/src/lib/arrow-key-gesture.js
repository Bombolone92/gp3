/** Group a held arrow (including repeats) into one completed geometry action. */
export function arrowKeyGesture(handle, { update, completed }) {
  const held = new Set();
  handle.addEventListener('keydown', (e) => {
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[e.key];
    if (!direction || e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey)
      return;
    e.preventDefault();
    e.stopPropagation();
    if (update(direction, e.shiftKey ? 10 : 1) !== false) held.add(e.key);
  });
  handle.addEventListener('keyup', (e) => {
    if (!held.delete(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!held.size) completed();
  });
  // A key released outside the control must not leave the action pending indefinitely.
  handle.addEventListener('blur', () => {
    if (!held.size) return;
    held.clear();
    completed();
  });
}
