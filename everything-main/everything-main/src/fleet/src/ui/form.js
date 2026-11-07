/**
 * Declarative forms. A form is a list of sections, each with fields:
 *
 *   { id, label, type, required, hint, placeholder, options, span, unit,
 *     min, max, step, show(values), get(record), set(values, value), render }
 *
 * Types: text, textarea, number, money, date, time, select, picker (a
 * searchable select over records), multipicker, checkbox, switch, tags,
 * custom (render(values, api) -> node with .value).
 *
 * buildForm() returns { node, values(), validate(), dirty(), set(id, v),
 * focusFirstError() }. formPage() wraps it in a page with a section index
 * on wide screens and Save / Cancel actions (Ctrl+S saves).
 */
import { h, uniqueId } from './dom.js';
import { icon } from './icons.js';
import { openPopover } from './menu.js';
import { openDialog, confirmDialog } from './dialog.js';
import { centsToInput, parseMoney, parseDecimal } from '../core/money.js';
import { matches } from '../core/format.js';

// Scripted smooth scrolling ignores the CSS reduced-motion override.
const scrollMotion = () => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

// ---- Searchable picker -----------------------------------------------------------

/**
 * A select-like button that opens a searchable list.
 * items(): [{ value, label, sub?, icon?, group? }]
 */
export function picker({ items, value = null, onChange, placeholder = 'Select', label, allowClear = true, create = null, id = uniqueId('pk'), invalid = false }) {
  let current = value;
  const btn = h('button.picker-btn.input', { type: 'button', id, 'aria-haspopup': 'listbox', 'aria-label': label || null, 'aria-invalid': invalid ? 'true' : null });
  const wrap = h('div.picker', btn);

  function itemFor(v) {
    return v === null || v === undefined || v === '' ? null : items().find((it) => String(it.value) === String(v)) || null;
  }

  function drawButton() {
    const it = itemFor(current);
    btn.replaceChildren(
      it ? h('span.picker-value.truncate', it.label, it.sub ? h('span.picker-sub', it.sub) : null) : h('span.picker-placeholder.truncate', placeholder),
      icon('chevron-down', 16),
    );
    if (label) btn.setAttribute('aria-label', `${label}: ${it ? it.label : 'none selected'}`);
  }

  function open(initial = '') {
    const listId = uniqueId('lb');
    const input = h('input.input.sm', { type: 'search', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': listId, 'aria-autocomplete': 'list', placeholder: 'Search', 'aria-label': `Search ${label || 'options'}`, autocomplete: 'off' });
    const list = h('ul.picker-list', { id: listId, role: 'listbox', 'aria-label': label || 'Options' });
    let opts = [];
    let active = 0;
    const pop = openPopover(
      btn,
      () => h('div.picker-pop', h('div.input-affix', icon('search', 15), input), list),
      { label: label || 'Choose', width: Math.max(260, btn.offsetWidth), onClose: () => btn.focus() },
    );
    function setActive(i) {
      opts[active]?.node.setAttribute('aria-selected', 'false');
      active = Math.max(0, Math.min(opts.length - 1, i));
      const o = opts[active];
      if (!o) return input.removeAttribute('aria-activedescendant');
      o.node.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', o.node.id);
      o.node.scrollIntoView({ block: 'nearest' });
    }
    function choose(o) {
      pop.close();
      if (o.create) {
        create.run(input.value, (v) => {
          current = v;
          drawButton();
          onChange?.(v);
        });
        return;
      }
      current = o.value;
      drawButton();
      onChange?.(o.value);
    }
    function draw() {
      const q = input.value;
      const all = items();
      const shown = all.filter((it) => !q || matches(`${it.label} ${it.sub || ''} ${it.search || ''}`, q)).slice(0, 200);
      list.replaceChildren();
      opts = [];
      if (allowClear && current !== null && current !== '' && current !== undefined && !q) shown.unshift({ value: null, label: 'None', clear: true });
      let lastGroup = null;
      for (const it of shown) {
        if (it.group && it.group !== lastGroup) {
          lastGroup = it.group;
          list.append(h('li.picker-group', { role: 'presentation' }, it.group));
        }
        const node = h(
          `li.picker-option${it.clear ? '.muted' : ''}`,
          { role: 'option', id: uniqueId('opt'), 'aria-selected': 'false', 'data-current': String(String(it.value) === String(current)) },
          it.icon ? icon(it.icon, 16) : null,
          h('span.grow.truncate', it.label, it.sub ? h('span.picker-sub', it.sub) : null),
          String(it.value) === String(current) && !it.clear ? icon('check', 15) : null,
        );
        node.addEventListener('mousedown', (e) => e.preventDefault());
        const o = { ...it, node };
        node.addEventListener('click', () => choose(o));
        opts.push(o);
        list.append(node);
      }
      if (create) {
        const node = h('li.picker-option.picker-create', { role: 'option', id: uniqueId('opt'), 'aria-selected': 'false' }, icon('plus', 16), h('span', create.label(q)));
        node.addEventListener('mousedown', (e) => e.preventDefault());
        const o = { create: true, node };
        node.addEventListener('click', () => choose(o));
        opts.push(o);
        list.append(node);
      }
      if (!opts.length) list.append(h('li.picker-empty', 'No matches'));
      const idx = opts.findIndex((o) => String(o.value) === String(current) && !o.clear);
      setActive(q ? 0 : Math.max(0, idx));
    }
    input.value = initial;
    input.addEventListener('input', draw);
    input.addEventListener('keydown', (e) => {
      // Keys that drive an IME (Japanese, Chinese, Korean) belong to it.
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(active + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(active - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (opts[active]) choose(opts[active]);
      } else if (e.key === 'Tab') {
        pop.close();
      }
    });
    draw();
    input.focus();
  }

  btn.addEventListener('click', () => open());
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      open();
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Typing on the closed picker starts a search with that character.
      e.preventDefault();
      open(e.key);
    }
  });
  drawButton();
  Object.defineProperty(wrap, 'value', {
    get: () => current,
    set: (v) => {
      current = v;
      drawButton();
    },
  });
  wrap.refresh = drawButton;
  wrap.button = btn;
  return wrap;
}

