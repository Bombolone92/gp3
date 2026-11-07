import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';
import { CELL_ALIGNMENTS } from '../engine/cell-alignment.js';

export function openCellAlignment(value, apply, onClose) {
  const choices = [['mixed', 'Mixed — keep'], ['inherit', 'Inherit from table style'], ...Object.entries(CELL_ALIGNMENTS)];
  const select = el('select.input', { 'aria-label': 'Cell vertical alignment' }, ...choices.map(([id, label]) => el('option', { value: id, selected: id === (value ?? 'mixed'), disabled: id === 'mixed' }, label)));
  const original = select.value, error = el('p.field-error', { role: 'alert', hidden: true });
  const content = el('form', { onsubmit: e => {
    e.preventDefault();
    try {
      if (select.value !== original && apply(select.value === 'inherit' ? null : select.value) === false) throw new Error('The cell alignment could not be applied.');
      modal.close();
    } catch (e) { error.textContent = e.message; error.hidden = false; }
  } }, el('label.field', {}, el('span.field-label', {}, 'Vertical alignment'), select),
  el('p.field-hint', {}, 'Applies to the selected cells. Paragraph alignment and spacing stay unchanged.'), error,
  el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Cell alignment', content, onClose: () => { const root = modal.panel.closest('.modal-root'); root?.setAttribute('inert', ''); root?.setAttribute('aria-hidden', 'true'); onClose?.(); } });
  return modal;
}
