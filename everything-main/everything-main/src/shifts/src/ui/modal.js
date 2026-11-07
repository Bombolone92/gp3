import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

/** Close functions of open modals, bottom to top. Escape only closes the top. */
const modalStack = [];

/**
 * Opens a modal dialog. `content` and `footer` are nodes or arrays of nodes.
 * Returns { close, body }; `close` tears the modal down.
 */
export function openModal({ title, content, footer, onClose }) {
  const previouslyFocused = document.activeElement;
  let closed = false;

  /**
   * Hand focus back where it came from. Saving a record re-renders the
   * view underneath, so the control the dialog was opened from is
   * usually detached by the time the dialog closes: focusing it then
   * does nothing and the browser falls back to <body>, which sends a
   * keyboard user back to the top of the page. The content region is
   * the nearest thing still standing, and resuming there keeps them
   * roughly where they were working.
   */
  function restoreFocus() {
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus();
      return;
    }
    const region = document.querySelector('.content');
    if (region instanceof HTMLElement) region.focus();
  }

  function close() {
    if (closed) return;
    closed = true;
    modalStack.splice(modalStack.indexOf(close), 1);
    document.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
    restoreFocus();
    onClose?.();
  }

  function onKeydown(e) {
    if (modalStack[modalStack.length - 1] !== close) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      trapFocus(e);
    }
  }

  /** Keeps Tab cycling inside the dialog while it is the top modal. */
  function trapFocus(e) {
    // tabIndex rather than the selector alone: a <button> matches whatever
    // its tabindex says, and the color swatches park every unselected one
    // at -1 so the group is a single tab stop (see colorSwatches).
    const focusables = [...dialog.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter((n) => !n.disabled && n.tabIndex >= 0 && n.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialog.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  const body = el('div', { class: 'modal-body' }, content);
  const dialog = el(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el(
      'div',
      { class: 'modal-header' },
      el('h2', {}, title),
      el('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Close', onClick: close }, icon('x', 17))
    ),
    body,
    footer ? el('div', { class: 'modal-footer' }, footer) : null
  );

  const overlay = el(
    'div',
    {
      class: 'modal-overlay',
      onMousedown: (e) => {
        if (e.target === overlay) close();
      },
    },
    dialog
  );

  modalStack.push(close);
  document.addEventListener('keydown', onKeydown, true);
  document.body.appendChild(overlay);

  const firstInput = dialog.querySelector('input, select, textarea, button:not([aria-label="Close"])');
  firstInput?.focus();

  return { close, body };
}

/** Promise-based confirm dialog. Resolves true when confirmed. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value, close) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
      close?.();
    };

    const modal = openModal({
      title,
      content: el('p', { style: { color: 'var(--text-2)', fontSize: '13.5px' } }, message),
      footer: [
        el('span', { class: 'grow' }),
        el('button', { class: 'btn', onClick: () => settle(false, modal.close) }, 'Cancel'),
        el(
          'button',
          { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onClick: () => settle(true, modal.close) },
          confirmLabel
        ),
      ],
      onClose: () => settle(false),
    });
  });
}