/** Multi-select as removable tags plus a picker to add more. */
export function multiPicker({ items, value = [], onChange, placeholder = 'Add', label, id = uniqueId('mp') }) {
  let current = [...(value || [])];
  const tags = h('div.tags.multi-tags');
  const add = picker({
    id,
    label,
    placeholder,
    allowClear: false,
    items: () => items().filter((it) => !current.includes(it.value)),
    onChange: (v) => {
      if (v === null) return;
      current = [...current, v];
      add.value = null;
      draw();
      onChange?.(current);
    },
  });
  function draw() {
    const all = items();
    tags.replaceChildren(
      ...current.map((v) => {
        const it = all.find((x) => String(x.value) === String(v));
        return h(
          'span.tag',
          it ? it.label : String(v),
          // The removed tag took focus with it; move on to the add button.
          h('button', { type: 'button', 'aria-label': `Remove ${it ? it.label : v}`, onClick: () => ((current = current.filter((x) => x !== v)), draw(), add.button.focus(), onChange?.(current)) }, icon('x', 12)),
        );
      }),
    );
  }
  draw();
  const wrap = h('div.multi-picker', tags, add);
  // The add button is the control: the field's label, hint and error point at it.
  wrap.button = add.button;
  Object.defineProperty(wrap, 'value', {
    get: () => current,
    set: (v) => {
      current = [...(v || [])];
      draw();
    },
  });
  return wrap;
}

