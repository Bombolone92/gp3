/**
 * Creating and editing fields: name, type, type options, description. Also
 * the column menu shared by the grid header and the hide-fields list.
 */
import { h, append, keepFocus } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { chipColors, accentColor, HUES, nextColor } from '../lib/colors.js';
import { DURATION_FORMATS, DATE_FORMATS } from '../lib/format.js';
import { TYPES, TYPE_ORDER, DESCRIPTIONS, ROLLUP_FUNCTIONS, PRIMARY_TYPES, defaultOptions, valueKind, isComputed, toText, splitList } from '../data/fields.js';
import { makeChoice } from '../data/base.js';
import { prepare, toDisplay, fromDisplay, fieldRef, FUNCTION_HELP } from '../data/formula.js';
import { openPopover } from './popover.js';
import { openMenu } from './menu.js';
import { confirmDialog } from './dialog.js';
import { toast } from './toast.js';
import { newConditionId } from '../data/views.js';
import { defaultOp } from '../data/query.js';

const sel = (options, value, onchange, label) => {
  const s = h('select.select', { 'aria-label': label, onchange: () => onchange(s.value) }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
  return s;
};

let rowSeq = 0;
/** A labeled row; the label is tied to its control (or names the group). */
const row = (label, control, hint) => {
  const isControl = control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement;
  const id = isControl ? control.id || (control.id = `fe-${++rowSeq}`) : null;
  const labelId = `fe-l-${++rowSeq}`;
  if (!isControl && control instanceof Element) {
    control.setAttribute('role', control.getAttribute('role') || 'group');
    control.setAttribute('aria-labelledby', labelId);
  }
  return h('div.form-row', h('label.field-label', { for: id, id: labelId }, label), control, hint ? h('p.field-hint', hint) : null);
};

const toggle = (label, checked, onchange) => {
  const cb = h('input.switch', { type: 'checkbox', role: 'switch', checked: !!checked, onchange: () => onchange(cb.checked) });
  return h('label.switch-row', cb, h('span.grow', label));
};

const PRECISIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((p) => [p, p === 0 ? '1' : `1.${'0'.repeat(p)}`]);

/**
 * Open the field editor next to an anchor. With opts.field it edits that
 * field; otherwise it creates one (onCreated(fieldId) afterwards).
 */
export function openFieldEditor(anchor, page, table, { field = null, onCreated, type: presetType } = {}) {
  const base = page.base;
  const editing = !!field;
  const isPrimary = editing && field.id === table.schema.primaryFieldId;
  let state = {
    name: field?.name || '',
    type: field?.type || presetType || 'text',
    options: structuredClone(field?.options || defaultOptions(presetType || 'text')),
    description: field?.description || '',
  };
  if (state.type === 'formula') state.options.formula = toDisplay(state.options.formula, table.fields);
  if (state.type === 'button') state.options.url = toDisplay(state.options.url || '', table.fields);
  let showDesc = !!state.description;
  const nameInput = h('input.input', { type: 'text', placeholder: 'Field name (optional)', 'aria-label': 'Field name', value: state.name, oninput: () => (state.name = nameInput.value) });
  const typeBtn = h('button.type-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Field type' });
  const optionsHost = h('div.field-options');
  const descHost = h('div');
  const error = h('p.field-error', { role: 'alert' });
  const saveBtn = h('button.btn.primary', { type: 'button' }, editing ? 'Save' : 'Create field');
  const panel = h('div.field-editor', nameInput, typeBtn, h('p.type-desc'), optionsHost, descHost, error, h('div.popover-footer',
    h('button.link-btn.muted', { type: 'button', onclick: () => {
      showDesc = !showDesc;
      renderDesc();
    } }, icon(showDesc ? 'minus' : 'plus', 14), showDesc ? 'Remove description' : 'Add description'),
    h('div', { style: { display: 'flex', gap: '8px' } }, h('button.btn', { type: 'button', onclick: () => pop.close() }, 'Cancel'), saveBtn)));

  function renderType() {
    typeBtn.replaceChildren(icon(TYPES[state.type].icon, 16), h('span.grow', TYPES[state.type].label), icon('chevronDown', 14));
    panel.querySelector('.type-desc').textContent = DESCRIPTIONS[state.type] || '';
  }

  typeBtn.addEventListener('click', () => {
    const items = [];
    let lastGroup = null;
    for (const t of TYPE_ORDER) {
      if (isPrimary && !PRIMARY_TYPES.has(t)) continue;
      const g = TYPES[t].group;
      if (g !== lastGroup && lastGroup) items.push({ type: 'sep' });
      lastGroup = g;
      items.push({ label: TYPES[t].label, icon: TYPES[t].icon, checked: state.type === t, radio: true, keywords: DESCRIPTIONS[t], onSelect: () => setType(t) });
    }
    openMenu(typeBtn, items, { search: true, searchPlaceholder: 'Find a field type', label: 'Field types', width: 300 });
  });

  function setType(t) {
    if (t === state.type) return;
    const prevChoices = state.options.choices;
    state.type = t;
    state.options = defaultOptions(t);
    // Keep options between the two select types.
    if ((t === 'singleSelect' || t === 'multipleSelect') && prevChoices) state.options.choices = prevChoices;
    // Turning existing values into options: show them so they can be renamed or recolored first.
    else if ((t === 'singleSelect' || t === 'multipleSelect') && editing && !isComputed(field) && field.type !== 'link' && field.type !== 'attachment') {
      const names = [];
      for (const r of table.ordered()) {
        const text = toText(field, base.compute.value(table, r, field), base.compute.ctx);
        for (const n of t === 'multipleSelect' ? splitList(text) : [text.trim()]) {
          if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
        }
        if (names.length >= 100) break;
      }
      const choices = [];
      for (const n of names) choices.push(makeChoice(n, choices));
      state.options.choices = choices;
    }
    if (editing && t === field.type) state.options = structuredClone(field.options);
    if (t === 'formula' && editing && field.type === 'formula') state.options.formula = toDisplay(field.options.formula, table.fields);
    if (t === 'button' && editing && field.type === 'button') state.options.url = toDisplay(field.options.url || '', table.fields);
    renderType();
    renderOptions();
  }

  function renderDesc() {
    descHost.replaceChildren();
    if (!showDesc) return;
    const ta = h('textarea.textarea', { rows: 2, placeholder: 'Describe this field', 'aria-label': 'Description', oninput: () => (state.description = ta.value) });
    ta.value = state.description;
    descHost.append(row('Description', ta));
    panel.querySelector('.popover-footer .link-btn').replaceChildren(icon('minus', 14), 'Remove description');
  }

  const linkFields = () => table.fields.filter((f) => f.type === 'link' && f.id !== field?.id);

  // Options redraw as choices change them (Include time, the linked field):
  // focus stays on the control that was used.
  function renderOptions() {
    keepFocus(optionsHost, drawOptions);
  }

  function drawOptions() {
    const o = state.options;
    const parts = [];
    switch (state.type) {
      case 'text':
        parts.push(row('Default value', h('input.input', { type: 'text', value: o.default || '', placeholder: 'None', oninput: (e) => (o.default = e.target.value || undefined) })));
        break;
      case 'number':
        parts.push(row('Precision', sel(PRECISIONS, o.precision ?? 0, (v) => (o.precision = Number(v)), 'Precision')));
        break;
      case 'currency':
        parts.push(h('div.form-pair', row('Symbol', h('input.input', { type: 'text', value: o.symbol ?? '$', maxLength: 4, oninput: (e) => (o.symbol = e.target.value) })), row('Precision', sel(PRECISIONS, o.precision ?? 2, (v) => (o.precision = Number(v)), 'Precision'))));
        break;
      case 'percent':
        parts.push(row('Precision', sel(PRECISIONS, o.precision ?? 0, (v) => (o.precision = Number(v)), 'Precision')));
        break;
      case 'duration':
        parts.push(row('Format', sel(DURATION_FORMATS.map((f) => [f, f]), o.format || 'h:mm', (v) => (o.format = v), 'Duration format')));
        break;
      case 'rating':
        parts.push(h('div.form-pair',
          row('Maximum', sel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [n, String(n)]), o.max || 5, (v) => (o.max = Number(v)), 'Maximum')),
          row('Icon', sel([['star', 'Star'], ['heart', 'Heart'], ['thumbsUp', 'Thumbs up'], ['flag', 'Flag']], o.icon || 'star', (v) => (o.icon = v), 'Icon'))));
        parts.push(row('Color', colorRow(o.color || 'yellow', (c) => (o.color = c))));
        break;
      case 'checkbox':
        parts.push(row('Color', colorRow(o.color || 'green', (c) => (o.color = c))));
        parts.push(toggle('Checked by default', o.default === true, (v) => (o.default = v || undefined)));
        break;
      case 'singleSelect':
      case 'multipleSelect':
        parts.push(choicesEditor(o));
        break;
      case 'date':
      case 'createdTime':
      case 'lastModifiedTime':
        parts.push(row('Date format', sel(Object.entries(DATE_FORMATS).map(([k, l]) => [k, `${l} (${exampleDate(k)})`]), o.dateFormat || 'local', (v) => (o.dateFormat = v), 'Date format')));
        parts.push(toggle('Include time', o.includeTime, (v) => {
          o.includeTime = v;
          renderOptions();
        }));
        if (o.includeTime) {
          parts.push(row('Time format', sel([['12h', '12 hour'], ['24h', '24 hour']], o.timeFormat || '12h', (v) => (o.timeFormat = v), 'Time format')));
          parts.push(toggle('Show times in GMT for everyone', o.gmt, (v) => (o.gmt = v)));
        }
        if (state.type === 'date') parts.push(toggle("Default to today's date", o.default === 'today', (v) => (o.default = v ? 'today' : undefined)));
        break;
      case 'link': {
        const tables = base.tableList();
        if (editing && field.type === 'link') {
          parts.push(row('Linked table', h('div.ro-value', base.table(o.tableId)?.name || 'Missing table')));
        } else {
          if (!o.tableId) o.tableId = tables.find((t) => t.id !== table.id)?.id || table.id;
          parts.push(row('Link to', sel(tables.map((t) => [t.id, t.id === table.id ? `${t.name} (this table)` : t.name]), o.tableId, (v) => (o.tableId = v), 'Linked table')));
        }
        parts.push(toggle('Allow linking to multiple records', !o.single, (v) => (o.single = !v)));
        break;
      }
      case 'lookup':
      case 'rollup':
      case 'count': {
        const links = linkFields();
        if (!links.length) {
          parts.push(h('p.field-hint', 'Add a "Link to another record" field first, then come back.'));
          break;
        }
        if (!o.linkFieldId || !table.field(o.linkFieldId)) o.linkFieldId = links[0].id;
        parts.push(row('Linked field', sel(links.map((f) => [f.id, `${f.name} (${base.table(f.options.tableId)?.name || '?'})`]), o.linkFieldId, (v) => {
          o.linkFieldId = v;
          o.targetFieldId = null;
          renderOptions();
        }, 'Linked field')));
        if (state.type !== 'count') {
          const target = base.table(table.field(o.linkFieldId).options.tableId);
          const tfields = target ? target.fields : [];
          if (!o.targetFieldId || !target?.field(o.targetFieldId)) o.targetFieldId = tfields[0]?.id || null;
          parts.push(row(state.type === 'lookup' ? 'Field to look up' : 'Field to summarize', sel(tfields.map((f) => [f.id, f.name]), o.targetFieldId, (v) => (o.targetFieldId = v), 'Target field')));
        }
        if (state.type === 'rollup') {
          parts.push(h('div.form-pair', row('Summary', sel(Object.entries(ROLLUP_FUNCTIONS), o.fn || 'sum', (v) => (o.fn = v), 'Summary')), row('Precision', sel(PRECISIONS, o.precision ?? 0, (v) => (o.precision = Number(v)), 'Precision'))));
        }
        break;
      }
      case 'formula':
        parts.push(formulaEditor(o));
        break;
      case 'button':
        parts.push(row('Label', h('input.input', { type: 'text', value: o.label || 'Open', oninput: (e) => (o.label = e.target.value) })));
        parts.push(row('Link', h('input.input', { type: 'text', value: o.url || '', placeholder: '"https://example.com/search?q=" & {Name}', oninput: (e) => (o.url = e.target.value) }), 'A web address, or a formula that builds one from the record.'));
        break;
      default:
    }
    optionsHost.replaceChildren(...parts);
  }

  function colorRow(value, onPick) {
    const swatches = HUES.map((c) => h('button.swatch', { type: 'button', role: 'radio', 'aria-label': c, style: { background: accentColor(c), color: '#fff' }, onclick: () => {
      onPick(c);
      paint(c);
    } }));
    // Marked in place, so the swatch just chosen keeps focus.
    const paint = (cur) => swatches.forEach((btn, i) => {
      btn.setAttribute('aria-checked', String(cur === HUES[i]));
      btn.replaceChildren(...(cur === HUES[i] ? [icon('check', 12)] : []));
    });
    paint(value);
    return h('div.swatches', { role: 'radiogroup', 'aria-label': 'Color' }, swatches);
  }

  function choicesEditor(o) {
    o.choices ||= [];
    const list = h('ul.choice-editor');
    const wrap = h('div');
    let dragIndex = -1;
    // The default option list follows the options as they change.
    const defaultSel = state.type === 'singleSelect' ? h('select.select', { 'aria-label': 'Default option', onchange: () => (o.default = defaultSel.value || undefined) }) : null;
    const paintDefault = () => {
      if (!defaultSel) return;
      if (o.default && !o.choices.some((c) => c.id === o.default)) o.default = undefined;
      defaultSel.replaceChildren(h('option', { value: '' }, 'None'), ...o.choices.map((c) => h('option', { value: c.id, selected: o.default === c.id }, c.name || 'Untitled')));
    };
    // Removing or recoloring an option keeps focus in the same place.
    const paint = () => keepFocus(wrap, () => {
      paintDefault();
      list.replaceChildren(
        ...o.choices.map((c, i) => {
          const [bg, fg] = chipColors(c.color);
          const colorBtn = h('button.choice-color', { type: 'button', 'aria-label': `Color of ${c.name || 'option'}`, style: { background: bg, color: fg, borderColor: fg } });
          colorBtn.addEventListener('click', () => {
            const grid = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Color' });
            const names = [...HUES, ...HUES.map((x) => `${x}Strong`)];
            grid.style.gridTemplateColumns = 'repeat(10, 22px)';
            const pick = openPopover(colorBtn, grid, { className: 'padded', label: 'Option color' });
            grid.append(...names.map((n) => {
              const [b, f] = chipColors(n);
              return h('button.swatch', { type: 'button', role: 'radio', 'aria-checked': String(c.color === n), 'aria-label': n.replace('Strong', ' (strong)'), style: { background: b, color: f, borderColor: f }, onclick: () => {
                c.color = n;
                pick.close();
                paint();
              } }, c.color === n ? icon('check', 12) : null);
            }));
          });
          const input = h('input.input', { type: 'text', value: c.name, 'aria-label': `Option ${i + 1}`, placeholder: 'Option name', oninput: () => {
            c.name = input.value;
            paintDefault();
          } });
          input.addEventListener('keydown', (e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              addChoice(i + 1);
            } else if (e.key === 'Backspace' && !input.value && o.choices.length > 0) {
              e.preventDefault();
              o.choices.splice(i, 1);
              paint();
              list.querySelectorAll('input.input')[Math.max(0, i - 1)]?.focus();
            }
          });
          const li = h('li.choice-row', { draggable: 'true' }, h('span.choice-grip', { 'aria-hidden': 'true' }, icon('grip', 14)), colorBtn, input,
            h('button.icon-btn', { type: 'button', 'aria-label': `Remove ${c.name || 'option'}`, onclick: () => {
              o.choices.splice(i, 1);
              paint();
            } }, icon('x', 14)));
          li.addEventListener('dragstart', (e) => {
            dragIndex = i;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', c.name);
          });
          li.addEventListener('dragover', (e) => e.preventDefault());
          li.addEventListener('drop', (e) => {
            e.preventDefault();
            if (dragIndex < 0 || dragIndex === i) return;
            const [m] = o.choices.splice(dragIndex, 1);
            o.choices.splice(i, 0, m);
            dragIndex = -1;
            paint();
          });
          return li;
        }),
      );
    });
    const addChoice = (at = o.choices.length) => {
      const c = makeChoice('', o.choices);
      c.color = nextColor(o.choices.map((x) => x.color));
      o.choices.splice(at, 0, c);
      paint();
      list.querySelectorAll('input.input')[at]?.focus();
    };
    paint();
    const defaultSelect = defaultSel ? row('Default option', defaultSel) : null;
    return append(wrap, [
      h('div.choice-head', h('span.field-label', 'Options'), h('button.link-btn.muted', { type: 'button', onclick: () => {
        o.choices.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        paint();
      } }, icon('sortAsc', 14), 'Alphabetize')),
      list,
      h('button.link-btn', { type: 'button', onclick: () => addChoice() }, icon('plus', 14), 'Add option'),
      defaultSelect]);
  }

  function formulaEditor(o) {
    const ta = h('textarea.textarea.formula-input', { rows: 4, spellcheck: false, 'aria-label': 'Formula', placeholder: 'For example: {Price} * {Quantity}', autocomplete: 'off' });
    ta.value = o.formula || '';
    const status = h('p.formula-status', { 'aria-live': 'polite' });
    const check = () => {
      o.formula = ta.value;
      if (!ta.value.trim()) {
        status.textContent = '';
        status.className = 'formula-status';
        return;
      }
      try {
        const stored = fromDisplay(ta.value, table.fields.filter((f) => f.id !== field?.id));
        const p = prepare(stored);
        if (p.error) throw new Error(p.error);
        status.textContent = 'Valid formula';
        status.className = 'formula-status ok';
      } catch (err) {
        status.textContent = err.message;
        status.className = 'formula-status bad';
      }
    };
    ta.addEventListener('input', check);
    const insert = (text) => {
      const s = ta.selectionStart ?? ta.value.length;
      const e = ta.selectionEnd ?? s;
      ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
      const pos = s + text.length - (text.endsWith('()') ? 1 : 0);
      ta.focus();
      ta.setSelectionRange(pos, pos);
      check();
    };
    const fieldsList = h('div.formula-ref', h('div.menu-header', 'Fields'), table.fields.filter((f) => f.id !== field?.id).map((f) => h('button.formula-item', { type: 'button', onclick: () => insert(fieldRef(f.name)) }, icon(TYPES[f.type].icon, 14), h('span', f.name))));
    const funcs = h('div.formula-ref');
    for (const [group, fns] of Object.entries(FUNCTION_HELP)) {
      funcs.append(h('div.menu-header', group));
      for (const [name, sig] of Object.entries(fns)) funcs.append(h('button.formula-item', { type: 'button', title: sig, onclick: () => insert(`${name}()`) }, h('code', name), h('span.muted', sig.slice(name.length))));
    }
    check();
    const fmt = row('Format', h('div.form-pair',
      sel([['auto', 'Automatic'], ['integer', 'Integer'], ['decimal', 'Decimal'], ['currency', 'Currency'], ['percent', 'Percent'], ['duration', 'Duration']], o.format || 'auto', (v) => (o.format = v), 'Number format'),
      sel(PRECISIONS, o.precision ?? 2, (v) => (o.precision = Number(v)), 'Precision')), 'Applies when the formula gives a number.');
    return h('div', row('Formula', ta), status, fmt, h('details.formula-help', h('summary', 'Fields and functions'), h('div.formula-cols', fieldsList, funcs)));
  }

  async function save() {
    error.textContent = '';
    const opts = structuredClone(state.options);
    if (state.type === 'formula') {
      try {
        opts.formula = fromDisplay(opts.formula || '', table.fields.filter((f) => f.id !== field?.id));
      } catch (err) {
        error.textContent = err.message;
        return;
      }
      if (!opts.formula.trim()) {
        error.textContent = 'Enter a formula.';
        return;
      }
      // A formula that does not parse is not saved.
      const check = prepare(opts.formula);
      if (check.error) {
        error.textContent = check.error;
        return;
      }
    }
    if (state.type === 'button' && opts.url) {
      try {
        opts.url = /^https?:\/\/\S+$/i.test(opts.url) ? opts.url : fromDisplay(opts.url, table.fields);
      } catch (err) {
        error.textContent = err.message;
        return;
      }
      const check = /^https?:\/\/\S+$/i.test(opts.url) ? {} : prepare(opts.url);
      if (check.error) {
        error.textContent = check.error;
        return;
      }
    }
    if ((state.type === 'singleSelect' || state.type === 'multipleSelect')) {
      opts.choices = (opts.choices || []).filter((c) => c.name.trim()).map((c) => ({ ...c, name: c.name.trim() }));
      // A default that is no longer an option is dropped.
      if (opts.default && !opts.choices.some((c) => c.id === opts.default)) delete opts.default;
      const seen = new Set();
      for (const c of opts.choices) {
        if (seen.has(c.name.toLowerCase())) {
          error.textContent = `There are two options named "${c.name}".`;
          return;
        }
        seen.add(c.name.toLowerCase());
      }
    }
    if (['lookup', 'rollup', 'count'].includes(state.type) && !opts.linkFieldId) {
      error.textContent = 'Add a linked record field first.';
      return;
    }
    const name = state.name.trim();
    try {
      if (editing) {
        const typeChanged = state.type !== field.type;
        const withData = typeChanged && [...table.records.values()].some((r) => r.c[field.id] !== undefined);
        const numbered = state.type === 'autonumber';
        if (withData && (isComputed({ type: state.type }) || numbered)) {
          const message = numbered ? 'Values in this field will be replaced by numbers in the order records were created. You can undo this.' : 'Values in this field will be replaced by computed values. You can undo this.';
          const ok = await confirmDialog({ title: `Change ${field.name} to ${TYPES[state.type].label.toLowerCase()}?`, message, confirmLabel: 'Change type' });
          if (!ok) return;
        }
        const patch = { options: opts, description: state.description.trim() || undefined };
        if (name && name !== field.name) patch.name = name;
        if (typeChanged) patch.type = state.type;
        base.updateField(table.id, field.id, patch);
        if (typeChanged && withData) page.toastUndo(`Converted ${field.name} to ${TYPES[state.type].label.toLowerCase()}`);
      } else {
        const id = base.addField(table.id, { name: name || TYPES[state.type].label, type: state.type, options: opts, description: state.description.trim() || undefined });
        onCreated?.(id);
      }
      pop.close();
    } catch (err) {
      error.textContent = err.message || String(err);
    }
  }

  saveBtn.addEventListener('click', save);
  nameInput.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });
  renderType();
  renderOptions();
  renderDesc();
  const pop = openPopover(anchor, panel, { className: 'padded', label: editing ? `Edit ${field.name}` : 'New field', focus: nameInput, width: 380 });
  return pop;
}

