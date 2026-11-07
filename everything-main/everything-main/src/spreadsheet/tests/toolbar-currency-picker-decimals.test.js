// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createToolbar } from '../src/ui/toolbar.js';
import { closeMenu } from '../src/ui/menu.js';

// The toolbar's currency picker changed the symbol alone, so a dollar cell whose two decimals a loaded file had
// spelled out became a yen cell showing ¥1,000.00, the very thing a yen cell no longer shows of itself.
afterEach(() => { closeMenu(); document.body.replaceChildren(); });

/** Open the number-format menu for a cell in `style`, then its currency list, and pick the currency named; the patches run. */
function pick(style, name) {
  const wb = new Workbook();
  const patches = [];
  const toolbar = createToolbar({
    wb, run: (cmd, arg) => patches.push([cmd, arg]), activeCell: () => null, style: () => style, active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId, grid: { editing: false }, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  toolbar.el.querySelector('.tb-fmt').click();
  [...document.querySelectorAll('[role^="menuitem"]')].find((b) => b.querySelector('.menu-label').textContent.startsWith('Currency symbol')).click();
  [...document.querySelectorAll('[role="menuitemradio"]')].find((b) => b.querySelector('.menu-label').textContent === name).click();
  closeMenu();
  document.body.replaceChildren();
  return patches;
}

it('picks a currency with its own decimals when the cell has the old currency\'s own', () => {
  // A dollar cell with the dollar's two decimals, spelled out as a loaded file spells them or not, becomes a yen cell with none.
  expect(pick({ fmt: 'currency', cur: 'USD', dec: 2 }, 'Japanese yen')).toEqual([['fmt', { fmt: 'currency', cur: 'JPY', dec: null }]]);
  expect(pick({ fmt: 'currency' }, 'Japanese yen')).toEqual([['fmt', { fmt: 'currency', cur: 'JPY', dec: null }]]);
  expect(pick({ fmt: 'currency' }, 'South Korean won')).toEqual([['fmt', { fmt: 'currency', cur: 'KRW', dec: null }]]);
  // And back: a yen cell with none becomes a dollar cell with two.
  expect(pick({ fmt: 'currency', cur: 'JPY', dec: 0 }, 'US dollar')).toEqual([['fmt', { fmt: 'currency', cur: null, dec: null }]]);
  expect(pick({ fmt: 'currency', cur: 'JPY' }, 'Euro')).toEqual([['fmt', { fmt: 'currency', cur: 'EUR', dec: null }]]);
});

it('keeps decimals chosen apart from the currency', () => {
  // A dollar without any, a yen with two, a Number's own.
  expect(pick({ fmt: 'currency', dec: 0 }, 'Japanese yen')).toEqual([['fmt', { fmt: 'currency', cur: 'JPY' }]]);
  expect(pick({ fmt: 'currency', cur: 'JPY', dec: 2 }, 'US dollar')).toEqual([['fmt', { fmt: 'currency', cur: null }]]);
  expect(pick({ fmt: 'number', dec: 3 }, 'Japanese yen')).toEqual([['fmt', { fmt: 'currency', cur: 'JPY' }]]);
});
