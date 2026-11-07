// @vitest-environment jsdom
import { beforeAll, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { CURRENCIES } from '../src/core/format.js';
import { codeColor } from '../src/core/numfmt.js';
import { negativeCode, negativeStyleFor, openFormatCellsDialog } from '../src/ui/formatcells.js';

beforeAll(() => {
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});

it.each(CURRENCIES.map(([cur]) => ({ cur })))('keeps $cur when creating and reading negative currency styles', ({ cur }) => {
  for (const neg of ['red', 'paren', 'redparen']) {
    for (const group of [true, false]) {
      const options = { category: 'currency', cur, dec: 3, group, neg };
      const code = negativeCode(options);
      expect(negativeStyleFor(code)).toEqual(options);
      expect(codeColor(-42.5, code)).toBe(neg.includes('red') ? '#ff0000' : null);
      expect(codeColor(42.5, code)).toBeNull();
    }
  }
});

function withDialog(wb, fn) {
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  const ctx = {
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), range: () => range,
    style: () => wb.getCell(id, 0, 0)?.s || {},
    run: (cmd, { patch }) => wb.applyStyle(id, range, patch),
    grid: { editing: false, focus() {} },
  };
  const modal = openFormatCellsDialog(ctx);
  const control = (label) => modal.panel.querySelector(`[aria-label="${label}"]`);
  const change = (label, value, event = 'change') => {
    control(label).value = value;
    control(label).dispatchEvent(new Event(event, { bubbles: true }));
  };
  const submit = () => modal.panel.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  try { fn({ panel: modal.panel, control, change, submit }); }
  finally { modal.close(); modal.panel.closest('.modal-root')?.remove(); }
}

it.each([['CAD', 'CA$'], ['CNY', 'CN¥'], ['NOK', 'NOK\u00a0']].flatMap(([cur, label]) =>
  ['red', 'paren', 'redparen'].map((neg) => ({ cur, label, neg })),
))('preserves $cur through applying $neg, reopening, editing precision, and returning to minus', ({ cur, label, neg }) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: -1234.5, s: { fmt: 'currency', cur, dec: 2, bold: true } } }]);
  wb.clearHistory();
  const shown = (digits) => neg.includes('paren') ? `(${label}1,234.${digits})` : `-${label}1,234.${digits}`;
  withDialog(wb, ({ panel, control, change, submit }) => {
    expect(control('Currency').value).toBe(cur);
    change('Negative numbers', neg);
    expect(panel.querySelector('.numfmt-preview').textContent).toBe(`Preview: ${shown('50')}`);
    submit();
  });
  expect(wb.getDisplay(id, 0, 0)).toBe(shown('50'));
  withDialog(wb, ({ control, change, submit }) => {
    expect(control('Category').value).toBe('currency');
    expect(control('Currency').value).toBe(cur);
    expect(control('Negative numbers').value).toBe(neg);
    change('Decimal places', '3', 'input');
    submit();
  });
  expect(wb.getDisplay(id, 0, 0)).toBe(shown('500'));
  wb.undo();
  expect(wb.getDisplay(id, 0, 0)).toBe(shown('50'));
  wb.redo();
  expect(wb.getDisplay(id, 0, 0)).toBe(shown('500'));
  withDialog(wb, ({ control, change, submit }) => {
    expect(control('Currency').value).toBe(cur);
    change('Negative numbers', 'minus');
    submit();
  });
  expect(wb.getCell(id, 0, 0).s).toMatchObject({ fmt: 'currency', cur, dec: 3, bold: true });
  expect(wb.getValue(id, 0, 0)).toBe(-1234.5);
  expect(wb.getDisplay(id, 0, 0)).toBe(`-${label}1,234.500`);
});

it.each([['CHF', 'CHF'], ['zł', 'PLN'], ['₺', 'TRY'], ['kr', 'SEK'], ['$', 'USD'], ['¥', 'JPY']])(
  'continues recognizing older negative currency formats using %s', (label, cur) => {
    expect(negativeStyleFor(`"${label}"0.00;[Red]("${label}"0.00)`)).toEqual({
      category: 'currency', cur, dec: 2, group: false, neg: 'redparen',
    });
  },
);
