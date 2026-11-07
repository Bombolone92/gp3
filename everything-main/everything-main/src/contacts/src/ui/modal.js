// Shared modal helpers: keep keyboard focus inside an open dialog and restore
// it to wherever it was when the dialog closes.

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Visible, focusable elements within a container, in DOM order. */
export function focusable(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
}

/**
 * Keep Tab focus within `container`. Call from a keydown handler.
 * Returns true if it moved focus (so the caller can stop processing).
 */
export function trapTab(e, container) {
  if (e.key !== 'Tab') return false
  const items = focusable(container)
  if (!items.length) return false
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (e.shiftKey) {
    if (active === first || !container.contains(active)) {
      e.preventDefault()
      last.focus()
      return true
    }
  } else if (active === last || !container.contains(active)) {
    e.preventDefault()
    first.focus()
    return true
  }
  return false
}

/**
 * Backdrop light-dismiss that ignores drags. A drag that starts inside the
 * panel (selecting text in an input) and ends over the backdrop fires a click
 * whose target is the overlay — closing then throws the dialog out from under
 * the user. Track where the pointer went down/up and only treat a click as a
 * backdrop dismiss when the whole interaction happened on the backdrop.
 * @returns {(e: MouseEvent) => boolean} predicate for the overlay's click handler
 */
export function backdropDismisser(overlay) {
  let downOnBackdrop = false
  let upOnBackdrop = false
  overlay.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === overlay
  })
  overlay.addEventListener('pointerup', (e) => {
    upOnBackdrop = e.target === overlay
  })
  return (e) => e.target === overlay && downOnBackdrop && upOnBackdrop
}

/**
 * Remember the currently focused element so it can be refocused when a dialog
 * closes. Returns a restore() function that is safe to call once. If the
 * element was replaced by a re-render while the dialog was open (saving
 * re-stamps the detail pane, so its buttons are fresh nodes), fall back to the
 * equivalent control by data-action/data-id so keyboard focus isn't dropped.
 */
export function focusKeeper() {
  const prev = document.activeElement
  const action = prev && prev.dataset ? prev.dataset.action : null
  const id = (prev && prev.dataset && prev.dataset.id) || ''
  return function restore() {
    if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
      prev.focus()
      return
    }
    if (!action) return
    for (const el of document.querySelectorAll(`[data-action="${CSS.escape(action)}"]`)) {
      if ((el.dataset.id || '') === id) {
        el.focus()
        return
      }
    }
  }
}
