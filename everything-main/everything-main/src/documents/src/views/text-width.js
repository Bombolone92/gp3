import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';

export function openTextWidth(value, apply) {
  const input = el('input.input', { type: 'number', min: 1, max: 600, step: 1, required: true, value: value ?? '', placeholder: value === null ? 'Mixed' : '100', 'aria-label': 'Text width (%)' });
  const content = el('form', { onsubmit: e => { e.preventDefault(); const chosen = Number(input.value); modal.close(); apply(chosen); } },
    el('label.field', {}, el('span.field-label', {}, 'Text width (%)'), input),
    el('p.field-hint', {}, '100% restores normal character widths. Lower values compress letters; higher values stretch them. Font height and character spacing stay the same.'),
    value === null ? el('p.field-hint', {}, 'The selection has mixed text widths. Choose a percentage for the whole selection.') : null,
    el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Text width', content }); return modal;
}
