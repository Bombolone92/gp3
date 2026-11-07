/** Building blocks shared by the admin sections. */
import { h, clear, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast, toastError } from '../ui/toast.js';
import { guardLeave } from '../ui/router.js';

/** Section heading with a short description and optional actions. */
export function sectionHead(title, description, ...actions) {
  return h('header.admin-head',
    h('div.admin-head-text', h('h1#admin-title', title), description ? h('p.admin-desc', description) : null),
    actions.length ? h('div.admin-head-actions', actions) : null);
}

/** A titled group of settings. */
export function panel(title, description, ...body) {
  const id = uid('panel');
  return h('section.admin-panel', { 'aria-labelledby': id },
    title ? h('div.admin-panel-head', h(`h2#${id}`, title), description ? h('p.admin-panel-desc', description) : null) : null,
    h('div.admin-panel-body', body));
}

/** A row with a label and description on the left and a control on the right. */
export function settingRow({ label, description = '', control, id = null }) {
  return h('div.setting-row',
    h('div.setting-text', h(id ? 'label.setting-label' : 'span.setting-label', id ? { for: id } : {}, label), description ? h('p.setting-desc', description) : null),
    h('div.setting-control', control));
}

/** An accessible on/off switch. */
export function toggle({ id = uid('sw'), checked = false, onChange, label = null, disabled = false }) {
  const input = h(`input#${id}.switch`, { type: 'checkbox', role: 'switch', checked, disabled, 'aria-label': label || undefined, onchange: (e) => onChange?.(e.target.checked) });
  return input;
}

/**
 * Save bar for forms that collect edits: shows when there are unsaved
 * changes, with Discard and Save. `getPatch()` returns the changes or null.
 */
export function saveBar({ getPatch, onSave, onDiscard }) {
  const status = h('span.save-status', { role: 'status', 'aria-live': 'polite' });
  const discard = h('button.btn', { type: 'button', onclick: () => onDiscard() }, 'Discard');
  const save = h('button.btn.btn-primary', { type: 'submit' }, 'Save changes');
  const bar = h('div.save-bar', status, h('span.spacer'), discard, save);
  let busy = false;
  const api = {
    el: bar,
    refresh() {
      const patch = getPatch();
      const dirty = !!patch && Object.keys(patch).length > 0;
      bar.classList.toggle('dirty', dirty);
      discard.disabled = !dirty || busy;
      save.disabled = !dirty || busy;
      if (!busy) status.textContent = dirty ? 'You have unsaved changes' : '';
      return dirty;
    },
    async submit() {
      const patch = getPatch();
      if (!patch || !Object.keys(patch).length || busy) return;
      busy = true;
      save.textContent = 'Saving';
      api.refresh();
      try {
        await onSave(patch);
        toast('Settings saved.', { kind: 'success' });
        status.textContent = 'Saved';
      } catch (e) {
        toastError(e);
      } finally {
        busy = false;
        save.textContent = 'Save changes';
        api.refresh();
      }
    },
  };
  return api;
}

/**
 * Warn before leaving a section with unsaved edits: closing or reloading
 * the page, and moving elsewhere in the app (links, Back, shortcuts).
 */
export function guardUnsaved(isDirty) {
  const onBefore = (e) => {
    if (isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', onBefore);
  const unguard = guardLeave(isDirty);
  return () => {
    window.removeEventListener('beforeunload', onBefore);
    unguard();
  };
}

export function copyText(text, what = 'Link') {
  const done = () => toast(`${what} copied.`, { kind: 'success' });
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  }
  fallbackCopy(text, done);
  return Promise.resolve();
}

function fallbackCopy(text, done) {
  const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
  document.body.append(ta);
  ta.select();
  try {
    document.execCommand('copy');
    done();
  } catch {
    toastError({ message: 'Copy did not work. Select the text and copy it yourself.' });
  }
  ta.remove();
}

/** A read-only field with copy (and optional open) buttons. */
export function copyField(value, { label = 'Link', open = false } = {}) {
  const id = uid('copy');
  const input = h(`input#${id}.input.copy-input`, { value, readonly: true, 'aria-label': label, onfocus: (e) => e.target.select() });
  return h('div.copy-field', input,
    h('button.btn', { type: 'button', onclick: () => copyText(value, label) }, icon('copy', { size: 14 }), 'Copy'),
    open ? h('button.btn', { type: 'button', onclick: () => window.open(value, '_blank', 'noopener') }, icon('external-link', { size: 14 }), 'Open') : null);
}

export function callout(kind, iconName, ...content) {
  return h(`div.callout.callout-${kind}`, icon(iconName, { size: 16 }), h('div.callout-body', content));
}

export function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export { h, clear, uid, icon };
