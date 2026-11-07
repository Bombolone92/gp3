import { el } from './dom.js';
import { icon } from './icons.js';

/**
 * Bottom sheet on mobile, centered dialog on desktop.
 * openModal({ title, content, onClose, wide, canClose }) → { close(), panel }
 *
 * `canClose` (optional) is consulted before any close - Escape, the scrim,
 * the X, or a programmatic call. A dialog mid-way through recording money
 * returns false from it, so a dismissal can't leave the write finishing
 * unseen behind a register that invites ringing the same sale up again.
 */
/** Modals open right now, oldest first - navigation closes them (or is refused). */
const openModals = new Set();

/**
 * Close every open modal - the shell calls this when the route changes,
 * because body-mounted sheets outlive the view they were opened over.
 * Returns false when one refused (its canClose said a write is in flight);
 * the caller then refuses the navigation instead of leaving a live money
 * sheet floating over a rebuilt view.
 */
export function closeAllModals() {
  for (const m of [...openModals]) m.close();
  return openModals.size === 0;
}

export function openModal({ title, content, onClose, wide = false, canClose = null }) {
  const panel = el('div.modal-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: -1 });
  if (wide) panel.classList.add('wide');
  const rootNode = el('div.modal-root', {},
    el('div.modal-scrim', { onclick: () => close() }),
    panel
  );

  // Keep keyboard and screen-reader focus inside the dialog, and put it
  // back where it came from on close.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const appEl = document.getElementById('app');

  panel.append(
    el('div.sheet-handle'),
    el('div.modal-head', {},
      el('h2.modal-title', {}, title),
      el('button.icon-btn', { html: icon('x', 20), 'aria-label': 'Close', onclick: () => close() })
    ),
    content
  );

  let closed = false;
  function close() {
    if (closed) return;
    if (canClose && !canClose()) return;
    closed = true;
    openModals.delete(handle);
    rootNode.classList.add('closing');
    // The panel stays in the DOM for the 200ms exit animation, and a
    // double-tap's second click lands inside that window. close() itself
    // no-ops, but the button's own action would run again - one more item
    // in the cart, the *next* line removed. A closing dialog takes no
    // further input, from pointer or keyboard.
    rootNode.style.pointerEvents = 'none';
    panel.setAttribute('inert', '');
    // Hand focusability back to the dialog that is now topmost.
    const stack = document.querySelectorAll('.modal-root:not(.closing)');
    stack[stack.length - 1]?.removeAttribute('inert');
    document.removeEventListener('keydown', onKey);
    onClose?.();
    setTimeout(() => {
      const active = document.activeElement;
      rootNode.remove();
      if (!document.querySelector('.modal-root')) {
        document.body.classList.remove('modal-open');
        appEl?.removeAttribute('inert');
        document.querySelector('.toast-root')?.removeAttribute('inert');
      }
      // Hand focus back only if nothing claimed it meanwhile: a follow-up
      // flow (the scanner closing into the SKU field) placed it on purpose,
      // and yanking it back would pop the keyboard elsewhere 200ms later.
      const unclaimed = !active || active === document.body || rootNode.contains(active);
      if (unclaimed && opener?.isConnected) opener.focus();
    }, 200);
  }

  function onKey(e) {
    // Escape inside IME composition is cancelling the candidate text, not
    // the dialog - swallowing the sheet would discard the half-filled form.
    if (e.isComposing || e.key !== 'Escape') return;
    // Only the top of a modal stack (e.g. confirm over an edit sheet) closes.
    const open = document.querySelectorAll('.modal-root:not(.closing)');
    if (open[open.length - 1] === rootNode) close();
  }

  document.addEventListener('keydown', onKey);
  document.body.classList.add('modal-open');
  appEl?.setAttribute('inert', '');
  // Toasts mount beside the modals, not under #app - without this, Tab
  // escaped an aria-modal dialog into a lingering toast's Undo button.
  document.querySelector('.toast-root')?.setAttribute('inert', '');
  // Stacked dialogs: only the topmost may hold focus - Tab must not reach
  // the covered form.
  for (const m of document.querySelectorAll('.modal-root:not(.closing)')) m.setAttribute('inert', '');
  document.body.append(rootNode);

  const focusable = panel.querySelector('input, select, textarea, button:not(.icon-btn)');
  if (focusable && matchMedia('(min-width: 640px)').matches) focusable.focus();
  else panel.focus({ preventScroll: true });

  const handle = { close, panel };
  openModals.add(handle);
  return handle;
}

/**
 * A dialog for a decision with more than two answers - "hold the current sale
 * first, or discard it?" - where a yes/no confirm would have to lie about one
 * of the options. Resolves the chosen value, or null on cancel/Escape/scrim.
 *
 * options: [{ value, label, hint?, primary?, danger? }]
 */
export function chooseDialog({ title, message, options = [], cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    const button = (o) => el('button.btn.btn-block.choice-btn', {
      type: 'button',
      className: `btn btn-block choice-btn ${o.danger ? 'btn-ghost choice-danger' : o.primary ? 'btn-primary' : 'btn-ghost'}`,
      // Resolve before close() - close fires onClose, which resolves null.
      onclick: () => { resolve(o.value); modal.close(); },
    },
      el('span.choice-label', {}, o.label),
      o.hint && el('span.choice-hint', {}, o.hint)
    );

    const content = el('div', {},
      message && el('p.choice-message', {}, message),
      el('div.choice-list', {}, options.map(button)),
      el('button.btn.btn-ghost.btn-block', {
        type: 'button', style: { marginTop: '10px' },
        onclick: () => modal.close(),
      }, cancelLabel)
    );
    const modal = openModal({ title, content, onClose: () => resolve(null) });
  });
}

/** Simple confirm dialog. Resolves true/false (false on Escape/scrim/close too). */
export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const content = el('div', {},
      el('p', { style: { color: 'var(--ink-2)', marginBottom: '18px', fontSize: '14px' } }, message),
      el('div.row', { style: { justifyContent: 'flex-end' } },
        el('button.btn.btn-ghost', { onclick: () => modal.close() }, 'Cancel'),
        el(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, {
          // Resolve before close() - close fires onClose, which resolves false.
          onclick: () => { resolve(true); modal.close(); },
        }, confirmLabel)
      )
    );
    const modal = openModal({ title, content, onClose: () => resolve(false) });
  });
}
