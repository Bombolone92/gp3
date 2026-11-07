// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createToolbar, ACCOUNTING_CODE, FRACTION_CODE, DURATION_CODE } from '../src/ui/toolbar.js';
import { closeMenu } from '../src/ui/menu.js';
import { Workbook } from '../src/core/workbook.js';

// The Accounting, Fraction and Duration presets are stored as a custom format with their code, so the
// number-format menu checked the preset and "Custom format…" both, in one group of radio items, and
// spelled the preset's code after the Custom item. Only the entry the cell's format is lights up.
afterEach(() => { closeMenu(); document.body.replaceChildren(); });

function openMenuFor(style) {
  const wb = new Workbook();
  const toolbar = createToolbar({
    wb, run() {}, activeCell: () => null, style: () => style, active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId, grid: { editing: false }, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  toolbar.el.querySelector('.tb-fmt').click();
  const items = [...document.querySelectorAll('[role="menuitemradio"]')];
  return {
    checked: items.filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.querySelector('.menu-label').textContent),
    custom: items.find((b) => b.querySelector('.menu-label').textContent.startsWith('Custom format')).querySelector('.menu-label').textContent,
  };
}

describe('the number-format menu', () => {
  it.each([['Accounting', ACCOUNTING_CODE], ['Fraction', FRACTION_CODE], ['Duration', DURATION_CODE]])('checks only the %s preset for its code', (label, code) => {
    const { checked, custom } = openMenuFor({ fmt: 'custom', code });
    expect(checked).toEqual([label]);
    expect(custom).toBe('Custom format…');
  });

  it('checks Custom format, with the code, for a code of the user’s own', () => {
    const { checked, custom } = openMenuFor({ fmt: 'custom', code: '0.0 "kg"' });
    expect(checked).toEqual(['Custom format… (0.0 "kg")']);
    expect(custom).toBe('Custom format… (0.0 "kg")');
  });

  it('checks one plain entry for a built-in format', () => {
    expect(openMenuFor({ fmt: 'percent' }).checked).toEqual(['Percentage']);
    expect(openMenuFor({}).checked).toEqual(['General']);
  });
});
