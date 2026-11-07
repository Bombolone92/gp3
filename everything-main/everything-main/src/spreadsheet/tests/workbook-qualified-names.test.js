import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
import { externalFormulaHasLinks, externalFormulaHasCaches } from '../src/core/external-workbooks.js';
import { createExternalFormulaLinks } from '../src/core/external-formula-links.js';

function setup() {
  const wb = new Workbook({ sheets: [{ name: 'Data' }, { name: 'Other' }] });
  const [data, other] = wb.sheets;
  wb.setInput(data.id, 0, 0, '10'); wb.setInput(other.id, 0, 0, '20');
  wb.defineName('Rate', '0.2'); wb.defineName('Rate', '0.3', 'Other');
  wb.defineName('Expr', 'Rate*2'); wb.defineName('Caller', 'ROW()+COLUMN()+SHEET()');
  wb.defineName('Anchor', 'Data!$A$1');
  const value = (f, r = 1, c = 0) => { wb.setInput(other.id, r, c, `=${f}`); return wb.getValue(other.id, r, c); };
  return { wb, data, other, value };
}

it.each(['[0]!Rate', "'[0]'!rate", 'LET(Rate,99,[0]!Rate)', 'LAMBDA(Rate,[0]!Rate)(99)'])('selects the workbook definition in %s', f => {
  const { wb, other, value } = setup();
  expect(value(f)).toBe(0.2); wb.defineName('Rate', '0.4'); expect(wb.getValue(other.id, 1, 0)).toBe(0.4);
  wb.undo(); expect(wb.getValue(other.id, 1, 0)).toBe(0.2);
  wb.defineName('Rate', '0.8', 'Other'); expect(wb.getValue(other.id, 1, 0)).toBe(0.2);
});
it('evaluates nested definitions in their own namespace and arguments at the caller', () => {
  const { wb, value } = setup();
  expect(value('[0]!Expr')).toBe(0.4);
  wb.defineName('LocalExpr', 'Rate*2', 'Other'); expect(value('LocalExpr')).toBe(0.6);
  wb.defineName('Scale', 'LAMBDA(x,x*Rate)'); wb.defineName('Scale', 'LAMBDA(x,x*10)', 'Other');
  expect(value('LET(Rate,5,[0]!Scale(Rate))')).toBe(1);
  expect(value('Scale(5)')).toBe(50); expect(value('[0]!Scale(5)')).toBe(1);
});
it('keeps caller position and worksheet while reading workbook definitions', () => {
  const { wb, data, other, value } = setup();
  expect(value('[0]!Caller', 3, 2)).toBe(9); // row 4 + column 3 + sheet 2
  wb.defineName('CellHere', 'A1*2');
  expect(value('[0]!CellHere', 2, 1)).toBe(40);
  wb.setInput(data.id, 2, 1, '=[0]!CellHere'); expect(wb.getValue(data.id, 2, 1)).toBe(20);
  wb.moveSheet(other.id, 0); expect(wb.getValue(other.id, 3, 2)).toBe(8);
  wb.undo(); expect(wb.getValue(other.id, 3, 2)).toBe(9);
});
it('preserves relative name coordinates at the caller and rejects unknown workbook names', () => {
  const { wb, data, other } = setup(), json = wb.toJSON();
  json.names.push({ name: 'RelativeCell', ref: '$A1', relative: true });
  const copy = new Workbook(json);
  copy.setInput(other.id, 3, 0, '11'); copy.setInput(data.id, 3, 0, '15');
  for (const [id, expected] of [[other.id, 11], [data.id, 15]]) {
    copy.setInput(id, 3, 1, '=[0]!RelativeCell'); expect(copy.getValue(id, 3, 1)).toBe(expected);
  }
  copy.setInput(other.id, 5, 0, '=[0]!Missing'); expect(copy.getValue(other.id, 5, 0)).toEqual({ error: '#NAME?' });
  copy.setInput(other.id, 6, 0, '=[00]!Rate'); expect(copy.getValue(other.id, 6, 0)).toEqual({ error: '#REF!' });
});
it('traces a workbook-qualified reference and recalculates after source changes', () => {
  const { wb, data, other, value } = setup();
  wb.defineName('Anchor', 'Other!$A$1', 'Other'); expect(value('[0]!Anchor')).toBe(10);
  expect(wb.precedents(other.id, 1, 0)).toEqual([{ sheetId: data.id, r: 0, c: 0 }]);
  expect(wb.dependents(data.id, 0, 0)).toEqual([{ sheetId: other.id, r: 1, c: 0 }]);
  wb.setInput(data.id, 0, 0, '12'); expect(wb.getValue(other.id, 1, 0)).toBe(12);
});
it('renames only the selected definition, including qualified references, with Undo', () => {
  const { wb, other, value } = setup();
  value('[0]!Rate+Rate'); value('[1]!Rate', 2); value("'[Book.xlsx]'!Rate", 3);
  const before = wb.toJSON(); wb.clearHistory();
  expect(wb.renameName('Rate', null, 'Charge', '0.2')).toBeNull();
  expect(wb.getCell(other.id, 1, 0).f).toBe('[0]!Charge+Rate');
  expect(wb.getCell(other.id, 2, 0).f).toBe('[1]!Rate'); expect(wb.getCell(other.id, 3, 0).f).toBe("'[Book.xlsx]'!Rate");
  expect(wb.getValue(other.id, 1, 0)).toBe(0.5); wb.undo(); expect(wb.toJSON()).toEqual(before);
  expect(wb.renameName('Rate', 'Other', 'LocalRate', '0.3')).toBeNull();
  expect(wb.getCell(other.id, 1, 0).f).toBe('[0]!Rate+LocalRate'); expect(wb.getValue(other.id, 1, 0)).toBe(0.5);
});
it('keeps workbook names and their dependencies when copying a sheet', () => {
  const { wb, other, value } = setup(); value('[0]!Expr'); value('[0]!Rate', 2);
  const copy = wb.sheetToWorkbook(other.id);
  expect(copy.namedEntry('Rate', '[0]').ref).toBe('0.2'); expect(copy.namedEntry('Rate', 'Other').ref).toBe('0.3');
  expect(copy.getValue(copy.activeSheetId, 1, 0)).toBe(0.4); expect(copy.getValue(copy.activeSheetId, 2, 0)).toBe(0.2);
  const dest = new Workbook(); dest.defineName('Rate', '99'); dest.defineName('Expr', '77');
  const [added] = dest.importSheets(copy);
  expect(dest.getValue(added.id, 1, 0)).toBe(0.4); expect(dest.getValue(added.id, 2, 0)).toBe(0.2);
  expect(dest.namedEntry('Rate', '[0]').ref).toBe('99');
  const replacement = new Workbook(); replacement.defineName('Rate', '88');
  replacement.replaceSheetWith(replacement.activeSheetId, copy, copy.activeSheetId);
  expect(replacement.getValue(replacement.activeSheetId, 1, 0)).toBe(0.4);
  expect(replacement.getValue(replacement.activeSheetId, 2, 0)).toBe(0.2);
  expect(replacement.namedEntry('Rate', '[0]').ref).toBe('88');
});
it('imports colliding qualified name chains without undoing earlier dependency renames', () => {
  const { wb: source, other, value } = setup();
  source.defineName('Zexpr', 'Rate*2'); source.defineName('Ztotal', 'Zexpr+1');
  expect(value('INDIRECT("A"&"1")')).toBe(20); value('[0]!Ztotal', 2);
  const before = source.toJSON(), dest = new Workbook();
  dest.defineName('Rate', '99'); dest.defineName('Zexpr', '88'); dest.defineName('Ztotal', '77');
  const destinationBefore = dest.toJSON(); dest.clearHistory();
  const added = dest.importSheets(source).find(s => s.name === other.name);
  expect(source.toJSON()).toEqual(before);
  expect(dest.getValue(added.id, 1, 0)).toBe(20); expect(dest.getValue(added.id, 2, 0)).toBe(1.4);
  expect(dest.namedEntry('Rate', null).ref).toBe('99');
  dest.undo(); expect(dest.toJSON()).toEqual(destinationBefore); dest.redo(); expect(dest.getValue(added.id, 2, 0)).toBe(1.4);
  const replacement = new Workbook(); replacement.defineName('Rate', '99'); replacement.defineName('Zexpr', '88');
  replacement.replaceSheetWith(replacement.activeSheetId, source, other.id);
  expect(replacement.getValue(replacement.activeSheetId, 2, 0)).toBe(1.4); expect(source.toJSON()).toEqual(before);
});
it('distinguishes workbook names from real external links, including nested definitions', () => {
  const { wb } = setup();
  const books = { books: [{ target: 'source.xlsx', sheets: [{ name: 'Source', cells: { '0,0': 7 } }], names: [
    { name: 'Rate', ref: '5' }, { name: 'Rate', ref: '9', sheet: 0 }, { name: 'Expr', ref: '[0]!Rate*2' },
  ] }] };
  expect(externalFormulaHasLinks('[0]!Rate', books)).toBe(false); expect(externalFormulaHasCaches('[0]!Rate', books)).toBe(false);
  expect(externalFormulaHasLinks('[0]!Rate+[1]!Rate', books)).toBe(true); expect(externalFormulaHasCaches('[0]!Rate+[1]!Rate', books)).toBe(true);
  wb.externalWorkbooks = books;
  wb.setInput(wb.activeSheetId, 1, 0, '=[1]!Expr+[0]!Rate'); expect(wb.getValue(wb.activeSheetId, 1, 0)).toBe(10.2);
  wb.defineName('Linked', '[1]!Rate'); wb.defineName('Linked', '100', 'Other'); wb.defineName('Via', '[0]!Linked+1');
  const classify = createExternalFormulaLinks(wb.names, books);
  expect(classify('[0]!Via', 'Other', 0, 0)).toMatchObject({ external: true, linked: true, cached: true });
  expect(classify('Linked', 'Other', 0, 0).external).toBe(false);
  expect(classify('[0]!Rate', 'Other', 0, 0).external).toBe(false);
  expect(classify("'[0]Source'!A1", 'Other', 0, 0)).toMatchObject({ external: true, linked: false });
});

