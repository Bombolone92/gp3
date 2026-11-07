import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

/**
 * Opens a modal dialog. `content` and `footer` are nodes or arrays of nodes.
 * Returns { close, requestClose, body }: `close` tears the modal down
 * immediately (Save/Cancel buttons); `requestClose` is the light-dismiss
 * path that asks before discarding an edited form.
 */
export function openModal({ title, content, footer, wide = false, onClose }) {
  const previouslyFocused = document.activeElement;

  function close() {
    document.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
    restoreFocus();
    onClose?.();
  }

  /* Light-dismiss (scrim click, Escape, the X) asks before discarding a
     form the user has edited — a stray click beside a dialog must not
     eat a seven-row job description. Dirtiness is tracked from real
     input/change events, so dialogs populated after opening (the import
     wizard) and prefilled editors both start clean. Programmatic
     close() — Save, Cancel — stays immediate. */
  let dirty = false;
  let confirmingClose = false;
  const markDirty = () => (dirty = true);

  /** Resolves true when the dialog closed, false when the user kept it. */
  async function requestClose() {
    if (!dirty) {
      close();
      return true;
    }
    if (confirmingClose) return false;
    confirmingClose = true;
    const ok = await confirmDialog({
      title: 'Discard changes?',
      message: 'What you entered here hasn’t been saved.',
      confirmLabel: 'Discard',
      danger: true,
    });
    confirmingClose = false;
    if (ok) close();
    return ok;
  }

  function restoreFocus() {
    if (!(previouslyFocused instanceof HTMLElement)) return;
    if (previouslyFocused.isConnected) {
      previouslyFocused.focus();
      return;
    }
    // Saving inside the modal re-renders the app, which detaches the
    // control that opened it — focusing a detached node is a silent
    // no-op that strands keyboard users at the top of the page. Re-find
    // the control by the app's focus-key convention when it carries one,
    // and otherwise land on the view so Tab resumes near the work.
    const key = previouslyFocused.dataset.focusKey;
    const replacement = key ? document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`) : null;
    const view = document.querySelector('main.content');
    if (replacement instanceof HTMLElement) {
      replacement.focus();
    } else if (view instanceof HTMLElement) {
      view.tabIndex = -1;
      view.focus();
    }
  }

  /** Dialogs can stack (settings under a confirm); only the top one reacts. */
  function isTopmost() {
    const overlays = document.querySelectorAll('.modal-overlay');
    return overlays[overlays.length - 1] === overlay;
  }

  function onKeydown(e) {
    if (!isTopmost()) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      requestClose();
    } else if (e.key === 'Tab') {
      // aria-modal promises containment: cycle focus inside the dialog.
      const focusable = [...dialog.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )].filter((node) => !node.disabled && node.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      // The dialog itself holds focus when it opened empty (import
      // wizard, welcome tour). It counts as the boundary: native
      // Shift+Tab from it would land on the page behind the scrim —
      // dialog.contains(dialog) is true, so the wrap check alone misses
      // it — and one Enter there stacks a second dialog over this one.
      if (e.shiftKey && (current === first || current === dialog || !dialog.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !dialog.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  const body = el('div', { class: 'modal-body' }, content);
  const dialog = el(
    'div',
    { class: `modal${wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el(
      'div',
      { class: 'modal-header' },
      el('h2', {}, title),
      el('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Close', onClick: requestClose }, icon('x', 17))
    ),
    body,
    footer ? el('div', { class: 'modal-footer' }, footer) : null
  );

  const overlay = el(
    'div',
    {
      class: 'modal-overlay',
      onMousedown: (e) => {
        if (e.target !== overlay) return;
        // The default action of mousedown moves focus after handlers run
        // (to <body> here — the scrim isn't focusable), which would undo
        // the focus this dismissal is about to set: the restored opener
        // control, or the dirty-confirm's Cancel button.
        e.preventDefault();
        requestClose();
      },
    },
    dialog
  );

  dialog.addEventListener('input', markDirty);
  dialog.addEventListener('change', markDirty);

  document.addEventListener('keydown', onKeydown, true);
  document.body.appendChild(overlay);

  // Skip disabled controls: .focus() on one is a silent no-op, and the
  // interview/offer editors opened from a profile pin (disable) their
  // candidate select — the very first control in the dialog.
  const firstInput = dialog.querySelector(
    'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not([aria-label="Close"]):not(:disabled)'
  );
  if (firstInput) {
    firstInput.focus();
  } else {
    // Some callers (import wizard, onboarding) fill the body after
    // opening. Focus the dialog itself so keyboard input lands inside
    // the trap — otherwise Enter re-activates whatever opened the modal,
    // stacking a second dialog behind this one.
    dialog.tabIndex = -1;
    dialog.focus();
  }

  return { close, requestClose, body };
}

/**
 * Announce an edit made by a control that is not a native form field: a
 * star picker, a draft row a button added or removed, a reorder. openModal
 * tracks dirtiness from real input/change events, so such a widget would
 * otherwise leave the dialog looking untouched — and a scrim click or
 * Escape would discard the work with no "Discard changes?" at all. Fire
 * what the equivalent native control would.
 */
export function notifyChanged(node) {
  node.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * The opposite duty: keep one control's events out of the dirty tracker.
 * For a picker that only chooses which template is on screen, and for a
 * switch that saves itself the moment it is flipped, there is nothing
 * unsaved to warn about — and a "Discard changes?" in front of work
 * nobody did (or work already stored) is exactly how people learn to
 * click through the prompt that guards the real thing.
 *
 * Both events have to be stopped. A `<select>` and a checkbox fire
 * `input` before `change`, so handlers that stopped `change` alone still
 * left the dialog looking edited.
 */
export function ignoreChanges(node) {
  for (const type of ['input', 'change']) {
    node.addEventListener(type, (e) => e.stopPropagation());
  }
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
      content: el('p', { class: 'confirm-message' }, message),
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
