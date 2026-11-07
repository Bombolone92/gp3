/**
 * Modal dialogs on the native <dialog> element: focus trapping, Escape, an
 * inert background, and the top layer come for free.
 */
import { h, uniqueId, append } from './dom.js';
import { icon } from './icons.js';
import { toastRegion, adoptToasts } from './toast.js';

/**
 * openDialog({ title, body, footer, size, onClose })
 * body/footer may be nodes or functions receiving { close }.
 * size: '' | 'narrow' | 'wide' | 'full'. describe: the body is the dialog's
 * description (short messages). Returns { dialog, close }.
 */
export function openDialog({ title, subtitle, body, footer, size = '', onClose, initialFocus, label, cls = '', describe = false } = {}) {
  const titleId = uniqueId('dlg');
  const bodyId = describe ? uniqueId('dlg-body') : null;
  const dlg = h(`dialog.dialog${size ? '.' + size : ''}${cls ? '.' + cls : ''}`, {
    'aria-labelledby': title ? titleId : null,
    'aria-label': title ? null : label || null,
    'aria-describedby': bodyId,
  });
  // Toasts shown while this dialog is open appear here (in the top layer).
  const toasts = toastRegion();
  const opener = document.activeElement;
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    dlg.close();
    adoptToasts(toasts);
    dlg.remove();
    restoreFocus(opener);
    onClose?.(result);
  };
  const api = { dialog: dlg, close };
  const bodyNode = typeof body === 'function' ? body(api) : body;
  const footNode = typeof footer === 'function' ? footer(api) : footer;
  append(dlg, [
    title
      ? h(
          'div.dialog-head',
          h('div.grow', h('h2', { id: titleId }, title), subtitle ? h('p.dialog-sub', subtitle) : null),
          h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onClick: () => close() }, icon('x')),
        )
      : null,
    h('div.dialog-body', { id: bodyId }, bodyNode),
    footNode ? h('div.dialog-foot', footNode) : null,
  ]);
  dlg.append(toasts);
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  // A press that starts and ends on the backdrop closes the dialog.
  let downOnBackdrop = false;
  const outside = (e) => {
    const r = dlg.getBoundingClientRect();
    return e.target === dlg && !(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
  };
  dlg.addEventListener('mousedown', (e) => (downOnBackdrop = outside(e)));
  dlg.addEventListener('mouseup', (e) => {
    if (downOnBackdrop && outside(e)) close();
    downOnBackdrop = false;
  });
  document.body.append(dlg);
  dlg.showModal();
  const focusTarget = initialFocus
    ? dlg.querySelector(initialFocus)
    : dlg.querySelector('[autofocus], .dialog-body input:not([type=hidden]):not([type=checkbox]), .dialog-body select, .dialog-body textarea');
  (focusTarget || dlg.querySelector('.dialog-foot .btn.primary') || dlg).focus?.();
  return api;
}

/**
 * Return focus to what opened a dialog. A save can redraw the page while the
 * dialog is open, taking that button with it: then focus the one control
 * just like it, or the page itself, rather than leaving keyboard and screen
 * reader users at the top of the document.
 */
function restoreFocus(opener) {
  const lost = !document.activeElement || document.activeElement === document.body;
  if (!lost || !opener || opener === document.body) return;
  if (opener.isConnected) return opener.focus?.({ preventScroll: true });
  const same = (el) => el.textContent === opener.textContent && el.className === opener.className && el.getAttribute('aria-label') === opener.getAttribute('aria-label');
  const like = [...document.querySelectorAll(opener.tagName)].filter(same);
  const target = like.length === 1 ? like[0] : document.getElementById('main');
  target?.focus?.({ preventScroll: true });
}

/** Promise-based confirm. Resolves true or false. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    let result = false;
    openDialog({
      title,
      size: 'narrow',
      // Focus starts on a button, so the message must be read with the title.
      describe: true,
      body: typeof message === 'string' ? h('p', message) : message,
      footer: ({ close }) => [
        h('button.btn', { type: 'button', onClick: () => close() }, cancelLabel),
        h(
          `button.btn.${danger ? 'danger' : 'primary'}`,
          {
            type: 'button',
            onClick: () => {
              result = true;
              close();
            },
          },
          confirmLabel,
        ),
      ],
      onClose: () => resolve(result),
      // Destructive choices start on Cancel, so an extra Enter cannot confirm them.
      initialFocus: danger ? '.dialog-foot .btn:first-child' : '.dialog-foot .btn:last-child',
    });
  });
}

/**
 * A form dialog: renders `body` inside a <form>, validates [required]
 * fields, calls onSubmit(formData, form, api) and closes unless it returns
 * false. `extraButtons` adds secondary submit variants, each with
 * { label, value }; the clicked value is passed as formData.get('_action').
 */
export function formDialog({ title, subtitle, size, body, submitLabel = 'Save', onSubmit, danger = false, extraFooter, extraButtons = [] }) {
  return new Promise((resolve) => {
    let result = null;
    const formId = uniqueId('form');
    openDialog({
      title,
      subtitle,
      size,
      body: (ctx) => {
        const form = h('form.form', { id: formId, novalidate: true }, typeof body === 'function' ? body(ctx) : body);
        let busy = false;
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          // A second click while an async save is running would save twice.
          if (busy) return;
          for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
          const invalid = [...form.querySelectorAll('[required]')].find((el) => !el.disabled && !String(el.value || '').trim());
          if (invalid) {
            invalid.setAttribute('aria-invalid', 'true');
            invalid.focus();
            return;
          }
          const fd = new FormData(form);
          fd.set('_action', e.submitter?.value || 'save');
          let out;
          busy = true;
          try {
            out = await onSubmit(fd, form, ctx);
          } finally {
            busy = false;
          }
          if (out === false) return;
          result = out ?? true;
          ctx.close();
        });
        return form;
      },
      footer: ({ close }) => [
        extraFooter ? extraFooter({ close }) : null,
        h('div.spacer'),
        h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
        extraButtons.map((b) => h('button.btn', { type: 'submit', form: formId, value: b.value }, b.label)),
        h(`button.btn.${danger ? 'danger' : 'primary'}`, { type: 'submit', form: formId, value: 'save' }, submitLabel),
      ],
      onClose: () => resolve(result),
    });
  });
}
