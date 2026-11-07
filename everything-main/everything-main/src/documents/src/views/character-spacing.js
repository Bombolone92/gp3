import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';
import { CHARACTER_SPACING_LIMIT } from '../engine/character-spacing.js';

export function openCharacterSpacing(value, apply) {
  const input = el('input.input', { type: 'number', min: -CHARACTER_SPACING_LIMIT, max: CHARACTER_SPACING_LIMIT, step: .05, required: true, value: value ?? '', placeholder: value === null ? 'Mixed' : '0', 'aria-label': 'Character spacing (pt)' });
  const content = el('form', { onsubmit: e => { e.preventDefault(); const chosen = Number(input.value); modal.close(); apply(chosen); } },
    el('label.field', {}, el('span.field-label', {}, 'Character spacing (pt)'), input),
    el('p.field-hint', {}, 'Positive values expand text; negative values condense it. Zero restores normal spacing. Font size stays the same.'),
    value === null ? el('p.field-hint', {}, 'The selection has mixed spacing. Choose a value for the whole selection.') : null,
    el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Character spacing', content }); return modal;
}