function exampleDate(fmt) {
  const d = new Date(2026, 8, 7);
  const p = { y: 2026, m: 8, d: 7 };
  void d;
  switch (fmt) {
    case 'friendly':
      return 'September 7, 2026';
    case 'us':
      return '9/7/2026';
    case 'european':
      return '7/9/2026';
    case 'iso':
      return '2026-09-07';
    default:
      return `${p.m + 1}/${p.d}/${p.y}`;
  }
}

/** Sort labels that read naturally for a field's kind. */
export function sortLabels(field, ctx) {
  const kind = valueKind(field, ctx);
  if (kind === 'number') return ['1 → 9', '9 → 1'];
  if (kind === 'checkbox') return ['Unchecked → checked', 'Checked → unchecked'];
  if (kind === 'date') return ['Oldest → newest', 'Newest → oldest'];
  if (field.type === 'singleSelect') return ['First → last', 'Last → first'];
  return ['A → Z', 'Z → A'];
}

/** The menu for a field (grid header, record and settings). */
export function fieldMenuItems(page, table, field, { onEdit, onInsert, onFreeze, frozen, index, view } = {}) {
  const base = page.base;
  const isPrimary = field.id === table.schema.primaryFieldId;
  const [asc, desc] = sortLabels(field, base.compute.ctx);
  const v = view || page.view;
  return [
    { label: 'Edit field', icon: 'pencil', onSelect: onEdit },
    { label: 'Duplicate field', icon: 'copy', onSelect: () => base.duplicateField(table.id, field.id) },
    onInsert ? { label: 'Insert left', icon: 'insertLeft', disabled: index === 0, onSelect: () => onInsert('left') } : null,
    onInsert ? { label: 'Insert right', icon: 'insertRight', onSelect: () => onInsert('right') } : null,
    { type: 'sep' },
    { label: `Sort ${asc}`, icon: 'sortAsc', onSelect: () => base.updateView(table.id, v.id, { sorts: [{ fieldId: field.id, dir: 'asc' }] }, { label: 'Sort' }) },
    { label: `Sort ${desc}`, icon: 'sortDesc', onSelect: () => base.updateView(table.id, v.id, { sorts: [{ fieldId: field.id, dir: 'desc' }] }, { label: 'Sort' }) },
    { label: 'Filter by this field', icon: 'filter', onSelect: () => {
      const cond = { id: newConditionId(), fieldId: field.id, op: defaultOp(field, base.compute.ctx), value: null };
      base.updateView(table.id, v.id, { filters: { conjunction: v.filters?.conjunction || 'and', conditions: [...(v.filters?.conditions || []), cond] } }, { label: 'Filter' });
      requestAnimationFrame(() => page.viewbarEl?.querySelector('.tool-btn.t-filter')?.click());
    } },
    v?.type === 'grid' || v?.type === 'list' ? { label: 'Group by this field', icon: 'group', onSelect: () => base.updateView(table.id, v.id, { groups: [...(v.groups || []).filter((g) => g.fieldId !== field.id), { fieldId: field.id, dir: 'asc' }] }, { label: 'Group' }) } : null,
    onFreeze ? { label: index + 1 === frozen ? 'Unfreeze fields' : 'Freeze up to this field', icon: 'freeze', onSelect: index + 1 === frozen ? () => base.updateView(table.id, v.id, { frozen: 1 }, { label: 'Unfreeze' }) : onFreeze } : null,
    { type: 'sep' },
    { label: 'Edit field description', icon: 'info', onSelect: onEdit },
    !isPrimary ? { label: 'Hide field', icon: 'eyeOff', onSelect: () => base.updateView(table.id, v.id, { hidden: [...new Set([...(v.hidden || []), field.id])] }, { label: 'Hide field' }) } : null,
    !isPrimary ? { label: 'Delete field', icon: 'trash', danger: true, onSelect: async () => {
      const ok = await confirmDialog({ title: `Delete ${field.name}?`, message: field.type === 'link' && field.options.inverseId ? 'The field and its values are deleted, along with the matching link field in the other table. You can undo this.' : 'The field and its values are deleted. You can undo this.', confirmLabel: 'Delete field', danger: true });
      if (!ok) return;
      base.deleteField(table.id, field.id);
      page.toastUndo(`Deleted ${field.name}`);
    } } : null,
  ];
}
