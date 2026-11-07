/**
 * Modal dialogs on the native <dialog> element, which already traps focus,
 * makes the page behind it inert and closes on Escape. Focus returns to
 * whatever opened the dialog.
 */
import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { dialogToasts, keepToasts } from './toast.js';

export function openDialog({ title, description = null, body, actions = [], size = 'md', onClose = null, className = '', initialFocus = null, dismissible = true }) {
  const opener = document.activeElement;
  const titleId = uid('dlg-title');
  const descId = description ? uid('dlg-desc') : null;
  const dlg = h(`dialog.dialog.dialog-${size}`, {
    class: className,
    'aria-labelledby': titleId,
    'aria-describedby': descId || undefined,
  });
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    if (dlg.open) dlg.close();
    const toasts = dlg.querySelector(':scope > .toasts');
    if (toasts) keepToasts(toasts);
    dlg.remove();
    onClose?.(result);
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
  };
  const head = h(
    'header.dialog-head',
    h('div', h(`h2#${titleId}.dialog-title`, title), description ? h(`p#${descId}.dialog-desc`, description) : null),
    dismissible ? h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => close(null) }, icon('x', { size: 18 })) : null,
  );
  const footer = actions.length
    ? h(
        'footer.dialog-foot',
        actions.map((a) =>
          h(`button.btn${a.primary ? '.btn-primary' : ''}${a.danger ? '.btn-danger' : ''}`, {
            type: a.submit ? 'submit' : 'button',
            form: a.submit ? a.form : undefined,
            disabled: a.disabled,
            onclick: a.submit ? undefined : async (e) => {
              const btn = e.currentTarget;
              if (a.run) {
                btn.disabled = true;
                try {
                  const r = await a.run();
                  if (r !== false) close(a.value ?? true);
                } finally {
                  if (btn.isConnected) btn.disabled = false;
                }
              } else close(a.value ?? null);
            },
          }, a.label),
        ),
      )
    : null;
  // Toasts and announcements made while the dialog is open live in it: the
  // page behind is inert (see toast.js and announce in dom.js).
  dlg.append(head, h('div.dialog-body', body), footer, dialogToasts(), h('div.sr-only.sr-live', { 'aria-live': 'polite', role: 'status' }));
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (dismissible) close(null);
  });
  dlg.addEventListener('mousedown', (e) => {
    if (e.target === dlg && dismissible) dlg.dataset.backdrop = '1';
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg && dlg.dataset.backdrop === '1' && dismissible) close(null);
    delete dlg.dataset.backdrop;
  });
  document.body.appendChild(dlg);
  dlg.showModal();
  const focusTarget = initialFocus ? dlg.querySelector(initialFocus) : dlg.querySelector('[autofocus], input:not([type=hidden]), textarea, select, .dialog-body button');
  (focusTarget || dlg.querySelector('.dialog-foot .btn-primary') || dlg).focus?.();
  return { el: dlg, close };
}

/** Ask a yes or no question. Resolves to true when confirmed. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    openDialog({
      title,
      size: 'sm',
      body: h('p.dialog-message', message),
      actions: [
        { label: cancelLabel, value: false },
        { label: confirmLabel, primary: !danger, danger, value: true },
      ],
      onClose: (r) => resolve(r === true),
    });
    // Put focus on the safe choice for destructive actions.
    if (danger) document.querySelector('dialog[open] .dialog-foot .btn')?.focus();
  });
}

/** Ask for a single line of text. Resolves to the text, or null. */
export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Save', validate = null }) {
  return new Promise((resolve) => {
    const formId = uid('prompt');
    const inputId = uid('prompt-input');
    const error = h('p.field-error', { role: 'alert' });
    const input = h(`input#${inputId}.input`, { value, placeholder, autocomplete: 'off', required: true });
    let dlg = null;
    const form = h(
      `form#${formId}`,
      {
        onsubmit: (e) => {
          e.preventDefault();
          const v = input.value.trim();
          const problem = validate ? validate(v) : v ? null : 'This cannot be empty';
          if (problem) {
            error.textContent = problem;
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            return;
          }
          resolve(v);
          dlg.close('submitted');
        },
      },
      h('label.field-label', { for: inputId }, label),
      input,
      error,
    );
    dlg = openDialog({
      title,
      size: 'sm',
      body: form,
      actions: [{ label: 'Cancel', value: null }, { label: confirmLabel, primary: true, submit: true, form: formId }],
      onClose: (r) => {
        if (r !== 'submitted') resolve(null);
      },
    });
    input.select();
  });
}
