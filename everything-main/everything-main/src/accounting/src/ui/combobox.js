/**
 * A searchable select (WAI-ARIA combobox with a listbox popup), used for
 * accounts, customers, vendors, items, and tax rates. Typing filters; arrows
 * move; Enter picks; Escape reverts; leaving the field with text that is not
 * an option puts the previous choice back, so a half-typed name never saves.
 * "Add new" hands the typed text to a creator and selects what it returns.
 * `labelOf(id)` names a value that is not among the options (an inactive
 * account or contact on an old transaction), so it shows and is kept.
 */
import { el, nextId } from './dom.js';
import { icon } from './icons.js';
import { place } from './menu.js';

const MAX_RENDER = 150;

function rank(label, q) {
  const l = label.toLowerCase();
  if (l === q) return 0;
  if (l.startsWith(q)) return 1;
  if (l.split(/[\s:/(-]+/).some((w) => w.startsWith(q))) return 2;
  if (l.includes(q)) return 3;
  return -1;
}

/**
 * options(): [{ id, label, sub?, group? }]
 */
export function combobox({ value = null, options, placeholder = 'Select', onChange, onAddNew = null, addNewLabel = 'Add new', ariaLabel, id = nextId('combo'), invalid = false, disabled = false, clearable = true, labelOf = null } = {}) {
  let current = value;
  let items = [];
  let filtered = [];
  let active = -1;
  let listEl = null;
  const listId = `${id}-list`;

  const labelFor = (v) => (v ? options().find((o) => o.id === v)?.label || labelOf?.(v) || '' : '');

  const input = el('input.input', {
    id, type: 'text', role: 'combobox', autocomplete: 'off', spellcheck: false,
    'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId,
    'aria-label': ariaLabel || null, 'aria-invalid': invalid ? 'true' : null,
    placeholder, value: labelFor(current), disabled,
  });
  const toggle = el('button.combo-toggle', { type: 'button', tabIndex: -1, 'aria-label': `Show options`, html: icon('chevDown', 16), disabled });
  const root = el('div.combo', {}, input, toggle);

  function build(query) {
    items = options();
    const q = query.trim().toLowerCase();
    if (!q) filtered = items.slice();
    else {
      filtered = items.map((o) => [o, rank(o.label, q)]).filter(([, r]) => r >= 0).sort((a, b) => a[1] - b[1]).map(([o]) => o);
      // Keep groups together after ranking when grouping matters.
      if (filtered.some((o) => o.group)) {
        const order = [...new Set(items.map((o) => o.group))];
        filtered.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
      }
    }
    if (onAddNew && q && !items.some((o) => o.label.toLowerCase() === q)) filtered.unshift({ id: '__add__', label: `+ ${addNewLabel}: "${query.trim()}"`, add: query.trim() });
    else if (onAddNew && !q) filtered.unshift({ id: '__add__', label: `+ ${addNewLabel}`, add: '' });
    if (clearable && current && !q) filtered.splice(onAddNew ? 1 : 0, 0, { id: '__clear__', label: 'Clear selection', clear: true });
  }

  function render() {
    if (!listEl) return;
    listEl.replaceChildren();
    let lastGroup = null;
    const shown = filtered.slice(0, MAX_RENDER);
    shown.forEach((o, i) => {
      if (o.group && o.group !== lastGroup && !o.add && !o.clear) {
        listEl.append(el('div.combo-group', { role: 'presentation' }, o.group));
        lastGroup = o.group;
      }
      const opt = el('div.combo-option', {
        id: `${id}-opt-${i}`, role: 'option', 'aria-selected': String(i === active),
        class: o.add ? 'add-new' : o.clear ? 'muted' : '',
      },
      el('span.truncate', {}, o.label),
      o.sub && el('span.opt-sub', {}, o.sub));
      opt.addEventListener('mousedown', (e) => { e.preventDefault(); choose(o); });
      opt.addEventListener('mousemove', () => { if (active !== i) { active = i; highlight(); } });
      listEl.append(opt);
    });
    if (filtered.length > MAX_RENDER) listEl.append(el('div.combo-empty', {}, `${filtered.length - MAX_RENDER} more. Keep typing to narrow the list.`));
    if (!filtered.length) listEl.append(el('div.combo-empty', {}, 'No matches'));
    highlight();
  }

  function highlight() {
    if (!listEl) return;
    const opts = listEl.querySelectorAll('.combo-option');
    opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === active)));
    const a = opts[active];
    if (a) {
      input.setAttribute('aria-activedescendant', a.id);
      a.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function openList(query = '') {
    if (disabled) return;
    if (!listEl) {
      listEl = el('div.combo-list', { id: listId, role: 'listbox', 'aria-label': ariaLabel || placeholder });
      document.body.append(listEl);
      input.setAttribute('aria-expanded', 'true');
      document.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);
    }
    build(query);
    active = query ? filtered.findIndex((o) => !o.add && !o.clear) : filtered.findIndex((o) => o.id === current);
    if (active < 0 && filtered.length) active = query ? 0 : -1;
    render();
    reposition();
  }

  function reposition() {
    if (listEl) {
      listEl.style.width = `${Math.max(root.offsetWidth, 260)}px`;
      place(listEl, root, { gap: 2 });
    }
  }

  function closeList() {
    if (!listEl) return;
    listEl.remove();
    listEl = null;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    document.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
  }

  async function choose(o) {
    closeList();
    if (o.clear) { set(null, true); return; }
    if (o.add !== undefined) {
      const created = await onAddNew(o.add);
      if (created) set(created, true);
      else input.value = labelFor(current);
      input.focus();
      return;
    }
    set(o.id, true);
  }

  function set(v, fire) {
    const changed = v !== current;
    current = v;
    input.value = labelFor(v);
    if (fire && changed) onChange?.(v);
  }

  input.addEventListener('focus', () => input.select());
  input.addEventListener('click', () => { if (!listEl) openList(''); });
  input.addEventListener('input', () => openList(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!listEl) { openList(''); return; }
      const n = Math.min(filtered.length, MAX_RENDER);
      if (!n) return;
      active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
      highlight();
    } else if (e.key === 'Enter') {
      if (listEl && active >= 0 && filtered[active]) {
        e.preventDefault();
        choose(filtered[active]);
      }
    } else if (e.key === 'Escape') {
      if (listEl) {
        e.preventDefault();
        e.stopPropagation();
        closeList();
        input.value = labelFor(current);
      }
    } else if (e.key === 'Tab') {
      if (listEl && input.value.trim() && active >= 0 && filtered[active] && !filtered[active].add && !filtered[active].clear) choose(filtered[active]);
      else closeList();
    }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement === input) return;
      closeList();
      const text = input.value.trim();
      if (!text) {
        if (clearable) set(null, true);
        else input.value = labelFor(current);
        return;
      }
      // The current choice wins over another option with the same name (a
      // customer and a vendor can both be "Acme").
      if (current && labelFor(current).toLowerCase() === text.toLowerCase()) { input.value = labelFor(current); return; }
      const exact = options().find((o) => o.label.toLowerCase() === text.toLowerCase());
      if (exact) set(exact.id, true);
      else input.value = labelFor(current);
    }, 120);
  });
  toggle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (listEl) closeList();
    else { input.focus(); openList(''); }
  });

  return {
    root,
    input,
    get value() { return current; },
    set value(v) { set(v, false); },
    refresh() { input.value = labelFor(current); },
    focus() { input.focus(); },
    setInvalid(b) { if (b) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); },
  };
}
