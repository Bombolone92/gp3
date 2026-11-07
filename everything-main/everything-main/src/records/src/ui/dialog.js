/**
 * Modal dialogs on the native <dialog> element: focus stays inside, Escape
 * closes, and focus returns to what opened it.
 */
import { h, overlayRoot } from '../lib/dom.js';
import { closePopoversIn } from './popover.js';
import { icon } from '../lib/icons.js';

let seq = 0;

/**
 * openDialog({ title, body, actions: [{ label, primary, danger, onClick }],
 * className, onClose, initialFocus, describe (the body describes the
 * dialog, as a confirm's message does) }) -> { el, close }
 * An action's onClick may return false (or a promise of false) to keep the
 * dialog open.
 */
export function openDialog({ title, body, actions = [], className = '', onClose, initialFocus, closeButton = true, label, describe = false }) {
  const id = `dlg-${++seq}`;
  const previous = document.activeElement;
  const foot = h('div.dialog-foot');
  const el = h(`dialog.dialog${className ? `.${className.split(' ').join('.')}` : ''}`, { 'aria-labelledby': title ? `${id}-t` : null, 'aria-label': title ? null : label || null, 'aria-describedby': describe ? `${id}-b` : null });
  const head = title || closeButton
    ? h('div.dialog-head', title ? h('h2.dialog-title', { id: `${id}-t` }, title) : h('div', { style: { flex: '1' } }), closeButton ? h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x', 16)) : null)
    : null;
  const bodyEl = h('div.dialog-body', { id: describe ? `${id}-b` : null }, body);
  el.append(...[head, bodyEl, actions.length ? foot : null].filter(Boolean));
  // Announcements while the dialog is open (the page behind it is inert).
  el.append(h('div.sr-only', { 'aria-live': 'polite', 'aria-atomic': 'true', 'data-live': '' }));
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    closePopoversIn(el);
    if (el.open) el.close();
    // Toasts and tooltips shown over the dialog move to what is now on top.
    for (const n of el.querySelectorAll(':scope > [data-floating]')) overlayRoot().append(n);
    el.remove();
    onClose?.(result);
    if (previous && document.contains(previous)) previous.focus?.({ preventScroll: true });
  };
  for (const a of actions) {
    if (a.spacer) {
      foot.append(h('div.spacer'));
      continue;
    }
    const btn = h(`button.btn${a.primary ? '.primary' : ''}${a.danger ? '.danger' : ''}${a.ghost ? '.ghost' : ''}`, { type: 'button', disabled: a.disabled }, a.label);
    let busy = false;
    btn.addEventListener('click', async () => {
      // A second click while an action runs (an import, say) would run it twice.
      if (busy) return;
      busy = true;
      try {
        const r = a.onClick ? await a.onClick(btn) : undefined;
        if (r !== false) close(a.value ?? a.label);
      } finally {
        busy = false;
      }
    });
    a.el = btn;
    foot.append(btn);
  }
  el.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  // A click on the backdrop (outside the dialog box) closes it, but only
  // when it was pressed there too: selecting text and letting go outside
  // is not a click on the backdrop.
  const outside = (e) => {
    const r = el.getBoundingClientRect();
    return e.target === el && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
  };
  let pressedOutside = false;
  el.addEventListener('pointerdown', (e) => {
    pressedOutside = outside(e);
  });
  el.addEventListener('click', (e) => {
    if (pressedOutside && outside(e)) close();
    pressedOutside = false;
  });
  document.body.append(el);
  el._openedAt = performance.now();
  el.showModal();
  // With no primary action (a dangerous confirm), the first, safe action
  // takes focus rather than the close button.
  const focusTarget = initialFocus || el.querySelector('[autofocus]') || el.querySelector('input, textarea, select') || actions.find((a) => a.primary)?.el || foot.querySelector('button') || el.querySelector('button');
  focusTarget?.focus?.();
  return { el, body: bodyEl, close, actions };
}

/** Ask a yes/no question. Resolves true when confirmed. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    openDialog({
      title,
      body: typeof message === 'string' ? h('p', message) : message,
      describe: true,
      actions: [
        { label: cancelLabel },
        { label: confirmLabel, primary: !danger, danger, onClick: () => (result = true) },
      ],
      onClose: () => resolve(result),
    });
  });
}

/** Ask for a line of text. Resolves the text, or null when cancelled. */
export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Save', validate }) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input.input', { type: 'text', value, placeholder, 'aria-label': label || title });
    const error = h('p.field-error', { role: 'alert' });
    const submit = () => {
      const v = input.value.trim();
      const msg = validate?.(v);
      if (msg) {
        error.textContent = msg;
        return false;
      }
      result = v;
      return true;
    };
    const dlg = openDialog({
      title,
      body: h('div', label ? h('label.field-label', label) : null, input, error),
      actions: [{ label: 'Cancel' }, { label: confirmLabel, primary: true, onClick: () => submit() }],
      onClose: () => resolve(result),
      initialFocus: input,
    });
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (submit()) dlg.close();
      }
    });
  });
}
