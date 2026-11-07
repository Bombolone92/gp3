import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';

export const cellShadingLabel = value => value === null ? 'Mixed' : value === 'auto' ? 'No fill' : value === 'foreground' ? 'Automatic foreground' : '#' + value;

export function openCellShading(value, apply, onClose) {
  const kind = el('select.input', { 'aria-label': 'Cell fill' },
    ...[['mixed', 'Mixed — keep'], ['color', 'Color'], ['auto', 'No fill'], ['foreground', 'Automatic foreground'], ['inherit', 'Inherit from table']].map(([value, label]) => el('option', { value, disabled: value === 'mixed' }, label)));
  kind.value = value === null ? 'mixed' : ['auto', 'foreground'].includes(value) ? value : 'color';
  const color = el('input.input', { type: 'color', value: kind.value === 'color' ? '#' + value : '#DDEEFF', 'aria-label': 'RGB cell fill' });
  const initialKind = kind.value, initialColor = color.value;
  const refresh = () => { color.disabled = kind.value !== 'color'; }; kind.addEventListener('change', refresh); refresh();
  const error = el('p.field-error', { role: 'alert', hidden: true });
  const content = el('form', { onsubmit: e => {
    e.preventDefault();
    try {
      if (kind.value !== 'mixed' && (kind.value !== initialKind || kind.value === 'color' && color.value !== initialColor)) {
        const chosen = kind.value === 'inherit' ? null : kind.value === 'color' ? color.value.slice(1).toUpperCase() : kind.value;
        if (apply(chosen) === false) throw new Error('The cell shading could not be applied.');
      }
      modal.close();
    } catch (e) { error.textContent = e.message; error.hidden = false; }
  } }, el('label.field', {}, el('span.field-label', {}, 'Cell fill'), kind),
  el('label.field', {}, el('span.field-label', {}, 'Color'), color),
  el('p.field-hint', {}, 'Applies to the selected cells, including their margins. No fill clears inherited shading; Inherit removes the direct override.'), error,
  el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Cell shading', content, onClose: () => {
    const root = modal.panel.closest('.modal-root'); root?.setAttribute('inert', ''); root?.setAttribute('aria-hidden', 'true'); onClose?.();
  } });
  return modal;
}
