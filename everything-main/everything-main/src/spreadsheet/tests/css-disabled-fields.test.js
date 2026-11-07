import { expect, it } from 'vitest';
import { stylesheet, declared } from './helpers/css.js';

// The shared reset makes every field inherit its colour, which overrides the browser's grey for a
// disabled one, so the range field of a table being edited, or a sort dialog's greyed select,
// looked ready to type in. Disabled fields fade the way disabled menu items do.
it('dims disabled text fields and selects', () => {
  expect(declared(stylesheet('base.css'), 'input').color).toBe('inherit');
  const css = stylesheet('components.css');
  const input = declared(css, '.input:disabled');
  expect(input.opacity).toBe('0.45');
  expect(input.cursor).toBe('default');
  expect(declared(css, '.select:disabled')).toEqual(input);
  expect(declared(css, '.menu-item[disabled]').opacity).toBe(input.opacity);
});
