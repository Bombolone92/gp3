import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';
import { BORDER_SIDES, BORDER_STYLES, checkedParagraphBorder, visibleParagraphBorders } from '../engine/paragraph-borders.js';

const names = { top: 'Top', left: 'Left', bottom: 'Bottom', right: 'Right', between: 'Between paragraphs' };
const fields = row => [row.style.value, row.width.value, row.space.value, row.color.value];
export const paragraphBorderLabel = value => value === null ? 'Mixed' : visibleParagraphBorders(value) ? 'Custom' : 'None';

/** The same per-side controls edit direct formatting and style declarations. */
export function paragraphBorderFields(values, inherit = false) {
  const rows = [], prefix = inherit ? 'Style ' : '';
  let reset = null;
  for (const [side, label] of Object.entries(names)) {
    const declarations = values.map(value => value?.[side]);
    const current = key => {
      const defaults = { style: inherit ? '' : 'none', size: 8, space: 2, color: 'auto' };
      const all = declarations.map(d => d?.[key] ?? defaults[key]);
      return all.every(value => value === all[0]) ? all[0] : '';
    };
    const style = el('select.input', { 'aria-label': `${prefix}${label} border style` },
      el('option', { value: '' }, inherit ? 'Inherit' : 'Mixed — keep'), ...Object.entries(BORDER_STYLES).map(([value, label]) => el('option', { value }, label)));
    style.value = current('style') === 'nil' ? 'none' : current('style');
    const width = el('input.input', { type: 'number', min: 0, max: 12, step: .125, value: current('size') === '' ? '' : current('size') / 8, placeholder: 'Mixed', 'aria-label': `${prefix}${label} border width (pt)` });
    const space = el('input.input', { type: 'number', min: 0, max: 31, step: 1, value: current('space'), placeholder: 'Mixed', 'aria-label': `${prefix}${label} border distance (pt)` });
    const color = el('input.input', { type: 'text', pattern: 'auto|#?[0-9a-fA-F]{6}', value: current('color'), placeholder: 'Mixed', 'aria-label': `${prefix}${label} border color`, title: 'auto or a six-digit RGB color' });
    const row = { side, label, style, width, space, color };
    row.refresh = () => { for (const input of [width, space, color]) input.disabled = !style.value || style.value === 'none'; };
    style.addEventListener('change', row.refresh); row.refresh();
    row.original = JSON.stringify(fields(row)); rows.push(row);
  }
  const preset = (label, enabled) => el('button.btn.btn-outline.btn-sm', { type: 'button', onclick: () => {
    reset = enabled;
    for (const row of rows) { row.style.value = enabled.includes(row.side) ? 'single' : 'none'; row.width.value = '1'; row.space.value = '2'; row.color.value = 'auto'; row.refresh(); }
  } }, label);
  const table = el('table.canvas-border-fields', {}, el('thead', {}, el('tr', {}, ...['Side', 'Style', 'Width (pt)', 'Distance (pt)', 'Color'].map(label => el('th', { scope: 'col' }, label)))),
    el('tbody', {}, ...rows.map(row => el('tr', {}, el('th', { scope: 'row' }, row.label), ...[row.style, row.width, row.space, row.color].map(input => el('td', {}, input))))));
  // In the style dialog the borders are one of its titled groups; on their own the dialog's title names them.
  const node = el(inherit ? 'section.canvas-style-section' : 'section', inherit ? { 'aria-label': 'Borders' } : {}, inherit && el('h3', {}, 'Borders'),
    el('div.canvas-border-presets', { role: 'group', 'aria-label': 'Border presets' }, el('span.field-label', { 'aria-hidden': 'true' }, 'Presets'),
      preset('Box', ['top', 'left', 'bottom', 'right']), preset('All borders', ['top', 'left', 'bottom', 'right', 'between']), preset('Bottom only', ['bottom']), preset('No borders', []),
      inherit && el('button.btn.btn-outline.btn-sm', { type: 'button', onclick: () => { reset = 'inherit'; for (const row of rows) { row.style.value = ''; row.refresh(); } } }, 'Inherit all borders')),
    el('div.canvas-border-scroll', {}, table),
    el('p.field-hint', {}, 'Use auto or a six-digit RGB color. Distance is the gap from text; dividers ignore it. Matching border sets join adjacent paragraphs.' + (inherit ? ' Choose Inherit to remove a side’s declaration.' : ' Mixed fields stay unchanged until you edit that side.')));
  const read = () => {
    const patch = reset === 'inherit' ? Object.fromEntries(BORDER_SIDES.map(side => [side, null])) : reset !== null ? { bar: { style: 'none' } } : {};
    for (const row of rows) {
      if (reset === null && row.original === JSON.stringify(fields(row))) continue;
      if (inherit && !row.style.value) { patch[row.side] = null; continue; }
      if (row.style.value === 'none') { patch[row.side] = checkedParagraphBorder({ style: 'none' }); continue; }
      if (!row.style.value || [row.width, row.space, row.color].some(input => input.value === '')) throw new Error(`Choose a style, width, distance and color for the ${row.label.toLowerCase()} border.`);
      patch[row.side] = checkedParagraphBorder({ style: row.style.value, size: Number(row.width.value) * 8, space: Number(row.space.value), color: row.color.value.replace(/^#/, '') });
    }
    return reset === 'inherit' && Object.values(patch).every(value => value === null) ? null : patch;
  };
  return { node, read };
}

export function openParagraphBorders(values, apply) {
  const fields = paragraphBorderFields(values), error = el('p.field-error', { role: 'alert', hidden: true });
  const content = el('form.canvas-border-form', { onsubmit: e => {
    e.preventDefault();
    try { if (apply(fields.read()) === false) throw new Error('These borders cannot fit the current page or cell. Reduce their width or distance, or increase the margins or indents.'); modal.close(); }
    catch (e) { error.textContent = e.message; error.hidden = false; }
  } }, el('div.canvas-style-scroll', {}, fields.node), error,
  el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Paragraph borders', content, wide: true, onClose: () => {
    const root = modal.panel.closest('.modal-root'); root?.setAttribute('inert', ''); root?.setAttribute('aria-hidden', 'true');
  } });
  modal.panel.classList.add('canvas-border-dialog');
  return modal;
}
