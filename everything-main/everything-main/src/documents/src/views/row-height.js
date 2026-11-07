import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';

export const rowHeightLabel = height => !height ? 'Mixed' : height.rule === 'auto' ? 'Automatic' : `${height.rule === 'exact' ? 'Exactly' : 'At least'} ${height.value / 20} pt`;

export function openRowHeight(height, apply, onClose) {
  const mode = el('select.input', { 'aria-label': 'Row height setting' }, ...[['mixed', 'Mixed — keep'], ['auto', 'Automatic'], ['atLeast', 'At least'], ['exact', 'Exactly'], ['inherit', 'Inherit from table style']].map(([value, label]) => el('option', { value, disabled: value === 'mixed' }, label)));
  mode.value = height?.rule || 'mixed';
  const size = el('input.input', { type: 'number', min: 0, max: 1584, step: .05, value: height ? height.value / 20 : '', placeholder: 'Mixed', 'aria-label': 'Minimum row height (pt)' });
  const label = el('span.field-label');
  const refresh = () => {
    size.disabled = !['atLeast', 'exact', 'mixed'].includes(mode.value); size.required = ['atLeast', 'exact'].includes(mode.value);
    size.min = mode.value === 'exact' ? .05 : 0;
    size.setAttribute('aria-label', mode.value === 'exact' ? 'Exact row height (pt)' : 'Minimum row height (pt)');
    label.textContent = mode.value === 'exact' ? 'Exact height (pt)' : 'Minimum height (pt)';
  };
  mode.addEventListener('change', refresh); size.addEventListener('input', () => { if (mode.value !== 'exact') mode.value = 'atLeast'; refresh(); }); refresh();
  const fields = () => JSON.stringify([mode.value, size.value]), original = fields(), error = el('p.field-error', { role: 'alert', hidden: true });
  const content = el('form', { onsubmit: e => {
    e.preventDefault();
    try {
      if (fields() !== original && mode.value !== 'mixed') {
        const twips = ['atLeast', 'exact'].includes(mode.value) ? Number(size.value) * 20 : 0;
        if (!Number.isFinite(twips) || Math.abs(twips - Math.round(twips)) > 1e-6) throw new Error('Use twentieth-point steps for row height.');
        if (apply(mode.value === 'inherit' ? null : { rule: mode.value, value: Math.round(twips) }) === false) throw new Error('This row height cannot fit the document. Reduce the height, especially for repeated headers.');
      }
      modal.close();
    } catch (e) { error.textContent = e.message; error.hidden = false; }
  } }, el('label.field', {}, el('span.field-label', {}, 'Height setting'), mode),
  el('label.field', {}, label, size),
  el('p.field-hint', {}, 'Applies to every selected row, including merged cells. Minimum heights grow to fit. Exact heights hide overflow without deleting it; use Text mode to edit hidden text.'), error,
  el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Row height', content, onClose: () => { const root = modal.panel.closest('.modal-root'); root?.setAttribute('inert', ''); root?.setAttribute('aria-hidden', 'true'); onClose?.(); } });
  return modal;
}
