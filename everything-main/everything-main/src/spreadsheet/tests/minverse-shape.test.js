// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

it.each(['{2,4}', '{2;4;8}', '{1,2,3;4,5,6}', '{1,2;3,4;5,6}'])('returns VALUE for non-square matrix %s', array => {
  expect(calc(`MINVERSE(${array})`)).toEqual({ error: '#VALUE!' });
});

it('distinguishes shape, singularity and input errors while retaining valid inverses', () => {
  expect(calc('MINVERSE({2,4;4,8})')).toEqual({ error: '#NUM!' });
  expect(calc('MINVERSE({0})')).toEqual({ error: '#NUM!' });
  expect(calc('INDEX(MINVERSE({8}),1,1)')).toBe(0.125);
  expect(calc('INDEX(MINVERSE({2,0;0,4}),2,2)')).toBe(0.25);
  expect(calc('MINVERSE({1,#N/A})')).toEqual({ error: '#N/A' });
  expect(calc('MINVERSE({1,"text"})')).toEqual({ error: '#VALUE!' });
  expect(calc('MINVERSE(B2:C2)', { B2: '3', C2: '7' })).toEqual({ error: '#VALUE!' });
  expect(calc('MINVERSE(B2:B4)', { B2: '3', B3: '7', B4: '9' })).toEqual({ error: '#VALUE!' });
});

it('recalculates a changing input shape and preserves the error through native XLSX and HTML values', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '2');
  wb.setInput(id, 0, 1, '4');
  wb.setInput(id, 2, 0, '1');
  wb.setInput(id, 4, 3, '=MINVERSE(TAKE(A1:B1,1,A3))');
  expect(wb.getValue(id, 4, 3)).toBe(0.5);
  wb.setInput(id, 2, 0, '2');
  expect(wb.getValue(id, 4, 3)).toEqual({ error: '#VALUE!' });
  const range = { r1: 4, c1: 3, r2: 4, c2: 3 };
  const values = wb.rangeValues(id, range);
  const html = cellsToHtml([['#VALUE!']], wb.copyRange(id, range), null, values).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell.v).toEqual({ error: '#VALUE!' });
  const blob = await workbookToXlsx(wb);
  const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); });
  const native = X.read(new Uint8Array(data), { type: 'array' });
  expect(native.Sheets[native.SheetNames[0]].D5).toMatchObject({ t: 'e', v: 15 });
  const zip = X.CFB.read(new Uint8Array(data), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(back.getValue(back.activeSheetId, 4, 3)).toEqual({ error: '#VALUE!' });
  back.setInput(back.activeSheetId, 2, 0, '1');
  expect(back.getValue(back.activeSheetId, 4, 3)).toBe(0.5);
});
