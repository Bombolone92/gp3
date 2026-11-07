/**
 * Modal dialogs and side drawers with a focus trap, Escape to close, focus
 * restored to the opener, and a stack so a confirm can sit on a form.
 */
import { el, nextId } from './dom.js';
import { icon } from './icons.js';

const stack = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
}

export function trapFocus(root, e) {
  if (e.key !== 'Tab') return;
  const list = focusables(root);
  if (!list.length) { e.preventDefault(); return; }
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
    e.preventDefault();
    first.focus();
  }
}

/** Is a modal layer (dialog, drawer, or form overlay) open? */
export function topLayer() {
  return stack[stack.length - 1] || null;
}

export function pushLayer(layer) {
  stack.push(layer);
}

export function popLayer(layer) {
  const i = stack.indexOf(layer);
  if (i >= 0) stack.splice(i, 1);
}

document.addEventListener('keydown', (e) => {
  const top = topLayer();
  if (!top) return;
  if (e.key === 'Escape' && !e.defaultPrevented) {
    if (document.querySelector('.menu, .combo-list')) return; // let the open popup close first
    e.preventDefault();
    top.requestClose();
  } else if (e.key === 'Tab' && top.root) {
    trapFocus(top.root, e);
  }
}, true);

/**
 * openDialog({ title, body, footer, wide, drawer, onClose, initialFocus, closeLabel })
 * `body` and `footer` are nodes (or arrays). Returns { close, root, body }.
 * `beforeClose()` may return false to keep it open (unsaved changes).
 */
export function openDialog({ title, body, footer, wide = false, size = null, drawer = false, onClose, beforeClose, initialFocus, describedBy } = {}) {
  const opener = document.activeElement;
  const titleId = nextId('dlg-title');
  const bodyNode = el('div.dialog-body', {}, body);
  const panel = el(`div.${drawer ? 'drawer' : 'dialog'}${wide ? '.wide' : ''}${size ? `.${size}` : ''}`, {
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': describedBy || null,
  },
  el('div.dialog-head', {},
    el('h2.dialog-title', { id: titleId }, title),
    el('button.icon-btn', { type: 'button', 'aria-label': 'Close', html: icon('x', 20), onclick: () => layer.requestClose() })),
  bodyNode,
  footer && el('div.dialog-foot', {}, footer));

  const backdrop = el(`div.${drawer ? 'drawer-backdrop' : 'dialog-backdrop'}`);
  let root;
  if (drawer) {
    root = el('div', {}, backdrop, panel);
    backdrop.addEventListener('mousedown', () => layer.requestClose());
  } else {
    backdrop.append(panel);
    root = backdrop;
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) layer.requestClose(); });
  }

  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    popLayer(layer);
    root.remove();
    onClose?.(result);
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  };
  const layer = {
    root: panel,
    requestClose: async () => {
      if (beforeClose && (await beforeClose()) === false) return;
      close();
    },
    close,
  };
  pushLayer(layer);
  document.body.append(root);
  requestAnimationFrame(() => {
    const target = (typeof initialFocus === 'string' ? panel.querySelector(initialFocus) : initialFocus) || focusables(bodyNode)[0] || panel.querySelector('.icon-btn');
    target?.focus();
  });
  return { close, root: panel, body: bodyNode, layer };
}

/** A yes/no question. Resolves true when confirmed. */
export function confirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, extra = null } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const ok = el(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, { type: 'button', onclick: () => { result = true; dlg.close(); } }, confirmLabel);
    const dlg = openDialog({
      title,
      body: [el('p', {}, message), extra],
      footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, cancelLabel), ok),
      onClose: () => resolve(result),
      initialFocus: ok,
    });
  });
}

/** Ask for one line of text. Resolves the string or null. */
export function promptDialog({ title, label, value = '', confirmLabel = 'Save', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const input = el('input.input', { value, placeholder, 'aria-label': label });
    const submit = () => { result = input.value; dlg.close(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    const dlg = openDialog({
      title,
      body: el('label.field', {}, el('span.field-label', {}, label), input),
      footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'button', onclick: submit }, confirmLabel)),
      onClose: () => resolve(result),
      initialFocus: input,
    });
  });
}