/** Free-form tags (labels): type and press Enter or comma. */
export function tagInput({ value = [], suggestions = () => [], label, id = uniqueId('tg') }) {
  let current = [...(value || [])];
  const listId = uniqueId('dl');
  const input = h('input.input.tag-entry', { id, type: 'text', placeholder: 'Add a label', 'aria-label': label || 'Labels', list: listId, autocomplete: 'off' });
  const datalist = h('datalist', { id: listId });
  const tags = h('div.tags');
  function draw() {
    tags.replaceChildren(...current.map((t) => h('span.tag', t, h('button', { type: 'button', 'aria-label': `Remove ${t}`, onClick: () => ((current = current.filter((x) => x !== t)), draw(), input.focus()) }, icon('x', 12)))));
    datalist.replaceChildren(...suggestions().filter((s) => !current.includes(s)).map((s) => h('option', { value: s })));
  }
  const pending = () => input.value.replace(/,/g, ' ').trim();
  function commit() {
    const v = pending();
    if (v && !current.includes(v)) current.push(v);
    input.value = '';
    draw();
  }
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input.value && current.length) {
      current.pop();
      draw();
    }
  });
  input.addEventListener('change', commit);
  draw();
  const wrap = h('div.tag-input', tags, input, datalist);
  // The text box is the control: the field's label, hint and error point at it.
  wrap.input = input;
  Object.defineProperty(wrap, 'value', {
    // Reading the value (the form does on every keystroke) must not commit
    // a half-typed label; it is included as if committed.
    get: () => {
      const v = pending();
      return v && !current.includes(v) ? [...current, v] : current;
    },
    set: (v) => {
      current = [...(v || [])];
      draw();
    },
  });
  return wrap;
}

// ---- Fields ---------------------------------------------------------------------------

function control(f, v, onInput) {
  const id = uniqueId('f');
  const common = { id, name: f.id };
  let node;
  switch (f.type) {
    case 'textarea':
      node = h('textarea.textarea', { ...common, rows: f.rows || 3, placeholder: f.placeholder || '' });
      node.value = v ?? '';
      break;
    case 'number': {
      // Phone number pads have no minus key, so a field that takes negatives
      // keeps the full keyboard.
      const negative = f.min === undefined || f.min === null || f.min < 0;
      const inputmode = negative ? null : f.step && String(f.step).includes('.') ? 'decimal' : 'numeric';
      node = h('input.input.num', { ...common, type: 'text', inputmode, placeholder: f.placeholder || '', autocomplete: 'off' });
      node.value = v === null || v === undefined ? '' : String(v);
      Object.defineProperty(node, 'parsed', { get: () => parseDecimal(node.value) });
      break;
    }
    case 'money': {
      node = h('input.input.num', { ...common, type: 'text', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off' });
      node.value = v === null || v === undefined || v === '' ? '' : centsToInput(v);
      node.addEventListener('blur', () => {
        const c = parseMoney(node.value);
        if (c !== null) node.value = centsToInput(c);
      });
      // NaN (not null) for text that holds no amount, so validation flags it.
      Object.defineProperty(node, 'parsed', { get: () => (node.value.trim() === '' ? null : (parseMoney(node.value) ?? NaN)) });
      break;
    }
    case 'date':
      node = h('input.input', { ...common, type: 'date', value: v || '' });
      break;
    case 'time':
      node = h('input.input', { ...common, type: 'time', value: v || '' });
      break;
    case 'select': {
      const opts = typeof f.options === 'function' ? f.options() : f.options;
      node = h(
        'select.select',
        common,
        f.required ? null : h('option', { value: '' }, f.placeholder || 'None'),
        opts.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)).map((o) => h('option', { value: o.value }, o.label)),
      );
      node.value = v ?? '';
      if (v && node.value !== String(v)) {
        node.append(h('option', { value: v }, String(v)));
        node.value = v;
      }
      break;
    }
    case 'picker':
      node = picker({ id, items: f.options, value: v, label: f.label, placeholder: f.placeholder || 'Select', allowClear: !f.required, create: f.create || null, onChange: onInput });
      break;
    case 'multipicker':
      node = multiPicker({ id, items: f.options, value: v || [], label: f.label, placeholder: f.placeholder || 'Add', onChange: onInput });
      break;
    case 'tags':
      node = tagInput({ id, value: v || [], suggestions: f.options || (() => []), label: f.label });
      break;
    case 'checkbox':
    case 'switch': {
      const cb = h('input', { id, type: 'checkbox', checked: Boolean(v) });
      node = h(`label.${f.type === 'switch' ? 'switch' : 'check'}`, cb, h('span', f.checkLabel || f.label));
      node.cb = cb;
      break;
    }
    case 'custom':
      node = f.render(v, { onInput });
      node.id ||= id;
      break;
    default:
      node = h('input.input', { ...common, type: f.inputType || 'text', placeholder: f.placeholder || '', autocomplete: f.autocomplete || 'off', maxlength: f.maxlength || null });
      node.value = v ?? '';
  }
  if (f.type !== 'picker' && f.type !== 'multipicker' && f.type !== 'custom') node.addEventListener(f.type === 'select' || f.type === 'checkbox' || f.type === 'switch' ? 'change' : 'input', () => onInput?.());
  return node;
}

