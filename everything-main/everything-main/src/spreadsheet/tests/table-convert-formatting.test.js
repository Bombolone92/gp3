import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

function setup(options = {}) {
  const wb = new Workbook(), id = wb.activeSheetId;
  [['Item', 'Quantity', 'Price'], ['Notebook', 3, 4.5], ['Pencil', 6, 1.25], ['Folder', 2, 3]]
    .forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  const tid = wb.addTable(id, parseRange('A1:C4'), { name: 'Purchases', style: 'green', firstColumn: true, ...options });
  return { wb, id, tid };
}

it('retains header, stripes, column emphasis, totals and cell formats in one reversible conversion', () => {
  const { wb, id, tid } = setup();
  wb.applyStyle(id, parseRange('C2:C4'), { fmt: 'currency', dec: 2 });
  wb.setTableTotals(id, tid, true);
  wb.setInput(id, 0, 5, '=SUM(Purchases[Price])');
  wb.clearHistory(); const before = wb.toJSON();
  wb.deleteTable(id, tid);
  expect(wb.tablesOn(id)).toEqual([]);
  expect(wb.styleAt(id, 0, 1)).toMatchObject({ bg: '#70ad47', color: '#ffffff', bold: true });
  expect(wb.styleAt(id, 1, 0)).toMatchObject({ bg: '#e2efda', bold: true });
  expect(wb.styleAt(id, 2, 0)).toMatchObject({ bold: true });
  expect(wb.styleAt(id, 2, 1)?.bg).toBeUndefined();
  expect(wb.styleAt(id, 4, 2)).toMatchObject({ bg: '#e2efda', bold: true, fmt: 'currency' });
  expect(wb.getValue(id, 0, 5)).toBe(8.75);
  expect(wb.getCell(id, 0, 5).f).not.toContain('Purchases');
  expect(wb.sheet(id).filter).toBeNull();
  const after = wb.toJSON(); expect(wb.undoLabels()).toHaveLength(1);
  wb.undo(); expect(wb.toJSON()).toEqual(before);
  wb.redo(); expect(wb.toJSON()).toEqual(after);
});

it('keeps direct cell and line fills, number formats and live conditional rules', () => {
  const { wb, id, tid } = setup();
  wb.applyStyle(id, parseRange('A1:A1'), { bg: '#ffcc00', color: '#aa0000' });
  wb.applyStyle(id, parseRange('B1:B1048576'), { bg: '#dddddd', fmt: 'percent' });
  wb.addRule(id, { type: 'formula', range: parseRange('C2:C4'), value: 'C2>2', style: { bg: '#990099' } });
  wb.deleteTable(id, tid);
  expect(wb.styleAt(id, 0, 0)).toMatchObject({ bg: '#ffcc00', color: '#aa0000', bold: true });
  expect(wb.styleAt(id, 1, 1)).toMatchObject({ bg: '#dddddd', fmt: 'percent' });
  expect(wb.styleAt(id, 1, 2).bg).toBe('#e2efda');
  expect(wb.conditionalStyle(id, 1, 2, 4.5)).toMatchObject({ bg: '#990099' });
  wb.setInput(id, 1, 2, '1');
  expect(wb.conditionalStyle(id, 1, 2, 1)).toBeNull();
  expect(wb.styleAt(id, 1, 2).bg).toBe('#e2efda');
});

it('freezes imported differential borders, false font flags and stripes on blank cells', () => {
  const wb = new Workbook({ sheets: [{ name: 'Imported', cells: { '0,0': { v: 'Item' }, '0,1': { v: 'Qty' },
    '1,0': { v: 'a', s: { bold: false, bg: '#112233' } }, '1,1': { v: 2 } }, tables: [{ id: 't', name: 'Purchases',
    range: parseRange('A1:B6'), style: 'blue', banded: true, firstColumn: true, customStyle: {
      wholeTable: { italic: false, bv: true, bs: 'dashed', bc: '#334455' },
      headerRow: { bold: true, bg: '#224466', color: '#ffffff' },
      firstRowStripe: { bg: '#ccddee', stripeSize: 2 }, secondRowStripe: { bg: '#ddeeff', stripeSize: 1 },
      firstColumn: { bold: true },
    } }] }] });
  const id = wb.activeSheetId;
  const coats = Array.from({ length: 6 }, (_, r) => [0, 1].map(c => wb._tableStyleAt(wb.sheet(id), r, c)));
  wb.deleteTable(id, 't');
  expect(wb.styleAt(id, 1, 0)).toMatchObject({ bold: false, bg: '#112233', italic: false });
  expect(wb.styleAt(id, 2, 1)).toMatchObject({ bg: '#ccddee', italic: false, bl: true, blBorder: { bs: 'dashed', bc: '#334455' } });
  expect(wb.styleAt(id, 3, 1).bg).toBe('#ddeeff');
  expect(wb.styleAt(id, 5, 1).bg).toBe('#ccddee');
  for (let r = 0; r < 6; r++) for (let c = 0; c < 2; c++) {
    for (const key of ['bold', 'italic', 'bl', 'br', 'blBorder', 'brBorder']) if (coats[r][c][key] !== undefined)
      expect(wb.styleAt(id, r, c)[key]).toEqual(coats[r][c][key]);
  }
});

it('keeps the displayed stripe pattern when filtering is removed by conversion', () => {
  const { wb, id, tid } = setup();
  wb.setFilterCriteria(id, 0, { values: ['Notebook', 'Folder'] });
  expect([...wb.sheet(id).filterHidden]).toContain(2);
  const before = [1, 2, 3].map(r => wb._tableStyleAt(wb.sheet(id), r, 1)?.bg);
  wb.deleteTable(id, tid);
  expect(wb.sheet(id).filterHidden.size).toBe(0);
  expect([1, 2, 3].map(r => wb.styleAt(id, r, 1)?.bg)).toEqual(before);
});

it('handles a large sparse unbanded table without allocating its blank cells', () => {
  const wb = new Workbook({ sheets: [{ name: 'Large', rows: 1048576, cols: 16384,
    cells: { '0,0': { v: 'Item' }, '1,0': { v: 'a' } }, tables: [{ id: 't', name: 'LargeTable',
      range: parseRange('A1:XFD1048576'), style: 'green', banded: false, firstColumn: true, lastColumn: true }] }] });
  const id = wb.activeSheetId, count = wb.sheet(id).cells.size;
  wb.deleteTable(id, 't');
  expect(wb.sheet(id).cells.size).toBe(count);
  expect(wb.sheet(id).styleResets.length).toBeLessThan(10);
  expect(wb.styleAt(id, 0, 16383)).toMatchObject({ bg: '#70ad47', bold: true });
  expect(wb.styleAt(id, 1048575, 16383)).toMatchObject({ bold: true });
  expect(wb.styleAt(id, 1048575, 10)?.bg).toBeUndefined();
});

it('exports converted formatting as native cell styles without table or private metadata dependencies', async () => {
  const { wb, id, tid } = setup(); wb.setTableTotals(id, tid, true); wb.deleteTable(id, tid);
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/workbook.xml').content);
  X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(xml.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  const sid = back.activeSheetId;
  expect(back.tablesOn(sid)).toEqual([]);
  expect(back.styleAt(sid, 0, 1)).toMatchObject({ bg: '#70ad47', bold: true });
  expect(back.styleAt(sid, 1, 0)).toMatchObject({ bg: '#e2efda', bold: true });
  expect(back.styleAt(sid, 4, 1)).toMatchObject({ bg: '#e2efda', bold: true });
  expect(back.getValue(sid, 4, 1)).toBe(11);
});
