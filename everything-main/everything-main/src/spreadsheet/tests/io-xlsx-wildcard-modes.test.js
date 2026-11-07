import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

async function external(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'wildcard-modes.xlsx');
}

it('preserves wildcard and lookup modes through edits, copies and native-only saves', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  const values = ['ａb', 'ab', 'ss', 'ß', '~a'];
  for (const [r, v] of values.entries()) wb.setCells(id, [{ r, c: 0, cell: { v } }]);
  const formulas = ['COUNTIF($A$1:$A$5,"a*")', 'SEARCH("Ａ*","zzab")',
    'MATCH("ß",$A$1:$A$5,0)', 'XMATCH("ß",$A$1:$A$5,0)',
    'COUNTIF($A$1:$A$5,"~a")', 'XMATCH("ß",$A$1:$A$5,0,-1)', 'XMATCH("ß",$A$1:$A$5,2)'];
  const expected = [2, 3, 4, 3, 1, 4, 4];
  for (const [r, f] of formulas.entries()) wb.setInput(id, r, 1, '=' + f);
  wb.addRule(id, { range: { r1: 0, c1: 0, r2: 4, c2: 0 }, type: 'formula', value: 'COUNTIF($A$1:$A$5,"a*")>1', style: { bg: '#aabbcc' } });
  const check = () => {
    for (const [r, v] of values.entries()) {
      expect(wb.getValue(id, r, 0)).toBe(v);
      expect(wb.conditionalStyle(id, r, 0)?.bg).toBe('#aabbcc');
    }
    expect(formulas.map((f, r) => wb.getCell(id, r, 1).f)).toEqual(formulas);
    expect(expected.map((v, r) => wb.getValue(id, r, 1))).toEqual(expected);
  };
  check();
  for (let pass = 0; pass < 2; pass++) { wb = await external(wb); id = wb.activeSheetId; check(); }
  wb.setInput(id, 0, 0, 'changed');
  expect(wb.getValue(id, 0, 1)).toBe(1);
  expect(wb.conditionalStyle(id, 0, 0)?.bg).not.toBe('#aabbcc');
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 6, c2: 1 }), 10, 0, { r: 0, c: 0 });
  wb = await external(wb); id = wb.activeSheetId;
  expect(expected.map((v, r) => wb.getValue(id, r + 10, 1))).toEqual(expected);
});