async function publicOnly(blob) {
  const zip = X.CFB.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
it.each(['xlsx', 'public xlsx', 'ods'])('keeps live qualified formulas after %s round trips', async format => {
  let { wb, value } = setup(); value('[0]!Rate'); value('[0]!Expr', 2); value('[0]!Caller', 3);
  for (let i = 0; i < 2; i++) {
    const blob = await (format === 'ods' ? workbookToOds : workbookToXlsx)(wb);
    wb = await workbookFromFile(format === 'public xlsx' ? await publicOnly(blob) : blob, format === 'ods' ? 'names.ods' : 'names.xlsx');
    const other = wb.sheetByName('Other');
    expect(wb.getCell(other.id, 1, 0).f).toBe('[0]!Rate'); expect(wb.getValue(other.id, 1, 0)).toBe(0.2);
    expect(wb.getValue(other.id, 2, 0)).toBe(0.4); expect(wb.getValue(other.id, 3, 0)).toBe(7);
    expect(wb.externalFormulas?.get(other.id)?.has('1,0') || false).toBe(false);
  }
  const id = wb.sheetByName('Other').id; wb.defineName('Rate', '0.4');
  expect(wb.getValue(id, 1, 0)).toBe(0.4); expect(wb.getValue(id, 2, 0)).toBe(0.8);
  wb.undo(); expect(wb.getValue(id, 1, 0)).toBe(0.2);
});

it('recovers the live formula from files exported by the earlier cached-result path', async () => {
  const { wb, other } = setup();
  wb.setInput(other.id, 1, 0, '0.2');
  wb.externalFormulas = new Map([[other.id, new Map([['1,0', { f: '[0]!Rate', v: 0.2 }]])]]);
  const back = await workbookFromFile(await workbookToXlsx(wb), 'legacy.xlsx'), id = back.sheetByName('Other').id;
  expect(back.getCell(id, 1, 0).f).toBe('[0]!Rate'); expect(back.getValue(id, 1, 0)).toBe(0.2);
  back.defineName('Rate', '0.7'); expect(back.getValue(id, 1, 0)).toBe(0.7);
});

it('exports ODS qualified cells as values with restorable metadata, without invalid OpenFormula syntax', async () => {
  const { wb, other, value } = setup(); value('[0]!Rate'); wb.defineName('Qualified', '[0]!Rate*2');
  const blob = await workbookToOds(wb), zip = X.CFB.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/content.xml').content);
  expect(xml).not.toMatch(/(?:table:formula|table:expression)="[^"]*\[0\]/);
  const back = await workbookFromFile(blob, 'names.ods');
  expect(back.getCell(back.sheetByName('Other').id, 1, 0).f).toBe('[0]!Rate');
  expect(back.namedEntry('Qualified', null).ref).toBe('[0]!Rate*2');
});
