// Previous and Next turn off at the first and last page. A button that turns
// off while it has focus drops the keyboard onto the page, so focus moves to
// the other button, which is always on when there is more than one page.
export function keepPageFocus(pressed, other) {
  if (!pressed?.disabled || !other || other.disabled) return;
  const focused = pressed.ownerDocument.activeElement;
  if (focused === pressed || focused === pressed.ownerDocument.body)
    other.focus();
}

// Capture focus before rendering: a remote change can disable the focused
// page button or hide the entire pager, causing browsers to drop focus.
export function keepPaginationFocus(focused, previous, next, fallback) {
  if (focused !== previous && focused !== next) return;
  if (!focused.disabled && !focused.closest("[hidden]")) return;
  const other = focused === previous ? next : previous;
  (other && !other.disabled && !other.closest("[hidden]")
    ? other
    : fallback
  )?.focus({ preventScroll: true });
}