function readControl(f, node) {
  switch (f.type) {
    case 'number':
    case 'money':
      return node.parsed;
    case 'checkbox':
    case 'switch':
      return node.cb.checked;
    case 'text':
    case 'textarea':
    case undefined:
      return node.value.trim();
    default:
      return node.value;
  }
}

/**
 * fields come from sections; `record` provides initial values (f.get or
 * record[f.id]). onChange(values, fieldId) fires on every edit.
 */
export function buildForm({ sections, record = {}, onChange }) {
  const entries = [];
  const byId = new Map();
  let initial = null;

  const valuesNow = () => {
    const out = {};
    for (const e of entries) out[e.f.id] = readControl(e.f, e.node);
    return out;
  };

  const sectionNodes = sections.map((s) => {
    const grid = h(`div.form-grid${s.columns === 3 ? '.three' : ''}`);
    for (const f of s.fields) {
      const v = f.get ? f.get(record) : record[f.id];
      const onInput = () => {
        const e = byId.get(f.id);
        if (e?.error) setError(e, null);
        onChange?.(valuesNow(), f.id);
        refreshVisibility();
      };
      const node = control(f, v, onInput);
      const errorNode = h('span.error-text', { id: uniqueId('err'), hidden: true });
      const hint = f.hint ? h('span.hint', { id: uniqueId('hint') }, f.hint) : null;
      const target = node.cb || node.button || node.input || (node.tagName ? node : null);
      if (hint && target?.setAttribute) target.setAttribute('aria-describedby', hint.id);
      let unitNode = null;
      const labelable = /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(node.tagName || '');
      const labelFor = node.cb ? null : node.button?.id || node.input?.id || (labelable ? node.id : node.querySelector?.('input,select,textarea,button')?.id || null);
      const wrapper = h(
        `div.field${f.span === 2 || f.span === 'full' ? '.span-2' : ''}${f.type === 'checkbox' || f.type === 'switch' ? '.field-check' : ''}`,
        f.type === 'checkbox' || f.type === 'switch' || f.noLabel ? null : h('label', { for: labelFor }, f.label, f.required ? h('span.req', { 'aria-hidden': 'true' }, ' *') : null),
        f.unit ? h('div.input-affix.unit', node, (unitNode = h('span.affix-end', typeof f.unit === 'function' ? f.unit() : f.unit))) : node,
        hint,
        errorNode,
      );
      // aria-required is only valid on form controls, not on the picker's button.
      if (f.required && target?.setAttribute && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) target.setAttribute('aria-required', 'true');
      const e = { f, node, wrapper, errorNode, target, error: null, unitNode };
      entries.push(e);
      byId.set(f.id, e);
      grid.append(wrapper);
    }
    const sid = s.id || uniqueId('sec');
    return {
      s,
      sid,
      node: h(
        'section.card.form-section',
        { id: `sec-${sid}`, 'aria-labelledby': `sec-${sid}-h` },
        s.title ? h('div.card-head', h('h2.grow', { id: `sec-${sid}-h` }, s.title), s.actions || null) : null,
        h('div.card-body', s.intro ? h('p.form-intro', s.intro) : null, grid, s.after || null),
      ),
    };
  });

  function refreshVisibility() {
    const vals = valuesNow();
    for (const e of entries) {
      if (e.f.show) e.wrapper.hidden = !e.f.show(vals);
      // Units can depend on other fields (the chosen vehicle's meter).
      if (e.unitNode && typeof e.f.unit === 'function') e.unitNode.textContent = e.f.unit(vals);
    }
  }

  function setError(e, msg) {
    e.error = msg;
    e.errorNode.hidden = !msg;
    e.errorNode.textContent = msg || '';
    if (e.target?.setAttribute) {
      if (msg) {
        e.target.setAttribute('aria-invalid', 'true');
        e.target.setAttribute('aria-describedby', [e.errorNode.id, e.wrapper.querySelector('.hint')?.id].filter(Boolean).join(' '));
      } else e.target.removeAttribute('aria-invalid');
    }
  }

  function validate(extra) {
    const vals = valuesNow();
    let first = null;
    for (const e of entries) {
      if (e.wrapper.hidden) {
        setError(e, null);
        continue;
      }
      const v = vals[e.f.id];
      let msg = null;
      const empty = v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
      if (e.f.required && empty) msg = `${e.f.label} is required.`;
      else if ((e.f.type === 'number' || e.f.type === 'money') && Number.isNaN(v)) msg = 'Enter a number.';
      else if (e.f.type === 'number' && v !== null && e.f.min !== undefined && v < e.f.min) msg = `Must be at least ${e.f.min}.`;
      else if (e.f.type === 'number' && v !== null && e.f.max !== undefined && v > e.f.max) msg = `Must be at most ${e.f.max}.`;
      else if (e.f.validate) msg = e.f.validate(v, vals) || null;
      if (!msg && extra) msg = extra(e.f.id, v, vals) || null;
      setError(e, msg);
      if (msg && !first) first = e;
    }
    if (first) {
      first.wrapper.scrollIntoView({ block: 'center', behavior: scrollMotion() });
      (first.target?.focus ? first.target : first.wrapper.querySelector('input,select,textarea,button'))?.focus({ preventScroll: true });
    }
    return !first;
  }

  refreshVisibility();
  initial = JSON.stringify(valuesNow());

  return {
    sections: sectionNodes,
    node: h('div.form-sections', sectionNodes.map((s) => s.node)),
    values: valuesNow,
    validate,
    dirty: () => JSON.stringify(valuesNow()) !== initial,
    markClean: () => (initial = JSON.stringify(valuesNow())),
    field: (id) => byId.get(id)?.node,
    wrapper: (id) => byId.get(id)?.wrapper,
    set(id, v) {
      const e = byId.get(id);
      if (!e) return;
      if (e.f.type === 'checkbox' || e.f.type === 'switch') e.node.cb.checked = Boolean(v);
      else if (e.f.type === 'money') e.node.value = v === null || v === undefined || v === '' ? '' : centsToInput(v);
      else e.node.value = v ?? '';
      refreshVisibility();
    },
    setError: (id, msg) => byId.get(id) && setError(byId.get(id), msg),
    refreshVisibility,
  };
}

