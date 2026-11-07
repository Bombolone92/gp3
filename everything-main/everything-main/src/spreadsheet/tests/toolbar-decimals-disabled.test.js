// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createToolbar } from '../src/ui/toolbar.js';
import { Workbook } from '../src/core/workbook.js';

// The More and Fewer decimal places buttons looked enabled on date, time, text and custom cells, where the
// command returns without doing anything; the menu bar greys the same commands there. Both agree now.
afterEach(() => document.body.replaceChildren());

function buttons(style, editing = false) {
  const wb = new Workbook();
  const toolbar = createToolbar({
    wb, run() {}, activeCell: () => null, style: () => style, active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId, grid: { editing }, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  return [toolbar.el.querySelector('[data-cmd="dec"][data-arg="-1"]').disabled, toolbar.el.querySelector('[data-cmd="dec"][data-arg="1"]').disabled];
}

it('greys the decimal-place buttons for formats without decimals to step', () => {
  for (const fmt of ['date', 'time', 'datetime', 'text', 'custom']) expect(buttons({ fmt }), fmt).toEqual([true, true]);
});

it('keeps them live for numbers, currency, percent, scientific and Automatic cells, but not while a cell is edited', () => {
  for (const style of [{}, { fmt: 'number' }, { fmt: 'currency' }, { fmt: 'percent' }, { fmt: 'scientific' }]) expect(buttons(style), style.fmt).toEqual([false, false]);
  expect(buttons({ fmt: 'number' }, true)).toEqual([true, true]);
});
