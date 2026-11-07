import { el, focusables, composing } from './dom.js';
import { icon } from './icons.js';

const openDialogs = new Set();
/** Each open dialog's opener and where it stood, so a dialog opened from a closing one inherits them. */
const openers = new WeakMap();

export function closeAllModals() {
  for (const close of [...openDialogs]) close();
}

/**
 * Bottom sheet on small screens, centered dialog on larger ones.
 * openModal({ title, content, onClose, wide }) -> { close, panel }
 *
 * `bare` drops the sheet handle and the title bar and lets `content` fill
 * the screen (the image viewer): the layer, the scrim that closes it, the
 * Escape key, the focus trap, and the stacking with other dialogs are the
 * same as any dialog's, so a viewer opened over a dialog, or a dialog over
 * the viewer, behaves. `className` goes on the root for the layer's styles.
 */
export function openModal({ title, content, onClose, wide = false, label, bare = false, className = '' }) {
  const panel = el('div.modal-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label || title, tabindex: -1 });
  if (wide) panel.classList.add('wide');
  if (bare) panel.classList.add('bare');
  const rootNode = el(`div.modal-root${className ? `.${className}` : ''}`, {}, el('div.modal-scrim', { onclick: () => close() }), panel);
  // Where focus goes back to on close. A dialog opened from a button inside
  // a dialog that is closing this very moment (Workspace settings → Members)
  // answers to that dialog's opener: the button itself is about to be
  // removed, and focus would otherwise end up on the page body.
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // Or with nobody holding the keyboard: the press the closing dialog
  // answered was on its form's button, disabled while the request was out
  // (see dialogs.js busy), and a focused button that is disabled hands the
  // keyboard to the page body (the focus fixup rule). The dialog closing
  // this very moment is then the one this was opened from (Create a channel
  // → Add people, New webhook → its token), and its opener is inherited all
  // the same. Taken for the opener, the body left the keyboard on the page
  // when this one closed, and the next Tab started over from the top.
  const closing = active?.closest('.modal-root.closing')
    || (!active || active === document.body ? [...document.querySelectorAll('.modal-root.closing')].pop() || null : null);
  const inherited = closing ? openers.get(closing) : null;
  const opener = inherited ? inherited.el : active;
  // And where it stands: the opener is often gone by the time the dialog
  // closes, taken off the page by the very thing the dialog confirmed (the
  // row of a deleted message, a removed member's menu button, a header
  // rebuilt by a navigation). Focus then goes to whatever stands in its
  // place, as a menu's does (see openPopover), rather than to the page body,
  // where the next Tab starts over from the top.
  const openerRect = inherited ? inherited.rect : opener?.getBoundingClientRect() || null;
  const appEl = document.getElementById('app');

  if (bare) panel.append(content);
  else {
    panel.append(
      el('div.sheet-handle'),
      el('div.modal-head', {},
        el('h2.modal-title', {}, title),
        el('button.icon-btn', { type: 'button', html: icon('x', 20), 'aria-label': 'Close', onclick: () => close() })),
      content,
    );
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    openDialogs.delete(close);
    rootNode.classList.add('closing');
    const stack = document.querySelectorAll('.modal-root:not(.closing)');
    stack[stack.length - 1]?.removeAttribute('inert');
    // The page takes clicks again the moment the last dialog starts to
    // leave, not when its exit animation has ended: an inert app discards
    // every pointer event, so Done and then a sidebar row (or Cancel and
    // then the other button) within those 200ms lost the second click. The
    // leaving layer itself lets clicks through meanwhile (see .closing in
    // the stylesheet). The check below the animation stays as a fallback.
    if (!stack.length) {
      document.body.classList.remove('modal-open');
      appEl?.removeAttribute('inert');
    }
    document.removeEventListener('keydown', onKey);
    onClose?.();
    setTimeout(() => {
      rootNode.remove();
      if (!document.querySelector('.modal-root')) {
        document.body.classList.remove('modal-open');
        appEl?.removeAttribute('inert');
      }
      if (opener?.isConnected) {
        // An opener drawn only while its row is under the pointer or holds
        // the keyboard (a message's hover bar, see .msg-actions): the dialog
        // took the keyboard from the row, so the bar is not drawn now, and
        // a browser will not focus a control that is not drawn — Cancel on
        // "Delete message?" or on Forward left the keyboard on the page,
        // where the next Tab starts over from the top. The row takes it
        // first, which draws the bar, and the opener takes it from there
        // (as a menu's close does, see openPopover).
        if (opener.offsetParent === null) opener.parentElement?.closest('[tabindex]')?.focus({ preventScroll: true });
        opener.focus({ preventScroll: true });
      } else if (openerRect?.width) {
        const at = document.elementFromPoint(openerRect.left + openerRect.width / 2, openerRect.top + openerRect.height / 2);
        at?.closest?.('button, [tabindex], a[href], input, select, textarea')?.focus({ preventScroll: true });
      }
    }, 200);
  }

  function onKey(e) {
    const open = document.querySelectorAll('.modal-root:not(.closing)');
    if (open[open.length - 1] !== rootNode) return;
    if (e.key === 'Escape') {
      // An input method's Escape cancels the word being composed in one of
      // the dialog's fields, nothing more; the dialog stays.
      if (composing(e)) return;
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog.
      const list = focusables(panel);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  document.addEventListener('keydown', onKey);
  openDialogs.add(close);
  document.body.classList.add('modal-open');
  appEl?.setAttribute('inert', '');
  for (const m of document.querySelectorAll('.modal-root:not(.closing)')) m.setAttribute('inert', '');
  document.body.append(rootNode);
  openers.set(rootNode, { el: opener, rect: openerRect });

  // The first field or button that can take focus: a hidden file input
  // (chosen through a button) or a disabled control would swallow the call,
  // and focus would fall to the page body behind the inert app. On a phone
  // the panel takes focus instead, so the keyboard does not open over a
  // sheet that has only just slid in.
  const firstField = () => (bare ? null : focusables(panel).find((n) => n.matches('input, select, textarea, button:not(.icon-btn)')));
  const focusFirst = () => {
    const focusable = firstField();
    if (focusable && matchMedia('(min-width: 640px)').matches) focusable.focus();
    else panel.focus({ preventScroll: true });
  };
  focusFirst();
  // Several dialogs open on an empty panel and draw their content right
  // after (the invite dialogs, settings, members): at this point they have
  // nothing to focus, and the panel kept it, so the Email tab's address box
  // or a settings field had to be clicked into. Look once more after the
  // opener's synchronous work has run, and only while the panel itself still
  // holds focus, so a dialog that placed focus deliberately keeps its choice.
  queueMicrotask(() => {
    if (closed || document.activeElement !== panel) return;
    if (firstField()) focusFirst();
  });

  return { close, panel, root: rootNode };
}

/** Confirm dialog. Resolves true/false (false on Escape, scrim, and the X). */
export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const content = el('div', {},
      el('p', { style: { color: 'var(--ink-2)', marginBottom: '18px', fontSize: '14px' } }, message),
      el('div.modal-actions', {},
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
        el(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, {
          type: 'button',
          onclick: () => {
            resolve(true);
            modal.close();
          },
        }, confirmLabel)));
    const modal = openModal({ title, content, onClose: () => resolve(false) });
  });
}
