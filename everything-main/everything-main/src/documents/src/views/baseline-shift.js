import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';

export function openBaselineShift(value, apply) {
  const input = el('input.input', { type: 'number', min: -200, max: 200, step: .5, required: true, value: value ?? '', placeholder: value === null ? 'Mixed' : '0', 'aria-label': 'Baseline shift (pt)' });
  const content = el('form', { onsubmit: e => { e.preventDefault(); const chosen = Number(input.value); modal.close(); apply(chosen); } },
    el('label.field', {}, el('span.field-label', {}, 'Baseline shift (pt)'), input),
    el('p.field-hint', {}, 'Positive values raise text; negative values lower it. Zero removes the shift. Font size stays the same.'),
    value === null ? el('p.field-hint', {}, 'The selection has mixed shifts. Choose a value for the whole selection.') : null,
    el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Baseline shift', content });
  return modal;
}
