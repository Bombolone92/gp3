import { el } from './dom.js';
import { icon } from './icons.js';

/**
 * Bottom sheet on mobile, centered dialog on desktop.
 * openModal({ title, content, onClose, wide, canClose }) → { close(), panel }
 *
 * `canClose()` is asked before every close - the X, the scrim, Escape, and
 * the caller's own close() - so a dialog with a write in flight can hold
 * until it lands.
 */
export function openModal({ title, content, onClose, wide = false, canClose = null }) {
  const panel = el('div.modal-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: -1 });
  if (wide) panel.classList.add('wide');
  /* A real double-click on the control that opens a sheet lands its second
     click on the scrim, since the sheet is up by then - and closed what the
     first click had opened, leaving the user staring at the button. A scrim
     click inside the first quarter second is not a dismissal. */
  const openedAt = performance.now();
  const rootNode = el('div.modal-root', {},
    el('div.modal-scrim', { onclick: () => { if (performance.now() - openedAt > 250) close(); } }),
    panel
  );

  // Keep keyboard and screen-reader focus inside the dialog, and put it
  // back where it came from on close.
  // The body counts as nothing to go back to: it holds the focus whenever a
  // re-render has just dropped it, and "restoring" it would only skip the
  // landmark fallback below.
  const active = document.activeElement;
  const opener = active instanceof HTMLElement && active !== document.body ? active : null;
  /* Opened from inside another dialog - a row of an actions sheet, which
     closes as this one opens - the control that opened it is gone by the
     time this one closes. That dialog's own opener, the button on the page
     that started the chain, is where focus belongs then; a confirm stacked
     over a sheet that stays open goes back to its button in the sheet. */
  const parentRoot = opener?.closest('.modal-root') || null;
  const parentOpener = parentRoot?.__opener || null;
  /* And only while the page is the one the dialog opened on. A search result
     or a More-sheet row navigates as it closes: the opener - the Search
     button, still standing - took focus back 200ms later, after the shell
     had already looked and found focus still inside the closing dialog, so
     a keyboard user landed on the button they had left rather than on the
     page they had just chosen. */
  /* Whether the page moved while the dialog was up. Compared by hash before,
     which a view's own history.replaceState undid within the delay below -
     the round model takes its scenario id off the address as it renders -
     so a search result chosen while on that very page handed focus back to
     the Search button rather than to the page just chosen. */
  let navigated = false;
  const onHashChange = () => { navigated = true; };
  window.addEventListener('hashchange', onHashChange);
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
    if (closed || (canClose && !canClose())) return;
    closed = true;
    rootNode.classList.add('closing');
    // Hand focusability back to the dialog that is now topmost.
    const stack = document.querySelectorAll('.modal-root:not(.closing)');
    stack[stack.length - 1]?.removeAttribute('inert');
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('focusin', onFocusIn);
    onClose?.();
    setTimeout(() => {
      rootNode.remove();
      const last = !document.querySelector('.modal-root');
      if (last) {
        document.body.classList.remove('modal-open');
        appEl?.removeAttribute('inert');
      }
      /* Focus goes back where it came from - except that the control which
         opened the dialog usually isn't there any more. Saving writes to the
         store, which re-renders the whole view the opener lived in, so the
         edit button on a table row is a fresh element by the time the sheet
         finishes closing. Left to fall through, focus lands on the document
         body and the next Tab restarts before the skip link and the entire
         nav; the content landmark is the nearest honest substitute. */
      window.removeEventListener('hashchange', onHashChange);
      const back = opener?.isConnected
        ? opener
        : (parentOpener?.isConnected && !parentRoot?.isConnected ? parentOpener : null);
      if (back && !navigated) back.focus();
      else if (last) document.getElementById('main')?.focus({ preventScroll: true });
    }, 200);
  }

  function onKey(e) {
    // Escape spent cancelling an IME composition is the composition's - taken
    // here it closed the sheet with every field typed so far.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key !== 'Escape' && e.key !== 'Tab') return;
    // Only the top of a modal stack (e.g. confirm over an edit sheet) closes.
    const open = document.querySelectorAll('.modal-root:not(.closing)');
    if (open[open.length - 1] !== rootNode) return;
    if (e.key === 'Escape') {
      close();
      return;
    }
    // focusin cannot catch focus moving into the browser toolbar. Wrap at
    // either end of the dialog before the browser performs that navigation.
    /* `summary` too: the History detail sheet is paragraphs and collapsed
       <details> blocks whose only tabbable is the summary, so with it
       missing the cycle was the close button alone and no change could be
       opened from the keyboard. */
    const controls = [...panel.querySelectorAll(
      'a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable="true"]')]
      .filter((node) => node.tabIndex >= 0 && !node.matches(':disabled')
        && !node.closest('[inert]') && node.getClientRects().length > 0
        && getComputedStyle(node).visibility !== 'hidden');
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = document.activeElement;
    if (!first || active === panel || !panel.contains(active)
      || (e.shiftKey ? active === first : active === last)) {
      e.preventDefault();
      (e.shiftKey ? last : first)?.focus();
      if (!first) panel.focus();
    }
  }

  /* Keep focus in the dialog. `inert` on #app covers the app, but the toast
     stack sits on <body> beside it and cannot be inert as well: it is the live
     region that announces "Couldn't save. Check your connection", which is
     fired from inside these very forms, and inert content is not announced.
     So a toast's Undo button was the one control a Tab could still reach out
     of an open sheet - and pressing it undid a deletion the dialog on screen
     knew nothing about. The dialog guards its own focus instead: anything that
     lands outside it comes straight back. */
  function onFocusIn(e) {
    if (closed || rootNode.contains(e.target)) return;
    // Only the top of a stack guards; the ones under it are already inert.
    const open = document.querySelectorAll('.modal-root:not(.closing)');
    if (open[open.length - 1] !== rootNode) return;
    panel.focus({ preventScroll: true });
  }

  // The button on the page this dialog (or the chain it continues) came from.
  rootNode.__opener = parentRoot ? parentOpener : opener;
  document.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocusIn);
  document.body.classList.add('modal-open');
  appEl?.setAttribute('inert', '');
  // Stacked dialogs: only the topmost may hold focus.
  for (const m of document.querySelectorAll('.modal-root:not(.closing)')) m.setAttribute('inert', '');
  document.body.append(rootNode);

  /* One microtask later, not now: the wizards - issue a security, import a
     CSV, close a round, mark a holder departed - open the dialog first and
     render into it afterwards, all in this same task. Looking for a control
     synchronously found an empty panel in exactly those four sheets, so the
     longest flows in the app were the ones that dropped the user on the
     dialog box and made them tab past the close button to reach the first
     field, while every shorter sheet landed in it directly.

     :enabled - focus() on a disabled control silently no-ops, and with the
     app inert behind the dialog nothing would hold focus at all (an action
     sheet can open with every row disabled). Rendered, for the same reason:
     a hidden control takes focus no better than a disabled one, and the
     attachments block leads with a display:none file input. */
  queueMicrotask(() => {
    if (closed || !rootNode.isConnected) return;
    const focusable = [...panel.querySelectorAll(
      'input:enabled, select:enabled, textarea:enabled, button:not(.icon-btn):enabled')]
      .find((node) => node.getClientRects().length > 0);
    if (focusable && matchMedia('(min-width: 640px)').matches) focusable.focus();
    else panel.focus({ preventScroll: true });
  });

  return { close, panel };
}

/** Simple confirm dialog. Resolves true/false (false on Escape/scrim/close too). */
export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const content = el('div', {},
      el('p.confirm-message', {}, message),
      el('div.row.row-end', {},
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
