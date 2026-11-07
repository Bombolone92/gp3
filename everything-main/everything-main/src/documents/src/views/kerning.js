import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';
import { KERNING_LIMIT } from '../engine/kerning.js';

export function openKerning(value, apply) {
  const input = el('input.input', { type: 'number', min: 0, max: KERNING_LIMIT, step: .5, required: true, value: value ?? '', placeholder: value === null ? 'Mixed' : '0', 'aria-label': 'Kerning from (pt)' });
  const content = el('form', { onsubmit: e => { e.preventDefault(); const chosen = Number(input.value); modal.close(); apply(chosen); } },
    el('label.field', {}, el('span.field-label', {}, 'Kerning from (pt)'), input),
    el('p.field-hint', {}, 'Kerning adjusts the spacing of letter pairs such as AV. Enter the smallest font size to kern, or 0 to turn it off. The text keeps its current font size.'),
    value === null ? el('p.field-hint', {}, 'The selection has mixed kerning thresholds. Choose one value for the whole selection.') : null,
    el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Kerning', content }); return modal;
}
