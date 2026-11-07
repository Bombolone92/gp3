/**
 * Modal dialogs on the native <dialog> element (focus trap, Esc, inert
 * background and top layer come for free).
 */
import { h, uniqueId, append } from './dom.js';
import { icon } from './icons.js';
import { rehomeToasts } from './toast.js';

/**
 * openDialog({ title, body, footer, size, sheet, onClose, confirmDismiss })
 * body/footer may be nodes or functions receiving { close }.
 * confirmDismiss() may return false (or a promise of false) to keep the
 * dialog open when Escape or a click outside would close it. `alert`
 * makes it an alert dialog, described by the node with id `describedBy`.
 * Returns { dialog, close }.
 */
export function openDialog({ title, body, footer, size = '', sheet = false, onClose, initialFocus, label, confirmDismiss, alert = false, describedBy = null } = {}) {
  const titleId = uniqueId('dlg');
  const dlg = h(`dialog.${sheet ? 'sheet' : 'dialog'}${size ? '.' + size : ''}`, {
    role: alert ? 'alertdialog' : null,
    'aria-labelledby': title ? titleId : null,
    'aria-label': title ? null : label || null,
    'aria-describedby': describedBy,
  });
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    dlg.close();
    rehomeToasts(dlg);
    dlg.remove();
    onClose?.(result);
  };
  const api = { dialog: dlg, close };
  const bodyNode = typeof body === 'function' ? body(api) : body;
  const footNode = typeof footer === 'function' ? footer(api) : footer;
  append(dlg, [
    title
      ? h(
          'div.dialog-head',
          h('h2.grow', { id: titleId }, title),
          h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onClick: () => close() }, icon('x')),
        )
      : null,
    h('div.dialog-body', bodyNode),
    footNode ? h('div.dialog-foot', footNode) : null,
  ]);
  // Escape and clicks outside are easy to do by accident.
  let asking = false;
  const dismiss = async () => {
    if (closed || asking) return;
    if (confirmDismiss) {
      asking = true;
      try {
        if ((await confirmDismiss()) === false) return;
      } finally {
        asking = false;
      }
    }
    close();
  };
  // The browser may close a dialog itself: Chrome does on a repeated Escape
  // after a cancelled one, with a cancel event that can't be prevented. A
  // dialog that asks first then opens again and asks.
  const reopen = () => {
    if (closed || dlg.open) return;
    dlg.showModal();
    dismiss();
  };
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (e.cancelable || !confirmDismiss) dismiss();
    else setTimeout(reopen);
  });
  // Any other dialog finishes closing (removed and resolved).
  dlg.addEventListener('close', () => (confirmDismiss ? reopen() : close()));
  // Click on the backdrop closes.
  dlg.addEventListener('mousedown', (e) => {
    if (e.target === dlg) {
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) dismiss();
    }
  });
  document.body.append(dlg);
  dlg.showModal();
  const focusTarget = initialFocus ? dlg.querySelector(initialFocus) : dlg.querySelector('[autofocus], .dialog-body input, .dialog-body select, .dialog-body textarea');
  (focusTarget || dlg.querySelector('.dialog-foot .btn.primary') || dlg).focus?.();
  return api;
}

/**
 * Promise-based confirm. Resolves true/false. A `danger` confirm starts on
 * Cancel, so an Enter or Space pressed right away destroys nothing.
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    let result = false;
    // Focus starts on a button, so the message is read out as the
    // dialog's description.
    const messageId = uniqueId('msg');
    openDialog({
      title,
      size: 'narrow',
      alert: true,
      describedBy: messageId,
      body: h('p', { id: messageId }, message),
      footer: ({ close }) => [
        h('button.btn', { type: 'button', onClick: () => close() }, cancelLabel),
        h(
          `button.btn.${danger ? 'danger' : 'primary'}`,
          {
            type: 'button',
            autofocus: !danger || null,
            onClick: () => {
              result = true;
              close();
            },
          },
          confirmLabel,
        ),
      ],
      onClose: () => resolve(result),
      initialFocus: `.dialog-foot .btn:${danger ? 'first' : 'last'}-child`,
    });
  });
}

/**
 * A form dialog: renders `fields` inside a <form>, calls onSubmit(formData,
 * form) and closes when it returns anything but false.
 */
export function formDialog({ title, size, body, submitLabel = 'Save', onSubmit, danger = false, extraFooter }) {
  return new Promise((resolve) => {
    let result = null;
    const formId = uniqueId('form');
    const api = openDialog({
      title,
      size,
      body: (ctx) => {
        const form = h('form', { id: formId, novalidate: true }, typeof body === 'function' ? body(ctx) : body);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const invalid = [...form.querySelectorAll('[required]')].find((el) => !String(el.value || '').trim());
          if (invalid) {
            invalid.setAttribute('aria-invalid', 'true');
            invalid.focus();
            return;
          }
          const out = await onSubmit(new FormData(form), form);
          if (out === false) return;
          result = out ?? true;
          ctx.close();
        });
        return form;
      },
      footer: ({ close }) => [
        extraFooter ? extraFooter({ close }) : null,
        extraFooter ? h('div.spacer') : null,
        h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
        h(`button.btn.${danger ? 'danger' : 'primary'}`, { type: 'submit', form: formId }, submitLabel),
      ],
      onClose: () => resolve(result),
    });
    return api;
  });
}
