import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';
import { CELL_MARGIN_SIDES } from '../engine/cell-margins.js';

export function cellMarginLabel(cells) {
  return CELL_MARGIN_SIDES.every(side => cells.every(cell => cell.margins[side] === cells[0]?.margins[side])) ? 'Custom' : 'Mixed';
}

export function openCellMargins(cells, apply, onClose) {
  const rows = CELL_MARGIN_SIDES.map(side => {
    const label = side[0].toUpperCase() + side.slice(1), common = cells.every(cell => cell.margins[side] === cells[0].margins[side]);
    const mode = el('select.input', { 'aria-label': `${label} cell margin setting` }, el('option', { value: 'mixed', disabled: true }, 'Mixed — keep'), el('option', { value: 'custom' }, 'Custom'), el('option', { value: 'inherit' }, 'Inherit'));
    mode.value = common ? 'custom' : 'mixed';
    const width = el('input.input', { type: 'number', min: 0, max: 1584, step: .05, value: common ? cells[0].margins[side] / 20 : '', placeholder: 'Mixed', 'aria-label': `${label} cell margin (pt)` });
    const refresh = () => { width.disabled = mode.value === 'inherit'; };
    mode.addEventListener('change', refresh); width.addEventListener('input', () => { mode.value = 'custom'; });
    const fields = () => JSON.stringify([mode.value, width.value]); return { side, label, mode, width, refresh, fields, original: fields() };
  });
  let presetChanged = false;
  const preset = (label, inherit) => el('button.btn.btn-ghost', { type: 'button', onclick: () => {
    presetChanged = true;
    for (const row of rows) { row.mode.value = inherit ? 'inherit' : 'custom'; if (!inherit) row.width.value = '0'; row.refresh(); }
  } }, label);
  const error = el('p.field-error', { role: 'alert', hidden: true });
  const content = el('form.canvas-border-form', { onsubmit: e => {
    e.preventDefault();
    try {
      const patch = {};
      for (const row of rows) {
        if (!presetChanged && row.fields() === row.original) continue;
        if (row.mode.value === 'inherit') { patch[row.side] = null; continue; }
        if (row.mode.value === 'mixed' || row.width.value === '') throw new Error(`Enter a margin for the ${row.side} side or choose Inherit.`);
        const twips = Number(row.width.value) * 20;
        if (!Number.isFinite(twips) || Math.abs(twips - Math.round(twips)) > 1e-6) throw new Error('Use twentieth-point steps for cell margins.');
        patch[row.side] = Math.round(twips);
      }
      if (Object.keys(patch).length && apply(patch) === false) throw new Error('These margins leave too little room for the cell contents. Reduce the margins or widen the table.');
      modal.close();
    } catch (e) { error.textContent = e.message; error.hidden = false; }
  } }, el('div.canvas-style-scroll', { style: { padding: '4px' } },
    el('div.row', {}, preset('No padding', false), preset('Inherit all', true)),
    el('div.canvas-border-scroll', {}, el('table.canvas-border-fields', {}, el('thead', {}, el('tr', {}, ...['Side', 'Setting', 'Margin (pt)'].map(label => el('th', { scope: 'col' }, label)))),
      el('tbody', {}, ...rows.map(row => el('tr', {}, el('th', { scope: 'row' }, row.label), el('td', {}, row.mode), el('td', {}, row.width)))))),
    el('p.field-hint', {}, 'Applies inside each selected cell. Inherit restores the table or style margin. Mixed values stay unchanged until edited. Larger margins can wrap text and add pages.')), error,
    el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Cell margins', content, onClose: () => { const root = modal.panel.closest('.modal-root'); root?.setAttribute('inert', ''); root?.setAttribute('aria-hidden', 'true'); onClose?.(); } });
  return modal;
}
