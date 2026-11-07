import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { JSDOM } from 'jsdom';
import { vi } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';

async function nativeOnly(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  book.size = book.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'intersection.xlsx');
}

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.renameSheet(id, 'Data');
  wb.setCells(id, Array.from({ length: 5 }, (_, r) => Array.from({ length: 4 }, (_, c) => ({ r: r + 1, c: c + 1, cell: { v: 10 * (r + 1) + c + 1 } }))).flat());
  return { wb, id };
}

it('discovers intersection spills from a child, recalculates, blocks collisions and exports live native arrays', async () => {
  const { wb, id } = setup();
  wb.setInput(id, 1, 7, '=B2:D5 C3:E6');
  expect(wb.getValue(id, 2, 8)).toBe(33);
  expect(wb.getValue(id, 3, 7)).toBe(42);
  wb.setInput(id, 2, 2, '90'); expect(wb.getValue(id, 1, 7)).toBe(90);
  wb.setInput(id, 2, 7, 'Blocked'); expect(wb.getValue(id, 1, 7)).toEqual({ error: '#SPILL!' });
  wb.undo(); expect(wb.getValue(id, 2, 7)).toBe(32);
  wb.setInput(id, 1, 10, '=SUM(H2# H3:I3)');
  expect(wb.getValue(id, 1, 10)).toBe(65);
  wb.setInput(id, 8, 7, '=A1 B2');
  const back = await nativeOnly(wb), target = back.sheetByName('Data').id;
  expect(back.getCell(target, 8, 7).f).toBe('A1 B2');
  expect(back.getValue(target, 8, 7)).toEqual({ error: '#NULL!' });
  expect(back.getCell(target, 1, 7).f).toBe('B2:D5 C3:E6');
  expect(back.getValue(target, 2, 8)).toBe(33);
  expect(back.getValue(target, 1, 10)).toBe(65);
  back.setInput(target, 3, 2, '8'); expect(back.getValue(target, 2, 7)).toBe(8);
  expect(back.getValue(target, 1, 10)).toBe(41);
});

it('preserves named intersections, sheet renames, structural changes and repeated native-only saves', async () => {
  let { wb, id } = setup();
  wb.defineName('LeftBlock', 'Data!$B$2:$D$5');
  wb.defineName('RightBlock', 'Data!$C$3:$E$6');
  wb.defineName('Shared', 'LeftBlock RightBlock');
  wb.setInput(id, 1, 7, '=SUM(Shared)');
  const expected = wb.getValue(id, 1, 7);
  expect(expected).toBe(195);
  wb.renameSheet(id, "Source's data");
  wb.insertRows(id, 0, 2);
  expect(wb.getValue(id, 3, 7)).toBe(expected);
  for (let i = 0; i < 2; i++) {
    wb = await nativeOnly(wb); id = wb.sheetByName("Source's data").id;
    expect(wb.getValue(id, 3, 7)).toBe(expected);
    expect(wb.names.find(n => n.name === 'Shared').ref).toBe('LeftBlock RightBlock');
  }
  wb.setInput(id, 4, 2, '100'); expect(wb.getValue(id, 3, 7)).toBe(273);
  wb.undo(); expect(wb.getValue(id, 3, 7)).toBe(expected);
});

it('intersects structured table references before and after native export', async () => {
  let { wb, id } = setup();
  wb.setCells(id, ['Value', 'Score', 'Other'].map((v, c) => ({ r: 0, c: c + 1, cell: { v } })));
  wb.addTable(id, { r1: 0, c1: 1, r2: 5, c2: 3 }, { name: 'Items' });
  wb.setInput(id, 1, 7, '=SUM(Items[[Value]:[Score]] Items[[Score]:[Other]])');
  expect(wb.getValue(id, 1, 7)).toBe(160);
  wb = await nativeOnly(wb); id = wb.sheetByName('Data').id;
  expect(wb.getValue(id, 1, 7)).toBe(160);
  wb.setInput(id, 2, 2, '100'); expect(wb.getValue(id, 1, 7)).toBe(238);
});

it('shifts both operands on copy/paste and preserves native error values through external HTML', () => {
  const { wb, id } = setup();
  wb.setInput(id, 1, 7, '=SUM($B2:$D5 C$3:E$6)');
  wb.pasteCells(id, wb.copyRange(id, { r1: 1, c1: 7, r2: 1, c2: 7 }), 2, 8, { r: 1, c: 7 });
  expect(wb.getCell(id, 2, 8).f).toBe('SUM($B3:$D6 D$3:F$6)');
  expect(wb.getValue(id, 2, 8)).toBe(152);
  wb.setInput(id, 5, 7, '=A1 B2');
  expect(wb.getValue(id, 5, 7)).toEqual({ error: '#NULL!' });
  const cells = wb.copyRange(id, { r1: 5, c1: 7, r2: 5, c2: 7 });
  const html = cellsToHtml([['#NULL!']], cells, null, [[{ error: '#NULL!' }]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try { expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell.v).toEqual({ error: '#NULL!' }); }
  finally { vi.unstubAllGlobals(); }
});
