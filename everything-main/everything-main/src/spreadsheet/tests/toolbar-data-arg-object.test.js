// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createToolbar } from '../src/ui/toolbar.js';
import { Workbook } from '../src/core/workbook.js';

// The Percent and Currency buttons pass the format command an object ({ fmt, toggle: true }) so that
// only they press the format on and off; written into data-arg as is, the object read "[object Object]".
// The attribute now names the argument's text, so the buttons can still be found as data-arg="percent".
function setup() {
  const wb = new Workbook();
  const toolbar = createToolbar({
    wb, run() {}, activeCell: () => null, style: () => ({}), active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId,
    grid: { editing: false }, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  return toolbar;
}

it('names an object argument by its text in data-arg', () => {
  const toolbar = setup();
  expect(toolbar.el.querySelector('.tb-btn[data-cmd="fmt"][data-arg="percent"]')?.getAttribute('aria-label')).toBe('Format as percent');
  expect(toolbar.el.querySelector('.tb-btn[data-cmd="fmt"][data-arg="currency"]')?.getAttribute('aria-label')).toBe('Format as currency');
  expect(toolbar.el.querySelector('[data-arg="[object Object]"]')).toBeNull();
  // Plain arguments are written as before: a number, a string, and nothing for none.
  expect(toolbar.el.querySelector('.tb-btn[data-cmd="dec"][data-arg="1"]')).toBeTruthy();
  expect(toolbar.el.querySelector('.tb-btn[data-cmd="align"][data-arg="left"]')).toBeTruthy();
  expect(toolbar.el.querySelector('.tb-btn[data-cmd="bold"]').dataset.arg).toBe('');
});
