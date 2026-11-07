import { el } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';

/* Every open dialog, so navigation can sweep them away: a modal belongs to
   the page that opened it, and the browser's Back button would otherwise
   swap the view underneath while the dialog floats over the wrong page. */
const openModals = new Set();

export function closeAllModals() {
  for (const close of [...openModals]) close('sweep');
}

/**
 * Bottom sheet on mobile, centered dialog on desktop.
 * openModal({ title, content, onClose, wide, opener }) -> { close, panel, lock }
 *
 * lock(message) holds the dialog open while work it started is still
 * running — Escape, the scrim, the X and a route sweep all leave it be, and
 * a press says why — until lock(null) lets go. The import wizard uses it:
 * the writes went on after Escape hid the sheet, the page underneath was
 * live again, and a second import could start beside the first.
 */
export function openModal({ title, content, onClose, wide = false, opener = null }) {
  const panel = el('div.modal-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: -1 });
  if (wide) panel.classList.add('wide');
  const rootNode = el('div.modal-root', {},
    el('div.modal-scrim', { onclick: () => close() }),
    panel
  );

  // Keep keyboard and screen-reader focus inside the dialog, and put it
  // back where it came from on close. <body> is not an opener: a button
  // that disables itself while opening a dialog has already shed focus.
  // A caller that had to await something before it could show the dialog
  // (compose publishes the online copy first) passes the control it started
  // from, because that control may have lost focus — or been re-rendered
  // away by the wait's own save — long before this runs.
  const from = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : (opener instanceof HTMLElement && opener !== document.body ? opener : null);
  const appEl = document.getElementById('app');

  const closeBtn = el('button.icon-btn', { html: icon('x', 18), 'aria-label': 'Close', onclick: () => close() });
  panel.append(
    el('div.sheet-handle'),
    el('div.modal-head', {},
      el('h2.modal-title', {}, title),
      closeBtn
    ),
    content
  );

  let closed = false;
  let held = null;
  function lock(message) {
    held = message || null;
    closeBtn.disabled = !!held;
    closeBtn.title = held || '';
  }
  function close(reason) {
    if (closed) return;
    if (held) {
      if (reason !== 'sweep') toast(held, { icon: 'hourglass' });
      return;
    }
    closed = true;
    openModals.delete(close);
    rootNode.classList.add('closing');
    // Hand focusability back to the dialog that is now topmost.
    const stack = document.querySelectorAll('.modal-root:not(.closing)');
    stack[stack.length - 1]?.removeAttribute('inert');
    document.removeEventListener('keydown', onKey);
    // 'sweep' when navigation closed the dialog over the user's head;
    // undefined for a deliberate close (Escape, the scrim, the X, or the
    // caller's own close()). A form can use the difference to keep what was
    // typed across a route change without treating "never mind" as it.
    onClose?.(reason);
    setTimeout(() => {
      rootNode.remove();
      const noneLeft = !document.querySelector('.modal-root');
      if (noneLeft) {
        document.body.classList.remove('modal-open');
        appEl?.removeAttribute('inert');
        document.querySelector('.toast-root')?.removeAttribute('inert');
      }
      if (from?.isConnected) {
        from.focus();
      } else if (noneLeft) {
        // A dialog whose action mutates data makes the view re-render and
        // destroy the opener before this timeout runs (or the opener shed
        // focus before the dialog even opened). Its replacement renders
        // with the same accessible name — put focus there, or on the main
        // region, rather than dropping a keyboard user back to the top of
        // the page after every saving dialog.
        const name = from ? (from.getAttribute('aria-label') || from.textContent || '').trim() : '';
        const match = name && [...document.querySelectorAll('#app button, #app a[href]')]
          .find((c) => (c.getAttribute('aria-label') || c.textContent || '').trim() === name);
        if (match) {
          match.focus();
        } else {
          const main = document.getElementById('main');
          main?.setAttribute('tabindex', '-1');
          main?.focus({ preventScroll: true });
        }
      }
    }, 200);
  }

  /** Everything inside the panel a Tab can currently land on, in order. */
  function tabbable() {
    const sel = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return [...panel.querySelectorAll(sel)].filter((c) => !c.disabled
      && (c.offsetWidth || c.offsetHeight || c.getClientRects().length));
  }

  function onKey(e) {
    if (e.key !== 'Escape' && e.key !== 'Tab') return;
    // Only the top of a modal stack (e.g. confirm over a form) responds.
    const open = document.querySelectorAll('.modal-root:not(.closing)');
    if (open[open.length - 1] !== rootNode) return;
    if (e.key === 'Escape') {
      close();
      return;
    }
    // #app is inert, so nothing behind the dialog can take focus — but Tab
    // off the last control still walked out of the page and into the
    // browser's own toolbar. Carry it round to the other end instead.
    const items = tabbable();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const on = document.activeElement;
    if (e.shiftKey ? (on === first || on === panel) : on === last) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }

  document.addEventListener('keydown', onKey);
  openModals.add(close);
  document.body.classList.add('modal-open');
  appEl?.setAttribute('inert', '');
  // Toasts live outside #app and would otherwise stay clickable under the
  // dialog — an Undo action mutating state behind an open modal.
  document.querySelector('.toast-root')?.setAttribute('inert', '');
  // Stacked dialogs: only the topmost may hold focus.
  for (const m of document.querySelectorAll('.modal-root:not(.closing)')) m.setAttribute('inert', '');
  document.body.append(rootNode);

  const focusable = panel.querySelector('input, select, textarea, button:not(.icon-btn)');
  if (focusable && matchMedia('(min-width: 640px)').matches) focusable.focus();
  else panel.focus({ preventScroll: true });

  return { close, panel, lock };
}

/** Confirm dialog. Resolves true/false (false on Escape, scrim, or close). */
export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const content = el('div', {},
      el('p', { style: { color: 'var(--ink-2)', marginBottom: '18px', fontSize: '14px' } }, message),
      el('div.row', { style: { justifyContent: 'flex-end' } },
        el('button.btn.btn-ghost', { onclick: () => modal.close() }, 'Cancel'),
        el(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, {
          // Resolve before close(); close fires onClose, which resolves false.
          onclick: () => { resolve(true); modal.close(); },
        }, confirmLabel)
      )
    );
    const modal = openModal({ title, content, onClose: () => resolve(false) });
  });
}
