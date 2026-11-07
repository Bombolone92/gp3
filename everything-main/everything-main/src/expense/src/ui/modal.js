import { el } from './dom.js';
import { icon } from './icons.js';

/* Every dialog currently on screen, so the router can take them down with
   the view that opened them. */
const openDialogs = new Set();

export function closeAllModals() {
  for (const close of [...openDialogs]) close();
}

/**
 * Bottom sheet on mobile, centered dialog on desktop.
 * openModal({ title, content, onClose, wide }) -> { close(), panel }
 */
export function openModal({ title, content, onClose, wide = false, headerActions = null }) {
  const panel = el('div.modal-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: -1 });
  if (wide) panel.classList.add('wide');
  const rootNode = el('div.modal-root', {},
    el('div.modal-scrim', { onclick: () => close() }),
    panel
  );

  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const appEl = document.getElementById('app');

  panel.append(
    el('div.sheet-handle'),
    el('div.modal-head', {},
      el('h2.modal-title', {}, title),
      headerActions,
      el('button.icon-btn', { type: 'button', html: icon('x', 20), 'aria-label': 'Close', onclick: () => close() })
    ),
    el('div.modal-body', {}, content)
  );

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    openDialogs.delete(close);
    rootNode.classList.add('closing');
    const stack = document.querySelectorAll('.modal-root:not(.closing)');
    stack[stack.length - 1]?.removeAttribute('inert');
    document.removeEventListener('keydown', onKey);
    onClose?.();
    setTimeout(() => {
      rootNode.remove();
      if (!document.querySelector('.modal-root')) {
        document.body.classList.remove('modal-open');
        appEl?.removeAttribute('inert');
      }
      if (opener?.isConnected) opener.focus();
    }, 200);
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    const open = document.querySelectorAll('.modal-root:not(.closing)');
    if (open[open.length - 1] === rootNode) close();
  }

  document.addEventListener('keydown', onKey);
  openDialogs.add(close);
  document.body.classList.add('modal-open');
  appEl?.setAttribute('inert', '');
  for (const m of document.querySelectorAll('.modal-root:not(.closing)')) m.setAttribute('inert', '');
  document.body.append(rootNode);

  const focusable = panel.querySelector('input:not([type="file"]), select, textarea, button:not(.icon-btn)');
  if (focusable && globalThis.matchMedia?.('(min-width: 640px)').matches) focusable.focus();
  else panel.focus({ preventScroll: true });

  return { close, panel };
}

/** Confirm dialog. Resolves true/false (false on Escape, scrim, or close). */
export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const content = el('div', {},
      el('p.modal-text', {}, message),
      el('div.row.end', {},
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
        el(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, {
          type: 'button',
          onclick: () => { resolve(true); modal.close(); },
        }, confirmLabel)
      )
    );
    const modal = openModal({ title, content, onClose: () => resolve(false) });
  });
}
