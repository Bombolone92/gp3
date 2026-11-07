import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

async function external(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'unicode-comparison.xlsx');
}

it('preserves source text, live comparisons and conditional expression fills through native-only saves', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  const pairs = [['Straße', 'STRASSE'], ['ᾀ', 'ἀι'], ['ab', 'a\u200bb'], ['ab', 'ab\u200b'], ['ı', 'I']];
  const expected = [true, false, true, false, false];
  for (const [r, [a, b]] of pairs.entries()) {
    wb.setCells(id, [{ r, c: 0, cell: { v: a } }, { r, c: 1, cell: { v: b } }]);
    wb.setInput(id, r, 2, `=A${r + 1}=B${r + 1}`);
  }
  wb.addRule(id, { range: { r1: 0, c1: 0, r2: 4, c2: 0 }, type: 'formula', value: 'A1=B1', style: { bg: '#aabbcc' } });
  const check = () => {
    for (const [r, [a, b]] of pairs.entries()) {
      expect(wb.getValue(id, r, 0)).toBe(a);
      expect(wb.getValue(id, r, 1)).toBe(b);
      expect(wb.getValue(id, r, 2)).toBe(expected[r]);
      expect(wb.conditionalStyle(id, r, 0)?.bg === '#aabbcc').toBe(expected[r]);
    }
  };
  check();
  for (let pass = 0; pass < 2; pass++) { wb = await external(wb); id = wb.activeSheetId; check(); }
  wb.setInput(id, 0, 1, 'STRASZE');
  expect(wb.getValue(id, 0, 2)).toBe(false);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 4, c2: 2 }), 10, 0, { r: 0, c: 0 });
  wb = await external(wb); id = wb.activeSheetId;
  expect(wb.getCell(id, 10, 2).f).toBe('A11=B11');
  expect(wb.getValue(id, 10, 2)).toBe(true);
});

it('preserves compatibility-prefix distinctions in formulas, criteria and conditional formatting', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  const values = ['x ', 'x\u00a0', 'x \u200b'];
  for (const [r, v] of values.entries()) {
    wb.setCells(id, [{ r, c: 0, cell: { v } }]);
    wb.setInput(id, r, 1, `=A${r + 1}=$A$3`);
    wb.setInput(id, r, 2, `=COUNTIF($A$1:$A$3,A${r + 1})`);
  }
  wb.addRule(id, { range: { r1: 0, c1: 0, r2: 2, c2: 0 }, type: 'formula', value: 'A1=$A$3', style: { bg: '#aabbcc' } });
  const check = () => {
    for (const [r, v] of values.entries()) {
      expect(wb.getValue(id, r, 0)).toBe(v);
      expect(wb.getValue(id, r, 1)).toBe(r !== 0);
      expect(wb.getValue(id, r, 2)).toBe([2, 3, 2][r]);
      expect(wb.conditionalStyle(id, r, 0)?.bg === '#aabbcc').toBe(r !== 0);
    }
  };
  check();
  for (let pass = 0; pass < 2; pass++) { wb = await external(wb); id = wb.activeSheetId; check(); }
  wb.setInput(id, 0, 0, 'changed');
  expect(wb.getValue(id, 0, 2)).toBe(1);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 2 }), 10, 0, { r: 0, c: 0 });
  wb = await external(wb); id = wb.activeSheetId;
  expect(wb.getCell(id, 10, 2).f).toBe('COUNTIF($A$1:$A$3,A11)');
  expect([10, 11, 12].map(r => wb.getValue(id, r, 2))).toEqual([2, 3, 2]);
});
