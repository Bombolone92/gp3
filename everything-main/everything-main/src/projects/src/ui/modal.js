import { el, requireValue } from '../lib/dom.js';
import { fieldId } from '../lib/util.js';
import { icon } from './icons.js';

/**
 * Dialogs that hold real state opt into "Back dismisses" with
 * `dismissOnBack`: opening pushes a history entry, popping it closes the
 * dialog, and closing from the UI pops the entry back off. A caller that
 * navigates on success must navigate *before* close(), so the navigation
 * consumes the dialog's entry instead of a pending pop undoing it.
 */
const backGuards = []; // innermost last
let backToken = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const top = backGuards[backGuards.length - 1];
    if (top && history.state?.pmDialog !== top.token) top.close();
  });
}

/**
 * Bottom sheet on mobile, centered dialog on desktop.
 * openModal({ title, content, onClose, wide, variant, dismissOnBack })
 *   → { close(), panel }
 *
 * `variant` restyles the panel while keeping everything a dialog needs —
 * the scrim, the focus trap, inert, Escape — which is how the navigation
 * drawer gets all of that for free.
 */
export function openModal({
  title, content, onClose, wide = false, variant = null, dismissOnBack = false,
}) {
  const panel = el('div.modal-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: -1 });
  if (wide) panel.classList.add('wide');
  if (variant) panel.classList.add(variant);
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

  let guard = null;
  if (dismissOnBack) {
    guard = { token: ++backToken, close: () => close({ fromBack: true }) };
    history.pushState({ pmDialog: guard.token }, '');
    backGuards.push(guard);
  }

  let closed = false;
  function close({ fromBack = false } = {}) {
    if (closed) return;
    closed = true;
    if (guard) {
      const i = backGuards.indexOf(guard);
      if (i >= 0) backGuards.splice(i, 1);
      // Only pop when our own entry is still the current one; a caller that
      // navigated first already consumed it.
      if (!fromBack && history.state?.pmDialog === guard.token) history.back();
    }
    rootNode.classList.add('closing');
    /* The panel is on its way out, so nothing in it may still take a click —
       and whatever is behind it has to be usable *now*, not when the animation
       ends. Leaving the app inert (and a full-viewport scrim in the document)
       for the length of the fade meant every click in the ~200ms after a
       dialog was dismissed went nowhere, which reads as an app that froze. */
    rootNode.setAttribute('inert', '');
    // Hand focusability back to the dialog that is now topmost, or to the app.
    const stack = document.querySelectorAll('.modal-root:not(.closing)');
    if (stack.length) stack[stack.length - 1].removeAttribute('inert');
    else appEl?.removeAttribute('inert');
    document.removeEventListener('keydown', onKey);
    onClose?.();
    setTimeout(() => {
      rootNode.remove();
      if (!document.querySelector('.modal-root')) {
        // Scroll locking stays until the panel is actually gone: releasing it
        // mid-animation would jump the page under the fade.
        document.body.classList.remove('modal-open');
        appEl?.removeAttribute('inert');
      }
      if (opener?.isConnected) opener.focus();
    }, 200);
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    // Only the top of a modal stack (e.g. confirm over task sheet) closes.
    const open = document.querySelectorAll('.modal-root:not(.closing)');
    if (open[open.length - 1] === rootNode) close();
  }

  document.addEventListener('keydown', onKey);
  document.body.classList.add('modal-open');
  appEl?.setAttribute('inert', '');
  // Stacked dialogs: only the topmost may hold focus.
  for (const m of document.querySelectorAll('.modal-root:not(.closing)')) m.setAttribute('inert', '');
  document.body.append(rootNode);

  const focusable = panel.querySelector('input, select, textarea, button:not(.icon-btn)');
  if (focusable && matchMedia('(min-width: 640px)').matches) focusable.focus();
  else panel.focus({ preventScroll: true });

  return { close, panel };
}

/** Simple confirm dialog. Resolves true/false (false on Escape/scrim too). */
export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const content = el('div', {},
      el('p.confirm-message', {}, message),
      el('div.row.row-end', {},
        el('button.btn.btn-ghost', { onclick: () => modal.close() }, 'Cancel'),
        el(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, {
          // Resolve before close() — close fires onClose, which resolves false.
          onclick: () => { resolve(true); modal.close(); },
        }, confirmLabel)
      )
    );
    const modal = openModal({ title, content, onClose: () => resolve(false) });
  });
}

/** One-field prompt dialog. Resolves the trimmed value, or null on cancel. */
export function promptDialog({
  title, label, value = '', placeholder = '', confirmLabel = 'Save', type = 'text',
}) {
  return new Promise((resolve) => {
    const id = fieldId('prompt');
    const input = el('input.input', {
      id, type, value, placeholder,
      // A length cap belongs to free text; a date input rejects it outright.
      maxLength: type === 'text' ? 80 : null,
    });
    const submit = () => {
      // Pressing the confirm button on an empty field used to do nothing
      // whatsoever: the dialog stayed, focus moved, and nothing said why.
      const v = requireValue(input, `${label} cannot be empty.`);
      if (!v) return;
      resolve(v);
      modal.close();
    };
    const content = el('form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
      el('div.field', {}, el('label.label', { htmlFor: id }, label), input),
      el('div.row.row-end', {},
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
        el('button.btn.btn-primary', { type: 'submit' }, confirmLabel)
      )
    );
    const modal = openModal({ title, content, onClose: () => resolve(null) });
    // select() is only meaningful (and only legal) on a text field.
    setTimeout(() => (type === 'text' ? input.select() : input.focus()), 30);
  });
}
