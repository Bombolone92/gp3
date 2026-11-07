/**
 * Modal dialogs on the native <dialog> element (focus trap, Esc, inert
 * background and top layer come for free).
 */
import { h, uniqueId, append } from './dom.js';
import { icon } from './icons.js';
import { rehomeToasts } from './toast.js';

/**
 * openDialog({ title, body, footer, size, sheet, onClose })
 * body/footer may be nodes or functions receiving { close }.
 * Returns { dialog, close }.
 */
export function openDialog({ title, body, footer, size = '', sheet = false, onClose, initialFocus, label } = {}) {
  const titleId = uniqueId('dlg');
  const dlg = h(`dialog.${sheet ? 'sheet' : 'dialog'}${size ? '.' + size : ''}`, {
    'aria-labelledby': title ? titleId : null,
    'aria-label': title ? null : label || null,
  });
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    dlg.close();
    rehomeToasts();
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
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  // Click on the backdrop closes.
  dlg.addEventListener('mousedown', (e) => {
    if (e.target === dlg) {
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) close();
    }
  });
  document.body.append(dlg);
  dlg.showModal();
  const focusTarget = initialFocus ? dlg.querySelector(initialFocus) : dlg.querySelector('[autofocus], .dialog-body input, .dialog-body select, .dialog-body textarea');
  (focusTarget || dlg.querySelector('.dialog-foot .btn.primary') || dlg).focus?.();
  return api;
}

/** Promise-based confirm. Resolves true/false. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    let result = false;
    openDialog({
      title,
      size: 'narrow',
      body: h('p', message),
      footer: ({ close }) => [
        h('button.btn', { type: 'button', onClick: () => close() }, cancelLabel),
        h(
          `button.btn.${danger ? 'danger' : 'primary'}`,
          {
            type: 'button',
            autofocus: true,
            onClick: () => {
              result = true;
              close();
            },
          },
          confirmLabel,
        ),
      ],
      onClose: () => resolve(result),
      initialFocus: '.dialog-foot .btn:last-child',
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
