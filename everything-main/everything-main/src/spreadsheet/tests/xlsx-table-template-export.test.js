import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const text = part => new TextDecoder().decode(part.content);
async function native(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const tables = zip.FullPaths.flatMap((path, i) => /\/tables\/table\d+\.xml$/.test(path) ? [text(zip.FileIndex[i])] : []);
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(text(part).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const sheetXml = text(X.CFB.find(zip, '/xl/worksheets/sheet1.xml'));
  return { tables, sheetXml, wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx') };
}
function inventory({ r = 2, c = 3 } = {}) {
  const wb = new Workbook(), id = wb.activeSheetId;
  [['Quantity', 'Price', 'Amount'], [2, 5, null], [3, 7, null]].forEach((row, rr) =>
    row.forEach((value, cc) => { if (value != null) wb.setInput(id, r + rr, c + cc, String(value)); }));
  const tid = wb.addTable(id, { r1: r, c1: c, r2: r + 2, c2: c + 2 }, { name: 'Items' });
  wb.setInput(id, r + 1, c + 2, '=Items[@Quantity]*Items[@Price]');
  return { wb, id, tid };
}

it.each([{ r: 0, c: 0 }, { r: 7, c: 4 }])('exports live templates and extends tables after native reopening at %j', async position => {
  let { wb, id, tid } = inventory(position);
  // A manually overridden row remains an exception, rather than replacing the template.
  wb.setInput(id, position.r + 2, position.c + 2, '999');
  for (let pass = 0; pass < 2; pass++) {
    const result = await native(wb);
    // The file uses SpreadsheetML's #This Row spelling; the app reads it back with @.
    expect(result.tables[0]).toContain('<calculatedColumnFormula>Items[[#This Row],[Quantity]]*Items[[#This Row],[Price]]</calculatedColumnFormula>');
    expect(result.sheetXml).toContain('<f>Items[[#This Row],[Quantity]]*Items[[#This Row],[Price]]</f>');
    expect(result.wb.activeSheet.tables[0].calc[2]).toBe('Items[@Quantity]*Items[@Price]');
    wb = result.wb; id = wb.activeSheetId; tid = wb.activeSheet.tables[0].id;
    expect(wb.getValue(id, position.r + 2, position.c + 2)).toBe(999);
    const row = wb.addTableRow(id, tid);
    wb.setInput(id, row, position.c, '11'); wb.setInput(id, row, position.c + 1, '4');
    expect(wb.getValue(id, row, position.c + 2)).toBe(44);
  }
});

it('keeps cross-sheet structured consumers live through resizing and native export', async () => {
  let { wb, id, tid } = inventory();
  const summary = wb.addSheet('Overview');
  wb.setInput(summary.id, 0, 0, '=SUM(Items[Amount])');
  wb = (await native(wb)).wb;
  const sheet = wb.sheets[0]; id = sheet.id; tid = sheet.tables[0].id;
  expect(wb.getCell(wb.sheetByName('Overview').id, 0, 0).f).toBe('SUM(Items[Amount])');
  const row = wb.addTableRow(id, tid);
  wb.setInput(id, row, 3, '4'); wb.setInput(id, row, 4, '8');
  expect(wb.getValue(wb.sheetByName('Overview').id, 0, 0)).toBe(63);
  wb = (await native(wb)).wb;
  expect(wb.getValue(wb.sheetByName('Overview').id, 0, 0)).toBe(63);
});

it('rebases relative templates from their retained origin and preserves absolute references', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', tables: [{
    name: 'Records', range: { r1: 2, c1: 2, r2: 5, c2: 3 }, calcRow: 5,
    calc: { 1: 'C6+$F$1+SUM($G6:H$8)' },
  }], cells: { '2,2': { v: 'Input' }, '2,3': { v: 'Result' }, '0,5': { v: 10 } } }] });
  const result = await native(wb);
  expect(result.tables[0]).toContain('<calculatedColumnFormula>C4+$F$1+SUM($G4:H$8)</calculatedColumnFormula>');
  const sheet = result.wb.activeSheet;
  expect(sheet.tables[0].calc[1]).toBe('C4+$F$1+SUM($G4:H$8)');
  const row = result.wb.addTableRow(sheet.id, sheet.tables[0].id);
  result.wb.setInput(sheet.id, row, 2, '6');
  expect(result.wb.getValue(sheet.id, row, 3)).toBe(16);
});

it('writes modern function prefixes and XML text escapes in calculated-column formulas', async () => {
  const { wb } = inventory();
  wb.activeSheet.tables[0].calc[2] = 'IF(Items[@Quantity]<4,CONCAT("<&",Items[@Price]),"large")';
  const { tables, wb: back } = await native(wb);
  expect(tables[0]).toContain('_xlfn.CONCAT(&quot;&lt;&amp;&quot;,Items[[#This Row],[Price]])');
  expect(back.activeSheet.tables[0].calc[2]).toBe(wb.activeSheet.tables[0].calc[2]);
  const row = back.addTableRow(back.activeSheetId, back.activeSheet.tables[0].id);
  back.setInput(back.activeSheetId, row, 3, '2'); back.setInput(back.activeSheetId, row, 4, '8');
  expect(back.getValue(back.activeSheetId, row, 5)).toBe('<&8');
});

