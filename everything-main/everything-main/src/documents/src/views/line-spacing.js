import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';
import { checkedLineSpacing } from '../engine/line-spacing.js';

export function openLineSpacing(format, apply, onClose) {
  const mode = el('select.input', { 'aria-label': 'Line spacing rule' }, ...[['mixed', 'Mixed — keep'], ['auto', 'Multiple'], ['exact', 'Exactly'], ['atLeast', 'At least'], ['inherit', 'Inherit from style']].map(([value, label]) => el('option', { value, disabled: value === 'mixed' }, label)));
  mode.value = format.lineRule || 'mixed';
  const size = el('input.input', { type: 'number', value: format.lineSpacing ?? '', placeholder: 'Mixed', 'aria-label': 'Line spacing amount' });
  const label = el('span.field-label'), error = el('p.field-error', { role: 'alert', hidden: true });
  const refresh = () => {
    const multiple = mode.value === 'auto';
    size.disabled = ['mixed', 'inherit'].includes(mode.value);
    // An unchanged mixed amount is a no-op, including when the rule is common.
    size.required = !size.disabled && (format.lineSpacing != null || mode.value !== format.lineRule);
    size.min = 0; size.max = multiple ? 5 : 600; size.step = multiple ? 'any' : .05;
    label.textContent = multiple ? 'Multiple (lines)' : 'Height (pt)';
  };
  let previousMode = mode.value;
  mode.addEventListener('change', () => {
    if (!['mixed', 'inherit'].includes(mode.value) && (mode.value === 'auto') !== (previousMode === 'auto')) size.value = mode.value === 'auto' ? 1 : 18;
    if (size.value === '' && !['mixed', 'inherit'].includes(mode.value)) size.value = mode.value === 'auto' ? 1 : 18;
    previousMode = mode.value; refresh();
  }); refresh();
  const fields = () => JSON.stringify([mode.value, size.value]), original = fields();
  const content = el('form', { onsubmit: e => {
    e.preventDefault();
    try {
      if (fields() !== original && mode.value !== 'mixed') {
        const value = mode.value === 'inherit' ? null : checkedLineSpacing({ lineRule: mode.value, lineSpacing: Number(size.value) });
        if (apply(value) === false) throw new Error('This line spacing cannot fit the document. Reduce the amount.');
      }
      modal.close();
    } catch (e) { error.textContent = e.message; error.hidden = false; }
  } }, el('label.field', {}, el('span.field-label', {}, 'Spacing rule'), mode), el('label.field', {}, label, size),
  el('p.field-hint', {}, 'Minimum heights grow to fit text and pictures. Exact heights can clip their contents. Zero points uses the natural line height. Changes apply to the selected paragraphs.'), error,
  el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Line spacing', content, onClose: () => { const root = modal.panel.closest('.modal-root'); root?.setAttribute('inert', ''); root?.setAttribute('aria-hidden', 'true'); onClose?.(); } });
  return modal;
}
