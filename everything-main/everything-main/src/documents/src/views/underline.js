import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';
import { UNDERLINE_STYLES } from '../engine/underlines.js';

export function openUnderline(format, apply) {
  const pattern = el('select.input', { 'aria-label': 'Underline pattern', required: true }, format.underlineStyle === null ? el('option', { value: '', disabled: true }, 'Mixed') : null,
    ...Object.entries(UNDERLINE_STYLES).map(([value, label]) => el('option', { value }, label)));
  pattern.value = format.underlineStyle ?? '';
  const automatic = el('input', { type: 'checkbox', checked: format.underlineColor === 'auto', 'aria-label': 'Automatic underline color' });
  const color = el('input.input', { type: 'color', value: format.underlineColor && format.underlineColor !== 'auto' ? '#' + format.underlineColor : '#000000', disabled: automatic.checked, 'aria-label': 'RGB underline color' });
  automatic.addEventListener('change', () => { color.disabled = automatic.checked; });
  const content = el('form', { onsubmit: e => { e.preventDefault(); const chosen = automatic.checked ? 'auto' : color.value.slice(1).toUpperCase(); modal.close(); apply({ underlineStyle: pattern.value, ...(chosen !== format.underlineColor ? { underlineColor: chosen } : {}) }); } },
    el('label.field', {}, el('span.field-label', {}, 'Pattern'), pattern), el('label.field', {}, el('span.field-label', {}, 'Color'), color), el('label.row', {}, automatic, 'Automatic'),
    el('p.field-hint', {}, 'Words only leaves spaces and tabs clear. Automatic follows the text color.'),
    format.underlineStyle === null || format.underlineColor === null ? el('p.field-hint', {}, 'The selection has mixed underlining. Choose a pattern and color for the whole selection.') : null,
    el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Underline', content }); return modal;
}