it.each(['literal_x0041_', 'line\r\nnext', '<&"😀'])('preserves template string literals: %j', async literal => {
  let { wb } = inventory();
  const formula = `"${literal.replaceAll('"', '""')}"`;
  wb.activeSheet.tables[0].calc[2] = formula;
  for (let pass = 0; pass < 2; pass++) {
    wb = (await native(wb)).wb;
    const sheet = wb.activeSheet, table = sheet.tables[0];
    expect(table.calc[2]).toBe(formula);
    const row = wb.addTableRow(sheet.id, table.id);
    expect(wb.getValue(sheet.id, row, 5)).toBe(literal);
  }
});

it('keeps existing export handling for invalid formulas and unresolved external links', async () => {
  const { wb } = inventory();
  wb.activeSheet.tables[0].calc = { 0: '1+', 1: "'[1]Data'!A1", 2: '1+2' };
  const { tables } = await native(wb);
  expect(tables[0].match(/<calculatedColumnFormula>/g)).toHaveLength(1);
  expect(tables[0]).toContain('<calculatedColumnFormula>1+2</calculatedColumnFormula>');
  const back = await workbookFromFile(await workbookToXlsx(wb), 'with-sidecar.xlsx');
  expect(back.activeSheet.tables[0].calc).toEqual(wb.activeSheet.tables[0].calc);
});

it.each([
  ['insert', (wb, id) => wb.insertCols(id, 4), 3],
  ['delete', (wb, id) => wb.deleteCols(id, 3), 1],
  ['move', (wb, id) => wb.moveCols(id, 4, 1, 6), 1],
  ['block', (wb, id) => wb.insertCells(id, { r1: 2, c1: 4, r2: 4, c2: 4 }, 'right'), 3],
])('preserves array template flags through %s and native export', async (_, action, offset) => {
  let { wb, id } = inventory();
  wb.activeSheet.tables[0].calcArray = { 2: true };
  wb = (await native(wb)).wb; id = wb.activeSheetId;
  expect(wb.activeSheet.tables[0].calcArray).toEqual({ 2: true });
  wb.clearHistory(); action(wb, id);
  expect(wb.activeSheet.tables[0].calcArray).toEqual({ [offset]: true });
  const result = await native(wb);
  expect(result.tables[0]).toContain('<calculatedColumnFormula array="1">');
  expect(result.wb.activeSheet.tables[0].calcArray).toEqual({ [offset]: true });
  wb.undo(); expect(wb.activeSheet.tables[0].calcArray).toEqual({ 2: true });
  wb.redo(); expect(wb.activeSheet.tables[0].calcArray).toEqual({ [offset]: true });
});

it('retains array markers through drafts and sheet copies, and removes trimmed templates', async () => {
  let { wb, id } = inventory();
  wb.activeSheet.tables[0].calcArray = { 2: true };
  wb = new Workbook(wb.toJSON()); id = wb.activeSheetId;
  const copy = wb.duplicateSheet(id);
  expect(copy.tables[0].calcArray).toEqual({ 2: true });
  copy.tables[0].calcArray[2] = false;
  expect(wb.sheet(id).tables[0].calcArray).toEqual({ 2: true });
  const table = wb.sheet(id).tables[0];
  wb.resizeTable(id, table.id, { ...table.range, c2: 4 });
  expect(wb.sheet(id).tables[0].calcArray).toEqual({});
  expect((await native(wb)).tables[0]).not.toContain('calculatedColumnFormula');
});

it.each(['Items[@Quantity]*Items[@Price]', 'Items[[#This Row],[Quantity]]*Items[[#This Row],[Price]]'])('keeps scalar calculated columns scalar in native Excel markup: %s', async expression => {
  let { wb, id } = inventory();
  for (const r of [3, 4]) wb.setInput(id, r, 5, `=IFERROR(${expression},0)`);
  for (let pass = 0; pass < 2; pass++) {
    const result = await native(wb);
    const cells = [...result.sheetXml.matchAll(/<c\b[^>]*>[\s\S]*?<\/c>/g)].map(m => m[0]).filter(xml => xml.includes('IFERROR'));
    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      expect(cell).toContain('<f>'); expect(cell).not.toContain('t="array"'); expect(cell).not.toMatch(/\bcm="/);
    }
    wb = result.wb; id = wb.activeSheetId;
    expect(wb.getValue(id, 3, 5)).toBe(10);
    expect(wb.getValue(id, 4, 5)).toBe(21);
  }
});
