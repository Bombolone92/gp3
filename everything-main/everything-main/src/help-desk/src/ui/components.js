/**
 * Small reusable pieces: avatars, status and priority badges, select-like
 * fields backed by the picker, a tag input, and empty states.
 */
import { h, uid, clear, composing } from './dom.js';
import { icon } from './icons.js';
import { openPicker } from './popover.js';
import { initials, STATUS_LABEL, PRIORITY_LABEL, normTag } from '../shared/model.js';
import { profilePicture } from '../client/puter.js';

/** Initials avatar; for Puter users, the profile picture when available. */
export function avatar(name, { size = '', username = null, agent = false, title = null } = {}) {
  const el = h(`span.avatar${size ? `.${size}` : ''}${agent ? '.agent' : ''}`, { 'aria-hidden': 'true', title: title || undefined }, initials(name));
  if (username !== null) {
    profilePicture(username || undefined).then((pic) => {
      if (pic && el.isConnected !== false) {
        clear(el);
        el.append(h('img', { src: pic, alt: '' }));
      }
    });
  }
  return el;
}

export function statusBadge(status, { compact = false } = {}) {
  const label = STATUS_LABEL[status] || status;
  return h(`span.badge.status.${status}${compact ? '.compact' : ''}`, { title: label }, compact ? label[0] : label);
}

const PRI_ICON = { urgent: 'arrow-up', high: 'arrow-up', low: 'arrow-down' };
export function priorityLabel(p) {
  if (!p) return h('span.subtle', '-');
  return h(`span.pri.${p}`, PRI_ICON[p] ? icon(PRI_ICON[p], { size: 13 }) : null, PRIORITY_LABEL[p]);
}

export function emptyState({ glyph = 'inbox', title, text = '', action = null }) {
  return h('div.empty', h('div.empty-icon', icon(glyph, { size: 22 })), h('h2', title), text ? h('p', text) : null, action);
}

/**
 * A button that shows a value and opens a picker. `options` may be a
 * function so it is computed when opened.
 */
export function selectField({ id = uid('sel'), value, options, onChange, placeholder = 'Choose', label = 'Choose', disabled = false, search = true, render = null, describedBy = null }) {
  let current = value;
  const valueEl = h('span.value');
  const btn = h('button.select-btn', {
    id, type: 'button', disabled, 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-describedby': describedBy || undefined,
    onclick: () => {
      const opts = typeof options === 'function' ? options() : options;
      openPicker(btn, {
        options: opts, value: current, label, search: search && opts.length > 7,
        onPick: (v, o) => {
          if (v === current) return;
          const prev = current;
          current = v;
          paint();
          onChange?.(v, o, prev);
        },
      });
    },
    onkeydown: (e) => {
      if (e.key === 'ArrowDown' && !e.altKey) {
        e.preventDefault();
        btn.click();
      }
    },
  }, valueEl, icon('chevron-down', { size: 16 }));
  function paint() {
    clear(valueEl);
    const opts = typeof options === 'function' ? options() : options;
    const o = opts.find((x) => x.value === current);
    if (render && o) valueEl.append(render(o));
    else if (o) valueEl.append(o.icon || '', o.label);
    else valueEl.append(h('span.placeholder', placeholder));
  }
  paint();
  btn.setValue = (v) => {
    current = v;
    paint();
  };
  btn.getValue = () => current;
  btn.repaint = paint;
  return btn;
}

/**
 * Free-form tags with suggestions. Enter, comma or space adds a tag;
 * Backspace on an empty input removes the last one.
 */
export function tagsInput({ id = uid('tags'), value = [], onChange, suggestions = () => [], label = 'Tags', normalize = normTag, placeholder = '' }) {
  let tags = [...value];
  const input = h('input', { id, type: 'text', autocomplete: 'off', placeholder: tags.length ? '' : placeholder, 'aria-label': label, list: undefined });
  const listId = uid('tag-sugg');
  const datalist = h(`datalist#${listId}`);
  input.setAttribute('list', listId);
  const box = h('div.tags-input', { onclick: (e) => { if (e.target === box) input.focus(); } });
  function paint() {
    clear(box);
    for (const t of tags) {
      box.append(h('span.chip', h('span.ellipsis', t), h('button', { type: 'button', 'aria-label': `Remove tag ${t}`, onclick: (e) => { e.stopPropagation(); removeTag(t); } }, icon('x', { size: 12 }))));
    }
    input.placeholder = tags.length ? '' : placeholder;
    box.append(input, datalist);
  }
  function refreshSuggestions() {
    clear(datalist);
    for (const s of suggestions().filter((s) => !tags.includes(s)).slice(0, 50)) datalist.append(h('option', { value: s }));
  }
  function addFromInput() {
    const parts = input.value.split(/[\s,]+/).map(normalize).filter(Boolean);
    input.value = '';
    let changed = false;
    for (const p of parts) {
      if (!tags.includes(p)) {
        tags.push(p);
        changed = true;
      }
    }
    if (changed) {
      paint();
      input.focus();
      onChange?.([...tags]);
    }
  }
  function removeTag(t) {
    tags = tags.filter((x) => x !== t);
    paint();
    input.focus();
    onChange?.([...tags]);
  }
  input.addEventListener('focus', refreshSuggestions);
  input.addEventListener('keydown', (e) => {
    if (composing(e)) return;
    if (e.key === 'Enter' || e.key === ',' || (e.key === ' ' && input.value.trim())) {
      if (input.value.trim()) {
        e.preventDefault();
        addFromInput();
      }
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      removeTag(tags[tags.length - 1]);
    }
  });
  input.addEventListener('change', () => {
    if (input.value.trim()) addFromInput();
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) addFromInput();
  });
  paint();
  box.setValue = (v) => {
    tags = [...v];
    paint();
  };
  box.getValue = () => [...tags];
  return box;
}

/** A labelled form field wrapper. */
export function field(labelText, control, { hint = null, error = null, action = null, id = null } = {}) {
  const forId = id || control.id || (control.querySelector && control.querySelector('input,textarea,button')?.id);
  return h(
    'div.field',
    h('label.field-label', { for: forId || undefined }, labelText, action),
    control,
    hint ? h('p.field-hint', hint) : null,
    error,
  );
}

export function spinner(label = 'Loading') {
  return h('div.spinner', { role: 'status', 'aria-label': label });
}

/** Keyboard key hints for menus and tooltips. */
export function kbd(text) {
  return h('kbd', text);
}
