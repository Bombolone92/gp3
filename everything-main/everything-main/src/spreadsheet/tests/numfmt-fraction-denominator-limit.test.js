// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

// Calculated and saved in desktop Excel. The seven-digit numerical ceiling
// does not shorten the format code or the spaces reserved by its placeholders.
const native = [
  [1 / 9999998, '1/9999998'], [1 / 9999999, '1/9999999'],
  [1e-7, '0/1'], [1 / 10000001, '0/1'], [1 / 123456789, '0/1'],
  [Math.PI, '5419351/1725033'], [Math.E, '14665106/5394991'],
  [Math.SQRT2 - 1, '2744210/6625109'], [1.23456789012345, '10973932/8888885'],
];

it.each(native)('bounds denominator precision independently of padding for %s', (value, expected) => {
  const [n, d] = expected.split('/');
  for (const width of [7, 8, 9, 12, 253, 400]) {
    for (const sign of [1, -1]) {
      const prefix = sign < 0 && Number(n) ? '-' : '';
      expect(formatWithCode(sign * value, '?/' + '?'.repeat(width))).toBe(prefix + n + '/' + d.padEnd(width));
      expect(formatWithCode(sign * value, '#/' + '#'.repeat(width))).toBe(prefix + expected);
    }
  }
});

it('retains shorter bounds, mixed parts, percentage scaling and explicit denominators', () => {
  expect(formatWithCode(1 / 9999999, '?/??????')).toBe('0/1     ');
  for (const width of [7, 8, 12]) {
    const padding = ' '.repeat(width - 7), den = '?'.repeat(width);
    expect(formatWithCode(.01 / 9999999, `?/${den}%`)).toBe(`1/9999999${padding}%`);
    expect(formatWithCode(3 + 1 / 9999999, `# ?/${den}`)).toBe(`3 1/9999999${padding}`);
    expect(formatWithCode(-Math.PI, `?/${den};(?/${den})`)).toBe(`(5419351/1725033${padding})`);
  }
  expect(formatWithCode(1 / 8192, '?/8192')).toBe('1/8192');
  expect(formatWithCode(2.75, '# ?/16')).toBe('2 12/16');
});

it('preserves precise values and full codes through TEXT, clipboard, edits and native XLSX', async () => {
  const wb = new Workbook(), id = wb.activeSheetId, code = '?/' + '?'.repeat(12);
  const values = [1 / 123456789, Math.PI, -Math.E];
  values.forEach((value, r) => {
    wb.setInput(id, r, 0, String(value));
    wb.applyStyle(id, { r1: r, r2: r, c1: 0, c2: 0 }, { fmt: 'custom', code });
    wb.setInput(id, r, 1, `=TEXT(A${r + 1},"${code}")`);
  });
  const expected = ['0/1           ', '5419351/1725033     ', '-14665106/5394991     '];
  values.forEach((value, r) => {
    expect(wb.getDisplay(id, r, 0)).toBe(expected[r]);
    expect(wb.getValue(id, r, 1)).toBe(expected[r]);
    const cell = { v: value, f: null, s: { fmt: 'custom', code } };
    const html = cellsToHtml([[expected[r]]], [[cell]], null, [[value]]);
    expect(parseHtmlClipboard(html).cells).toEqual([[cell]]);
    const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const copied = cellsFromHtmlRows(parseHtmlClipboard(external).rows)[0].cell;
    expect(copied.v).toBe(value);
    expect(copied.s.code).toBe(code);
  });
  wb.setInput(id, 0, 0, '.75'); expect(wb.getValue(id, 0, 1)).toBe('3/4           '); wb.undo();
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  values.forEach((value, r) => {
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(value);
    expect(restored.styleAt(restored.activeSheetId, r, 0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId, r, 0)).toBe(expected[r]);
    expect(restored.getValue(restored.activeSheetId, r, 1)).toBe(expected[r]);
  });
});
