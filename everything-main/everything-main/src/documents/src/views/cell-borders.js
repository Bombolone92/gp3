import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';
import { CELL_BORDER_SIDES, CELL_BORDER_STYLES, checkedCellBorder } from '../engine/cell-borders.js';
import { borderWidth } from '../engine/paragraph-borders.js';

export function cellBorderLabel(values) {
  const data = values.map(value => CELL_BORDER_SIDES.map(side => value[side] && [value[side].style, value[side].size, value[side].color]));
  if (!data.every(value => JSON.stringify(value) === JSON.stringify(data[0]))) return 'Mixed';
  return values.some(value => CELL_BORDER_SIDES.some(side => borderWidth(value[side]))) ? 'Custom' : 'None';
}

export function openCellBorders(values, apply, onClose) {
  const rows = CELL_BORDER_SIDES.map(side => {
    const label = side[0].toUpperCase() + side.slice(1), borders = values.map(value => value[side]);
    const common = (key, fallback) => {
      const all = borders.map(border => border?.[key] ?? fallback);
      return all.every(value => value === all[0]) ? all[0] : '';
    };
    const style = el('select.input', { 'aria-label': `${label} cell border style` }, el('option', { value: '', disabled: true }, 'Mixed — keep'), el('option', { value: 'inherit' }, 'Inherit'),
      ...Object.entries(CELL_BORDER_STYLES).map(([value, label]) => el('option', { value }, label)));
    const pattern = common('style', 'nil'); style.value = pattern === 'none' ? 'nil' : pattern;
    const size = common('size', 8), width = el('input.input', { type: 'number', min: 0, max: 12, step: .125, value: size === '' ? '' : size / 8, placeholder: 'Mixed', 'aria-label': `${label} cell border width (pt)` });
    const color = el('input.input', { type: 'text', pattern: 'auto|#?[0-9a-fA-F]{6}', value: common('color', 'auto'), placeholder: 'Mixed', 'aria-label': `${label} cell border color`, title: 'auto or a six-digit RGB color' });
    const row = { side, label, style, width, color, fields: () => JSON.stringify([style.value, width.value, color.value]) };
    row.refresh = () => { width.disabled = color.disabled = !style.value || ['nil', 'inherit'].includes(style.value); };
    row.original = row.fields(); style.addEventListener('change', row.refresh); row.refresh(); return row;
  });
  let presetChanged = false;
  const preset = (label, styleFor) => el('button.btn.btn-ghost', { type: 'button', onclick: () => {
    presetChanged = true;
    for (const row of rows) { row.style.value = styleFor(row.side); row.width.value = '1'; row.color.value = 'auto'; row.refresh(); }
  } }, label);
  const error = el('p.field-error', { role: 'alert', hidden: true });
  const content = el('form.canvas-border-form', { onsubmit: e => {
    e.preventDefault();
    try {
      const patch = {};
      for (const row of rows) {
        if (!presetChanged && row.fields() === row.original) continue;
        if (row.style.value === 'inherit') { patch[row.side] = null; continue; }
        if (row.style.value === 'nil') { patch[row.side] = checkedCellBorder({ style: 'nil' }); continue; }
        if (!row.style.value || !row.width.value || !row.color.value) throw new Error(`Choose a style, width and color for the ${row.side} border.`);
        patch[row.side] = checkedCellBorder({ style: row.style.value, size: Number(row.width.value) * 8, color: row.color.value });
      }
      if (Object.keys(patch).length && apply(patch) === false) throw new Error('The cell borders could not be applied.');
      modal.close();
    } catch (e) { error.textContent = e.message; error.hidden = false; }
  } }, el('div.canvas-style-scroll', { style: { padding: '4px' } },
    el('div.row', { style: { flexWrap: 'wrap' } }, preset('Box each cell', () => 'single'), preset('Bottom only', side => side === 'bottom' ? 'single' : 'nil'), preset('No borders', () => 'nil'), preset('Inherit all', () => 'inherit')),
    el('div.canvas-border-scroll', {}, el('table.canvas-border-fields', {}, el('thead', {}, el('tr', {}, ...['Side', 'Style', 'Width (pt)', 'Color'].map(label => el('th', { scope: 'col' }, label)))),
      el('tbody', {}, ...rows.map(row => el('tr', {}, el('th', { scope: 'row' }, row.label), ...[row.style, row.width, row.color].map(input => el('td', {}, input))))))),
    el('p.field-hint', {}, 'Applies to each selected cell. No border clears a shared edge; Inherit restores the style or table setting. Use auto or a six-digit RGB color. Mixed fields stay unchanged until you edit that side.')), error,
    el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Cell borders', content, wide: true, onClose: () => {
    const root = modal.panel.closest('.modal-root'); root?.setAttribute('inert', ''); root?.setAttribute('aria-hidden', 'true'); onClose?.();
  } });
  modal.panel.classList.add('canvas-border-dialog', 'canvas-cell-border-dialog'); return modal;
}
