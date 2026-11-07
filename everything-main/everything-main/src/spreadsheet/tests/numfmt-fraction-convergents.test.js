import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const cases = [
  [.06, '?/?', '0/1'], [-.06, '# ?/?', '-0    '],
  [1.06, '# ?/?', '1    '], [.7, '?/?', '2/3'],
  [.7, '# ?/?', ' 2/3'], [-.7, '# ?/?;(# ?/?)', '( 2/3)'],
  [.007, '?/?%', '5/7%'], [.006, '?/??', '0/1 '],
  [.0006, '?/???', '0/1  '], [.06, '?/9', '1/9'],
  [.41421356237, '?/????', '2378/5741'],
  [.41421356237, '?/?????', '33461/80782'],
  [Math.PI, '?/?????', '312689/99532'],
  [2.71828, '?/????', '26930/9907'],
  [.000008, '?/?????', '0/1    '],
  [.00000008, '?/???????', '0/1      '],
  [1 / 123456789, '?/????????', '0/1       '],
  [.000008, '?/??????', '1/125000'],
];

it.each(cases)('uses convergents with scaling, sections and whole parts: %s %s', (value, code, text) => {
  expect(formatWithCode(value, code)).toBe(text);
});

it('keeps values and formulas through edits, undo, and native XLSX round trips', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  cases.forEach(([value, code], r) => {
    wb.setInput(id, r, 0, String(value));
    wb.applyStyle(id, { r1: r, r2: r, c1: 0, c2: 0 }, { fmt: 'custom', code });
    wb.setInput(id, r, 1, `=TEXT(A${r + 1},"${code}")`);
  });
  wb.setInput(id, 0, 0, '.7');
  expect(wb.getDisplay(id, 0, 0)).toBe('2/3');
  expect(wb.getValue(id, 0, 1)).toBe('2/3');
  wb.undo();
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const raw = X.read(bytes, { type: 'array', cellNF: true });
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  cases.forEach(([value, code, text], r) => {
    expect(raw.Sheets[raw.SheetNames[0]][`A${r + 1}`]).toMatchObject({ v: value, z: code });
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(value);
    expect(restored.getDisplay(restored.activeSheetId, r, 0)).toBe(text);
    expect(restored.getValue(restored.activeSheetId, r, 1)).toBe(text);
  });
});

it('retains zero and finite output at floating-point and placeholder limits', () => {
  for (const digits of [1, 2, 4, 12, 400]) {
    expect(formatWithCode(Number.MIN_VALUE, '?/' + '?'.repeat(digits))).toBe('0/' + '1'.padEnd(digits));
    expect(formatWithCode(0, '?/' + '?'.repeat(digits))).toBe('0/' + '1'.padEnd(digits));
  }
});
