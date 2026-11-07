import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { parseRange } from '../src/core/cell.js';
import { hasTableRefs, tableRefsToA1 } from '../src/core/tables.js';

async function sheetFormulas(wb) {
  const out = await workbookToXlsx(wb);
  const bytes = out instanceof Uint8Array ? out : new Uint8Array(await out.arrayBuffer());
  const zip = XLSX.CFB.read(bytes, { type: 'array' });
  const entry = zip.FileIndex.find((e) => /sheet1\.xml$/.test(e.name));
  return [...new TextDecoder().decode(entry.content).matchAll(/<f>([^<]*)<\/f>/g)].map((m) => m[1]);
}

// A LAMBDA's optional parameter, [b], is written like a table column and was converted with
// them on save, to #REF!: Excel and LibreOffice then saw a broken formula.
it('saves a LAMBDA optional parameter as written alongside native table references', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Qty'); wb.setInput(id, 1, 0, '2'); wb.setInput(id, 2, 0, '3');
  wb.addTable(id, parseRange('A1:A3'), { name: 'Sales' });
  wb.setInput(id, 0, 2, '=LAMBDA(a,[b],IF(ISOMITTED(b),a,a+b))(1)');
  wb.setInput(id, 1, 2, '=LAMBDA(a,[b],IF(ISOMITTED(b),a,a+b))(1,2)');
  wb.setInput(id, 2, 2, '=LAMBDA([b],IF(ISOMITTED(b),SUM(Sales[Qty]),b))()');
  expect([0, 1, 2].map((r) => wb.getValue(id, r, 2))).toEqual([1, 3, 5]);
  const raw = await sheetFormulas(wb);
  // Excel spells bound parameters with an _xlpm. prefix in the file; the parameter itself is what this test guards.
  const formulas = raw.map((f) => f.replaceAll('_xlpm.', ''));
  expect(formulas).toContain('_xlfn.LAMBDA(a,[b],IF(_xlfn.ISOMITTED(b),a,a+b))(1)');
  expect(formulas).toContain('_xlfn.LAMBDA(a,[b],IF(_xlfn.ISOMITTED(b),a,a+b))(1,2)');
  expect(formulas).toContain('_xlfn.LAMBDA([b],IF(_xlfn.ISOMITTED(b),SUM(Sales[Qty]),b))()');
  expect(formulas.join('\n')).not.toContain('#REF!');
  const reopened = await workbookFromFile(await workbookToXlsx(wb), 'lambda.xlsx');
  const rid = reopened.activeSheetId;
  expect([0, 1, 2].map((r) => reopened.getValue(rid, r, 2))).toEqual([1, 3, 5]);
  expect(reopened.getCell(rid, 0, 2).f).toBe('LAMBDA(a,[b],IF(ISOMITTED(b),a,a+b))(1)');
});

it('does not take a LAMBDA parameter declaration for a table reference', () => {
  expect(hasTableRefs('LAMBDA(a,[b],a+b)(1,2)')).toBe(false);
  expect(hasTableRefs('LAMBDA([b],SUM(Sales[Qty]))()')).toBe(true);
  expect(tableRefsToA1('LAMBDA(a,[b],a+b)(1,2)', () => null)).toBe('LAMBDA(a,[b],a+b)(1,2)');
  expect(tableRefsToA1('LAMBDA([b],SUM(Sales[Qty])+b)()', () => ({ r1: 1, c1: 0, r2: 2, c2: 0, sheet: null }))).toBe('LAMBDA([b],SUM($A$2:$A$3)+b)()');
});
