/**
 * Modal dialogs on the native <dialog> element (focus trap, Esc, inert
 * background and top layer come for free).
 */
import { h, uniqueId, append, FOCUSABLE } from './dom.js';
import { icon } from './icons.js';
import { moveToastsOut, ensureRegion } from './toast.js';

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
  const opener = document.activeElement;
  const scope = opener?.closest?.('main');
  const openerAt = scope ? [...scope.querySelectorAll(FOCUSABLE)].indexOf(opener) : -1;
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    dlg.close();
    moveToastsOut(dlg);
    dlg.remove();
    if (scope && (!document.activeElement || document.activeElement === document.body)) refocus(opener, scope, openerAt);
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
  // Click on the backdrop closes, unless something was entered: a stray
  // click must not throw away a half-filled form (Cancel and Esc still do).
  // Typing a search (the palette, a list filter) does not count.
  let edited = false;
  const onEdit = (e) => e.target.type !== 'search' && (edited = true);
  dlg.addEventListener('input', onEdit);
  dlg.addEventListener('change', onEdit);
  dlg.addEventListener('mousedown', (e) => {
    if (e.target === dlg && !edited) {
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) close();
    }
  });
  document.body.append(dlg);
  ensureRegion(dlg);
  dlg.showModal();
  const focusTarget = initialFocus ? dlg.querySelector(initialFocus) : dlg.querySelector('[autofocus], .dialog-body input, .dialog-body select, .dialog-body textarea');
  (focusTarget || dlg.querySelector('.dialog-foot .btn.primary') || dlg).focus?.();
  return api;
}

const focusKey = (el) => `${el.tagName}|${el.getAttribute('aria-label') || ''}|${el.textContent.trim()}`;

/**
 * Focus goes back to what opened the dialog. Saving often redraws the page
 * and replaces that button: then the control that looks the same (Collect
 * payment, Edit; the one in the same place first, for rows of alike
 * buttons), else whatever is in its place, else the page itself, rather
 * than the top of the document.
 */
function refocus(opener, scope, at) {
  if (opener.isConnected) return opener.focus({ preventScroll: true });
  if (!scope.isConnected) return;
  const all = [...scope.querySelectorAll(FOCUSABLE)];
  const key = focusKey(opener);
  const same = (el) => el && focusKey(el) === key;
  const next = (same(all[at]) && all[at]) || all.find(same) || (all[at]?.tagName === opener.tagName && all[at]) || scope;
  next.focus({ preventScroll: true });
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
            onClick: () => {
              result = true;
              close();
            },
          },
          confirmLabel,
        ),
      ],
      onClose: () => resolve(result),
      // A destructive choice starts on Cancel: the Enter that chose Delete
      // in a menu, held a moment or pressed twice, must not also confirm it.
      initialFocus: danger ? '.dialog-foot .btn:first-child' : '.dialog-foot .btn:last-child',
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
