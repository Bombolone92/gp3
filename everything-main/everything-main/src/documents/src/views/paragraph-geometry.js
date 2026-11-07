import { el } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { openModal } from '../ui/modal.js';
import { normalizeTabStops, validateIndent, sameValue } from '../engine/paragraph-geometry.js';
import { TAB_LEADERS } from '../engine/tab-leaders.js';

/** Exact imported twips survive an untouched display value. Blank mixed fields remain unchanged. */
export function openParagraphGeometry(format, defaultTabStop, apply) {
  const originals = new WeakMap();
  const distance = (label, value, { required = false, min = -22 } = {}) => {
    const text = value == null ? '' : String(Number((value / 1440).toFixed(5)));
    const input = el('input.input', { type: 'number', step: 'any', min, max: 22, required, value: text, placeholder: value == null ? 'Mixed' : '', 'aria-label': `${label} (in)` });
    originals.set(input, { text, value });
    return input;
  };
  const read = input => input.value === originals.get(input).text ? originals.get(input).value : input.value === '' ? null : Math.round(Number(input.value) * 1440);
  const field = (label, input) => el('label.field', {}, el('span.field-label', {}, label), input);
  const left = distance('Left indent', format.indentLeft), right = distance('Right indent', format.indentRight);
  const by = distance('Special indent', format.firstLine == null ? null : Math.abs(format.firstLine), { min: 0 });
  const special = el('select.input', { 'aria-label': 'Special indent', onchange: () => {
    by.disabled = !special.value || special.value === 'none';
    by.required = !by.disabled;
    if (by.required && by.value === '') by.value = '0.5';
  } }, ...[['', 'Mixed — keep unchanged'], ['none', 'None'], ['firstLine', 'First line'], ['hanging', 'Hanging']].map(([value, label]) => el('option', { value }, label)));
  special.value = format.firstLine == null ? '' : format.firstLine < 0 ? 'hanging' : format.firstLine > 0 ? 'firstLine' : 'none';
  by.disabled = !special.value || special.value === 'none';
  by.required = !by.disabled;
  const interval = distance('Default tab spacing', defaultTabStop, { required: true, min: 1 / 1440 });
  const error = el('p.field-error', { role: 'alert', hidden: true });
  const rows = [], list = el('div.canvas-tab-list');
  let tabsChanged = false;
  const empty = el('p.field-hint', {}, format.tabs === null ? 'Tab stops vary across the selection. Adding or clearing stops replaces them for every selected paragraph.' : 'No custom stops. Tabs use the default spacing and any hanging indent.');
  const refresh = () => {
    list.replaceChildren(...rows.map((row, i) => {
      row.position.setAttribute('aria-label', `Tab ${i + 1} position (in)`);
      row.alignment.setAttribute('aria-label', `Tab ${i + 1} alignment`);
      row.leader.setAttribute('aria-label', `Tab ${i + 1} leader`);
      row.remove.setAttribute('aria-label', `Remove tab ${i + 1}`);
      return row.el;
    }));
    empty.hidden = rows.length > 0;
  };
  const add = stop => {
    const position = distance('Tab position', stop.position, { required: true });
    const alignment = el('select.input', {}, ...['left', 'center', 'right', 'decimal'].map(value => el('option', { value, selected: value === stop.alignment }, value[0].toUpperCase() + value.slice(1))));
    const leader = el('select.input', {}, ...Object.entries(TAB_LEADERS).map(([value, label]) => el('option', { value, selected: value === (stop.leader || 'none') }, label)));
    const row = { position, alignment, leader, numberingOnly: stop.numberingOnly };
    row.remove = el('button.icon-btn', { type: 'button', title: 'Remove tab stop', onclick: () => {
      tabsChanged = true; rows.splice(rows.indexOf(row), 1); refresh();
      (rows[0]?.position || addButton).focus();
    } }, iconEl('trash', 18));
    row.el = el('div.canvas-tab-row', {}, position, alignment, leader, row.remove);
    position.addEventListener('input', () => { tabsChanged = true; });
    alignment.addEventListener('change', () => { tabsChanged = true; row.numberingOnly = false; });
    leader.addEventListener('change', () => { tabsChanged = true; });
    rows.push(row); refresh();
    return position;
  };
  const addButton = el('button.btn.btn-ghost', { type: 'button', onclick: () => {
    tabsChanged = true;
    const last = Math.max(0, ...rows.map(row => read(row.position) || 0));
    add({ position: Math.min(31680, last + 720), alignment: 'left' }).focus();
  } }, iconEl('plus', 16), 'Add tab stop');
  for (const tab of format.tabs || []) add(tab);
  const content = el('form.canvas-geometry-form', { onsubmit: e => {
    e.preventDefault();
    try {
      const patch = {};
      for (const [key, input] of [['indentLeft', left], ['indentRight', right]]) {
        const value = read(input);
        if (value !== null && value !== format[key]) patch[key] = validateIndent(value);
      }
      if (special.value) {
        const value = special.value === 'none' ? 0 : read(by) * (special.value === 'hanging' ? -1 : 1);
        if (value !== format.firstLine) patch.firstLine = validateIndent(value);
      }
      if (tabsChanged) {
        const tabs = normalizeTabStops(rows.map(row => ({ position: read(row.position), alignment: row.alignment.value, leader: row.leader.value, ...(row.numberingOnly ? { numberingOnly: true } : {}) })));
        if (!sameValue(tabs, format.tabs)) patch.tabs = tabs;
      }
      if (apply(patch, read(interval)) === false) throw new Error('These settings cannot fit the current text. Adjust the indents or tab stops.');
      modal.close();
    } catch (e) { error.textContent = e.message; error.hidden = false; }
  } },
  el('section', {}, el('h3.canvas-dialog-heading', {}, 'Indents'),
    el('div.canvas-page-fields', {}, field('Left indent (in)', left), field('Right indent (in)', right), field('Special indent', special), field('By (in)', by)),
    field('Default tab spacing (in) · whole document', interval)),
  el('section', {}, el('h3.canvas-dialog-heading', {}, 'Tab stops'),
  el('div.canvas-tab-head', { 'aria-hidden': 'true' }, el('span', {}, 'Position (in)'), el('span', {}, 'Alignment'), el('span', {}, 'Leader')),
  list, empty,
  el('div.row', {}, addButton, el('button.btn.btn-ghost', { type: 'button', onclick: () => {
    tabsChanged = true; rows.length = 0; empty.textContent = 'Custom stops will be cleared. Default spacing and any hanging indent still apply.'; refresh();
  } }, 'Clear all tab stops'))),
  el('p.field-hint', {}, 'Indents and custom stops apply to selected paragraphs. Tab positions start at the text margin. Decimal tabs use a period.'),
  error, el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Indents and tabs', content, wide: true, onClose: () => {
    const root = modal.panel.closest('.modal-root');
    root?.setAttribute('inert', ''); root?.setAttribute('aria-hidden', 'true');
  } });
  modal.panel.classList.add('canvas-geometry-dialog');
  return modal;
}
