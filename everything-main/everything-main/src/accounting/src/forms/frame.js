/**
 * The full-screen transaction form: a header with the title and close, a
 * scrolling sheet, and a footer with Cancel, More, Print, Make recurring on
 * the left and Save / Save and close (with Save and new) on the right.
 * Closing with unsaved changes asks first. `onAddLine` serves the Add a
 * line shortcut on forms with line items.
 */
import { el, nextId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu } from '../ui/menu.js';
import { confirmDialog, pushLayer, popLayer, focusables } from '../ui/dialog.js';
import { pushFormShortcuts, shortcutLabel } from '../ui/shortcuts.js';
import { toastError } from '../ui/toast.js';

export function openFrame({
  title,
  body,
  onSave,
  isDirty = () => false,
  more = [],
  onPrint = null,
  onRecurring = null,
  history = null,
  saveNewLabel = 'Save and new',
  hideSaveNew = false,
  primaryLabel = 'Save and close',
  readOnly = false,
  afterClose = null,
  onAddLine = null,
}) {
  const opener = document.activeElement;
  const titleId = nextId('form-title');
  const titleEl = el('h1.form-title', { id: titleId, tabIndex: -1 }, title);
  const closeBtn = el('button.icon-btn', { type: 'button', 'aria-label': 'Close', title: 'Close', html: icon('x', 22) });
  const historyBtn = history ? el('button.icon-btn', { type: 'button', 'aria-label': 'Recent transactions', title: 'Recent transactions', 'aria-haspopup': 'menu', 'aria-expanded': 'false', html: icon('history', 20) }) : null;
  historyBtn?.addEventListener('click', () => openMenu(historyBtn, history(), { label: 'Recent transactions' }));
  const head = el('header.form-head', {}, historyBtn, titleEl, el('div.spacer'), closeBtn);
  const scroller = el('div.form-body', {}, body);
  const errors = el('div.form-errors', { role: 'alert', hidden: true });

  const moreBtn = more.length ? el('button.btn.btn-ghost', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, 'More', el('span', { html: icon('chevUp', 16) })) : null;
  moreBtn?.addEventListener('click', () => openMenu(moreBtn, more.map((m) => (m === 'sep' ? m : { ...m, onClick: () => run(m.onClick) })), { label: 'More actions' }));
  const printBtn = onPrint ? el('button.btn.btn-ghost.hide-mobile', { type: 'button', onclick: () => onPrint() }, 'Print or download') : null;
  const recurBtn = onRecurring ? el('button.btn.btn-ghost.hide-mobile', { type: 'button', onclick: () => onRecurring() }, 'Make recurring') : null;

  const saveBtn = el('button.btn', { type: 'button' }, 'Save');
  const primary = el('button.btn.btn-primary', { type: 'button' }, primaryLabel);
  const caret = el('button.btn.btn-primary', { type: 'button', 'aria-label': 'More save options', 'aria-haspopup': 'menu', 'aria-expanded': 'false', html: icon('chevUp', 16) });
  caret.addEventListener('click', () => openMenu(caret, [
    { label: primaryLabel, kbd: shortcutLabel('saveClose'), onClick: () => save('close') },
    !hideSaveNew && { label: saveNewLabel, kbd: shortcutLabel('saveNew'), onClick: () => save('new') },
  ], { align: 'end', label: 'Save options' }));
  saveBtn.addEventListener('click', () => save('stay'));
  primary.addEventListener('click', () => save('close'));

  const cancel = el('button.btn.btn-ghost', { type: 'button' }, readOnly ? 'Close' : 'Cancel');
  cancel.addEventListener('click', () => requestClose());
  const foot = el('footer.form-foot', {},
    cancel, moreBtn, printBtn, recurBtn,
    el('div.spacer'),
    readOnly ? null : saveBtn,
    readOnly ? null : el('div.split', {}, primary, caret));

  const root = el('div.form-overlay', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, head, errors, scroller, foot);
  document.body.append(root);
  document.body.classList.add('has-form');

  let closed = false;
  let busy = false;
  const layer = { root, requestClose: () => requestClose(), close: () => close() };
  pushLayer(layer);
  const unshortcut = pushFormShortcuts({
    layer,
    saveNew: () => { if (!readOnly && !hideSaveNew) save('new'); },
    saveClose: () => { if (!readOnly) save('close'); },
    print: () => onPrint?.(),
    addLine: onAddLine && !readOnly ? () => onAddLine() : null,
  });

  async function run(fn) {
    try {
      const r = await fn();
      if (r === 'close') close();
    } catch (err) {
      toastError(err);
    }
  }

  function showErrors(list) {
    errors.replaceChildren();
    if (!list?.length) { errors.hidden = true; return; }
    errors.hidden = false;
    errors.append(el('span', { html: icon('alert', 18) }), el('div', {},
      list.length === 1 ? el('p', {}, list[0]) : [el('p', {}, 'Fix these to save:'), el('ul', {}, list.map((m) => el('li', {}, m)))]));
    errors.scrollIntoView?.({ block: 'nearest' });
  }

  async function save(mode) {
    if (busy || readOnly) return;
    busy = true;
    // Let a field that is being edited commit its value first.
    const focused = document.activeElement;
    focused?.blur?.();
    await new Promise((r) => setTimeout(r, 140));
    try {
      showErrors(null);
      const ok = await onSave(mode);
      if (ok === false) return;
      if (mode === 'close') close();
    } catch (err) {
      showErrors(err.errors || [err.message || String(err)]);
      // Keep the keyboard in the form: back to where the user was.
      if (!closed) (focused && root.contains(focused) ? focused : titleEl).focus({ preventScroll: true });
    } finally {
      busy = false;
    }
  }

  /** Close, asking first about unsaved changes. Resolves whether it closed. */
  async function requestClose() {
    if (!readOnly && isDirty()) {
      const ok = await confirmDialog({ title: 'Discard changes?', message: 'You have unsaved changes. Leave without saving?', confirmLabel: 'Discard', danger: true });
      if (!ok) return false;
    }
    close();
    return true;
  }

  closeBtn.addEventListener('click', () => requestClose());

  function close() {
    if (closed) return;
    closed = true;
    unshortcut();
    popLayer(layer);
    root.remove();
    if (!document.querySelector('.form-overlay')) document.body.classList.remove('has-form');
    afterClose?.();
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  }

  requestAnimationFrame(() => {
    const first = focusables(scroller).find((n) => n.matches('input, select, textarea'));
    (first || titleEl).focus();
  });

  return {
    root,
    body: scroller,
    close,
    requestClose,
    setTitle(t) { titleEl.textContent = t; },
    showErrors,
    replaceBody(node) { scroller.replaceChildren(node); },
  };
}
