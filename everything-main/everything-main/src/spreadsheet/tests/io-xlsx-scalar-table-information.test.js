import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { intersectTableFormula } from '../src/core/xlsx-table-formulas.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

// Native legacy calculated columns: no app metadata and no inferred cached results.
function fixture({ arrayCell = false, arrayColumn = false } = {}) {
  const info = 'IF(ISBLANK(Tasks[Due]),"",IF(ISNUMBER(Tasks[Due]),Tasks[Due]*2,-1))';
  const row = 'AND(ROW(Tasks[Due])&lt;&gt;8,Tasks[[#This Row],[Due]]&lt;&gt;0)';
  const bytes = otherProgramsXlsx({ sheetNames: ['Tasks'], sheetXml: { Tasks: {
    rows: '<row r="5"><c r="A5" t="str"><v>Due</v></c><c r="B5" t="str"><v>Information</v></c><c r="C5" t="str"><v>Row check</v></c></row>'
      + [100, 300, null].map((value, i) => `<row r="${i + 6}">${value == null ? '' : `<c r="A${i + 6}"><v>${value}</v></c>`}<c r="B${i + 6}"><f${arrayCell ? ` t="array" ref="B${i + 6}"` : ''}>${info}</f></c><c r="C${i + 6}"><f>${row}</f></c></row>`).join(''),
    tail: '<tableParts count="1"><tablePart r:id="tasks"/></tableParts>',
  } } });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (path, xml) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(xml));
  add('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="tasks" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/tasks.xml"/></Relationships>');
  add('xl/tables/tasks.xml', `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Tasks" displayName="Tasks" ref="A5:C8" totalsRowCount="0"><tableColumns count="3"><tableColumn id="1" name="Due"/><tableColumn id="2" name="Information"><calculatedColumnFormula${arrayColumn ? ' array="1"' : ''}>${info}</calculatedColumnFormula></tableColumn><tableColumn id="3" name="Row check"><calculatedColumnFormula>${row}</calculatedColumnFormula></tableColumn></tableColumns></table>`);
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it('intersects information-function arguments and legacy ROW outputs in scalar table expressions', async () => {
  let wb = await workbookFromFile(fixture(), 'legacy.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const id = wb.activeSheetId;
    expect([5, 6, 7].map(r => wb.getValue(id, r, 1))).toEqual([200, 600, '']);
    expect([5, 6, 7].map(r => wb.getValue(id, r, 2))).toEqual([true, true, false]);
    expect(wb.getCell(id, 5, 1).f).toContain('ISBLANK(@Tasks[Due])');
    expect(wb.getCell(id, 5, 2).f).toContain('@ROW(Tasks[Due])');
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'roundtrip.xlsx');
  }
  const id = wb.activeSheetId;
  wb.setInput(id, 6, 0, '400');
  expect(wb.getValue(id, 6, 1)).toBe(800);
  wb.undo();
  expect(wb.getValue(id, 6, 1)).toBe(600);
  const copy = wb.addSheet('Copied').id;
  wb.pasteCells(copy, wb.copyRange(id, { r1: 5, c1: 1, r2: 7, c2: 2 }), 5, 0, { r: 5, c: 1 });
  expect([5, 6, 7].map(r => wb.getValue(copy, r, 0))).toEqual([200, 600, '']);
  const bytes = await (await workbookToXlsx(wb)).arrayBuffer();
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const external = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  expect([5, 6, 7].map(r => external.getValue(external.sheetByName('Tasks').id, r, 1))).toEqual([200, 600, '']);
  expect([5, 6, 7].map(r => external.getValue(external.sheetByName('Copied').id, r, 0))).toEqual([200, 600, '']);
});

it('preserves direct aggregate ranges and explicitly array-entered table formulas', async () => {
  for (const formula of ['AND(Tasks[Due])', 'OR(Tasks[Due])', 'SUMPRODUCT(ISNUMBER(Tasks[Due])*ROW(Tasks[Due]))', 'SUM(ISBLANK(Tasks[Due]))', 'ISFORMULA(Tasks[Due])', 'FORMULATEXT(Tasks[Due])']) {
    expect(intersectTableFormula(formula)).toBe(formula);
  }
  expect(intersectTableFormula('IF(AND(Tasks[Due]>0,TRUE),COLUMN(Tasks[[Due]:[Information]]),0)'))
    .toBe('IF(AND(@Tasks[Due]>0,TRUE),@COLUMN(Tasks[[Due]:[Information]]),0)');
  for (const options of [{ arrayCell: true }, { arrayColumn: true }]) {
    const wb = await workbookFromFile(fixture(options), 'arrays.xlsx');
    expect(wb.getCell(wb.activeSheetId, 5, 1).f).toContain('ISBLANK(Tasks[Due])');
  }
});
