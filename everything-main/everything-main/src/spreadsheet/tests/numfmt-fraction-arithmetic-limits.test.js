// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { formatValue } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

// TEXT results measured in desktop Excel around coefficient-product boundaries. A bound
// on the final numerator would incorrectly reject several of these fractions.
const native = [
  [1073741822.5, '2147483645/2'],
  [1073741823.5, '2147483647/2'],
  [1073741824.5, '1073741825/1'],
  [715827881 + 1 / 3, '2147483644/3'],
  [715827882 + 2 / 3, '2147483648/3'],
  [715827883 + 1 / 3, '2147483650/3'],
  [429496729.2, '2147483646/5'],
  [429496729.8, '2147483649/5'],
  [429496730.2, '429496730/1'],
  [429496730.8, '2147483654/5'],
  [2147483646, '2147483646/1'],
  [2147483646.49, '2147483646/1'],
  [2147483646.5, '2147483647/1'],
  [2147483646.75, '2147483647/1'],
];

it.each(native)('bounds coefficient products, not the completed numerator: %s', (value, expected) => {
  for (const width of [1, 2, 7, 12]) for (const sign of [1, -1]) {
    const [n, d] = expected.split('/');
    expect(formatWithCode(value * sign, '?/' + '?'.repeat(width)))
      .toBe((sign < 0 ? '-' : '') + n + '/' + d.padEnd(width));
  }
});

it('rejects an initial improper magnitude at the limit while allowing large mixed whole parts', () => {
  for (const value of [2147483647, 2147483647.5, 2147483648, 1e10, 1e20]) {
    for (const sign of [1, -1]) {
      expect(formatWithCode(sign * value, '?/???????')).toBe('#####');
      expect(formatWithCode(sign * value, '?/???????', { overflow: null })).toBeNull();
    }
  }
  expect(formatWithCode(2147483647.5, '# ?/?')).toBe('2147483647 1/2');
  expect(formatWithCode(-2147483647.5, '# ?/?')).toBe('-2147483647 1/2');
  expect(formatWithCode(1e20, '# ?/?')).toBe('100000000000000000000    ');
  expect(formatWithCode(0, '?/?')).toBe('0/1');
  expect(formatWithCode(Number.MIN_VALUE, '?/?')).toBe('0/1');
});

it('applies scaling and selected sections before checking representability', () => {
  expect(formatWithCode(21474836.46, '?/?%')).toBe('2147483646/1%');
  expect(formatWithCode(21474836.47, '?/?%')).toBe('#####');
  expect(formatWithCode(-1073741824.5, '?/?;(?/?)')).toBe('(1073741825/1)');
  expect(formatWithCode(2147483647, '[>=2147483647]"large";?/?')).toBe('large');
});

it('distinguishes TEXT errors from literal hashes and preserves precise values through interchange', async () => {
  const cases = [
    [1073741823.5, '?/???????', '2147483647/2      '],
    [715827883 + 1 / 3, '?/???????', '2147483650/3      '],
    [1073741824.5, '?/?', '1073741825/1'],
    [2147483647, '?/?', null], [-2147483647, '?/?', null],
    [2147483647.5, '# ?/?', '2147483647 1/2'],
    [2147483647, '"#####"', '#####'],
    [-2147483647, '?/?;"#####"', '#####'],
    [0, '[>1]?/?;[<0]?/?', null],
    [-1, 'yyyy-mm-dd', null], [2958466, 'hh:mm', null],
    [1, '"#####";yyyy-mm-dd', '#####'],
  ];
  const wb = new Workbook(), id = wb.activeSheetId;
  cases.forEach(([value, code, text], r) => {
    wb.setInput(id, r, 0, String(value));
    wb.applyStyle(id, { r1: r, r2: r, c1: 0, c2: 0 }, { fmt: 'custom', code });
    wb.setInput(id, r, 1, `=TEXT(A${r + 1},"${code.replaceAll('"', '""')}")`);
    wb.setInput(id, r, 2, `=IFERROR(B${r + 1},"overflow")`);
    expect(wb.getDisplay(id, r, 0)).toBe(text ?? '#####');
    expect(wb.getValue(id, r, 1)).toEqual(text ?? { error: '#VALUE!' });
    expect(wb.getValue(id, r, 2)).toBe(text ?? 'overflow');
    const cell = { v: value, f: null, s: { fmt: 'custom', code } };
    const html = cellsToHtml([[text ?? '#####']], [[cell]], null, [[value]]);
    expect(parseHtmlClipboard(html).cells).toEqual([[cell]]);
    const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(external).rows)[0].cell;
    expect(pasted.v).toBe(value);
    expect(formatValue(pasted.v, pasted.s)).toBe(text ?? '#####');
    if (code.includes('/')) expect(pasted.s.code).toBe(code);
  });
  wb.setInput(id, 3, 0, '2147483646'); expect(wb.getValue(id, 3, 1)).toBe('2147483646/1');
  wb.undo(); expect(wb.getValue(id, 3, 1)).toEqual({ error: '#VALUE!' });
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  cases.forEach(([value, code, text], r) => {
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(value);
    if (code.includes('/')) expect(restored.styleAt(restored.activeSheetId, r, 0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId, r, 0)).toBe(text ?? '#####');
    expect(restored.getValue(restored.activeSheetId, r, 1)).toEqual(text ?? { error: '#VALUE!' });
  });
});
