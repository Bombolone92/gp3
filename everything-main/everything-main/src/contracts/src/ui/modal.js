import { el } from './dom.js';
import { icon } from './icons.js';

/**
 * Bottom sheet on mobile, centered dialog on desktop.
 * openModal({ title, content, onClose, beforeClose, wide }) → { close(), panel }
 *
 * `beforeClose` (optional, may be async) runs only for user-initiated
 * dismissals — Escape, scrim click, the X button — and can veto them by
 * returning false. Forms use it to confirm before unsaved input is lost.
 * The returned close() is unconditional, so saving still closes directly.
 */
export function openModal({ title, content, onClose, beforeClose = null, wide = false }) {
  const panel = el('div.modal-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: -1 });
  if (wide) panel.classList.add('wide');
  const rootNode = el('div.modal-root', {},
    el('div.modal-scrim', { onclick: () => requestClose() }),
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
      el('button.icon-btn', {
        html: icon('x', 20), 'aria-label': 'Close', title: 'Close',
        onclick: () => requestClose(),
      })
    ),
    content
  );

  /*
   * The head sticks and is opaque, so scrolled content passes behind it with
   * nothing marking where the sheet's chrome ends: a field label sliced
   * through the middle reads as a rendering fault rather than as content
   * continuing above. A hairline appears the moment there is something behind
   * the head, and goes again at the top of the sheet.
   */
  const syncScrolled = () => panel.classList.toggle('scrolled', panel.scrollTop > 0);
  panel.addEventListener('scroll', syncScrolled, { passive: true });
  syncScrolled();

  let closed = false;
  let confirming = false;

  async function requestClose() {
    if (closed || confirming) return;
    if (beforeClose) {
      confirming = true;
      try {
        if (!(await beforeClose())) return;
      } finally {
        confirming = false;
      }
    }
    close();
  }
  function close() {
    if (closed) return;
    closed = true;
    rootNode.classList.add('closing');
    // Hand focusability back to the dialog that is now topmost, or — when
    // this was the last one — to the app right away: keeping it inert for
    // the length of the exit animation swallows immediate clicks.
    const stack = document.querySelectorAll('.modal-root:not(.closing)');
    stack[stack.length - 1]?.removeAttribute('inert');
    if (!stack.length) {
      document.body.classList.remove('modal-open');
      appEl?.removeAttribute('inert');
    }
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onRouted);
    onClose?.();
    setTimeout(() => {
      rootNode.remove();
      // Re-check: a new dialog may have opened during the animation.
      if (!document.querySelector('.modal-root')) {
        document.body.classList.remove('modal-open');
        appEl?.removeAttribute('inert');
      }
      if (opener?.isConnected) opener.focus();
    }, 200);
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    // Only the top of a modal stack (e.g. confirm over an edit sheet) closes.
    const open = document.querySelectorAll('.modal-root:not(.closing)');
    if (open[open.length - 1] === rootNode) requestClose();
  }

  /*
   * The hash is this app's router, so the browser's Back button changes the
   * page under an open sheet. With the app inert behind it nothing looked as
   * though it had happened: the sheet stayed put, the press appeared to do
   * nothing, and closing it later revealed a page the user had not asked for.
   *
   * close() rather than requestClose(): the route has already moved by the
   * time this runs, so a form's "discard changes?" could only ever offer to
   * keep an unsaved sheet floating over somewhere else.
   */
  function onRouted() {
    close();
  }

  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onRouted);
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

/** Simple confirm dialog. Resolves true/false (false on Escape/scrim/close). */
export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const content = el('div', {},
      el('p', { style: { color: 'var(--ink-2)', marginBottom: '18px', fontSize: '14px' } }, message),
      el('div.row', { style: { justifyContent: 'flex-end' } },
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