/**
 * A full-page form: header with Cancel and Save, a section index on wide
 * screens, and the sections. onSave(values) may return false to stay;
 * once it saves, the form does not save again (the next page replaces it).
 */
export function formPage({ title, crumbs, sections, record, onSave, onCancel, saveLabel = 'Save', extraActions = null, aside = null, onChange }) {
  const form = buildForm({ sections, record, onChange });
  let saving = false;
  const save = async () => {
    if (saving) return;
    if (!form.validate()) return;
    saving = true;
    let done = false;
    try {
      done = (await onSave(form.values(), form)) !== false;
      if (done) form.markClean();
    } finally {
      // A saved form gives way to the next page, which may still be
      // loading: another click or Ctrl+S meanwhile must not save it again.
      if (!done) saving = false;
    }
  };
  const actions = h(
    'div.actions',
    h('button.btn.ghost', { type: 'button', onClick: () => onCancel?.() }, 'Cancel'),
    extraActions,
    h('button.btn.primary', { type: 'button', onClick: save, 'aria-keyshortcuts': 'Control+S' }, saveLabel),
  );
  const showIndex = form.sections.length > 2;
  const index = showIndex
    ? h(
        'nav.form-index',
        { 'aria-label': 'Form sections' },
        h(
          'ul',
          form.sections.map((s, i) =>
            h(
              'li',
              h(
                'a',
                {
                  href: `#sec-${s.sid}`,
                  'aria-current': i === 0 ? 'true' : null,
                  onClick: (e) => {
                    e.preventDefault();
                    s.node.scrollIntoView({ behavior: scrollMotion(), block: 'start' });
                    s.node.querySelector('input,select,textarea,button')?.focus({ preventScroll: true });
                  },
                },
                s.s.icon ? icon(s.s.icon, 16) : null,
                s.s.title,
              ),
            ),
          ),
        ),
      )
    : null;
  const page = h(
    `div.page.form-page${showIndex ? '.with-index' : ''}`,
    h(
      'header.page-header.sticky-header',
      h(
        'div.titles',
        crumbs?.length ? h('nav.crumbs', { 'aria-label': 'Breadcrumb' }, crumbs.map((c, i) => [i ? icon('chevron-right', 14) : null, c.href ? h('a', { href: c.href }, c.label) : h('span', c.label)])) : null,
        h('h1', title),
      ),
      actions,
    ),
    h('div.form-layout', index, h('form.form-main', { novalidate: true, onSubmit: (e) => (e.preventDefault(), save()) }, form.node, h('div.form-foot', h('button.btn.ghost', { type: 'button', onClick: () => onCancel?.() }, 'Cancel'), h('button.btn.primary', { type: 'submit' }, saveLabel))), aside),
  );
  // Highlight the section in view.
  if (showIndex && typeof IntersectionObserver === 'function') {
    const links = [...index.querySelectorAll('a')];
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const i = form.sections.findIndex((s) => s.node === en.target);
          links.forEach((a, j) => (j === i ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    form.sections.forEach((s) => io.observe(s.node));
    form.disconnect = () => io.disconnect();
  }
  page.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });
  return { node: page, form, save };
}

/** Options helpers for pickers. */
export const opts = {
  list: (arr) => () => arr.map((x) => (typeof x === 'string' ? { value: x, label: x } : x)),
};

/**
 * A form in a dialog. onSave(values, form) may return false to keep it
 * open. extraFooter({ close }) adds buttons on the left (e.g. Delete).
 * Resolves with onSave's result, or null when cancelled.
 */
export function openFormDialog({ title, fields, sections, record = {}, onSave, saveLabel = 'Save', size = '', extraFooter = null, intro = null, after = null, onChange }) {
  return new Promise((resolve) => {
    let result = null;
    const form = buildForm({ sections: sections || [{ fields }], record, onChange });
    const body = h('form.dialog-form', { novalidate: true }, intro ? h('p.muted.form-intro', intro) : null, ...form.sections.map((s) => (sections ? s.node : s.node.querySelector('.form-grid'))), after);
    let busy = false;
    const submit = async (close) => {
      if (busy || !form.validate()) return;
      busy = true;
      try {
        const out = await onSave(form.values(), form);
        if (out === false) return;
        result = out ?? true;
        close();
      } finally {
        busy = false;
      }
    };
    {
      const api = openDialog({
        title,
        size,
        body: ({ close }) => {
          body.addEventListener('submit', (e) => {
            e.preventDefault();
            submit(close);
          });
          return body;
        },
        footer: ({ close }) => [extraFooter ? extraFooter({ close }) : null, extraFooter ? h('div.spacer') : null, h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'), h('button.btn.primary', { type: 'button', onClick: () => submit(close) }, saveLabel)],
        onClose: () => resolve(result),
        confirmDismiss: () =>
          !form.dirty() ||
          confirmDialog({
            title: 'Discard changes?',
            message: 'What you entered in this form has not been saved.',
            confirmLabel: 'Discard changes',
            cancelLabel: 'Keep editing',
            danger: true,
          }),
      });
      api.dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit(api.close);
        }
      });
      form.api = api;
    }
  });
}
