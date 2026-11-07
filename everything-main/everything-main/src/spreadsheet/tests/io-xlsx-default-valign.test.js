import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml } from '../src/core/clipboard.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

const source = alignment => otherProgramsXlsx({
  styles: { cellXfs: [`<xf fontId="0" fillId="0" borderId="0" numFmtId="0">${alignment}</xf>`] },
  sheetXml: { Data: { rows: '<row r="1" ht="48" customHeight="1"><c r="A1" t="inlineStr"><is><t>Implicit XF</t></is></c><c r="B1" s="1"><v>42</v></c><c r="C1" s="1"><f>B1*2</f><v>84</v></c></row>' } },
});
async function nativeSave(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
}

it.each([
  ['', 'bottom'], ['<alignment/>', 'bottom'],
  ['<alignment horizontal="right"/>', 'bottom'],
  ['<alignment vertical="center"/>', 'middle'], ['<alignment vertical="top"/>', 'top'],
])('uses the complete XF alignment, including omitted defaults: %s', async (alignment, expected) => {
  let wb = await workbookFromFile(source(alignment), 'alignment.xlsx');
  for (let pass = 0; pass < 3; pass++) {
    const id = wb.activeSheetId;
    expect(wb.styleAt(id, 0, 0).valign).toBe('bottom');
    expect([1, 2].map(c => wb.styleAt(id, 0, c).valign)).toEqual([expected, expected]);
    expect(wb.getValue(id, 0, 2)).toBe(84);
    if (pass < 2) wb = await nativeSave(wb);
  }
});

it('keeps imported bottom alignment through edits, undo, internal copies and external HTML', async () => {
  const wb = await workbookFromFile(source(''), 'alignment.xlsx'), id = wb.activeSheetId;
  wb.setInput(id, 0, 1, '50'); expect(wb.getValue(id, 0, 2)).toBe(100);
  wb.undo(); expect(wb.getValue(id, 0, 2)).toBe(84);
  const cells = wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 2 });
  const target = new Workbook(); target.pasteCells(target.activeSheetId, cells, 2, 3);
  expect([3, 4, 5].map(c => target.styleAt(target.activeSheetId, 2, c).valign)).toEqual(['bottom', 'bottom', 'bottom']);
  const html = cellsToHtml([['Implicit XF', '42', '84']], cells);
  expect(html.match(/vertical-align:bottom/g)).toHaveLength(3);
  const back = await workbookFromFile(await workbookToXlsx(wb), 'with-metadata.xlsx');
  expect(back.styleAt(back.activeSheetId, 0, 0).valign).toBe('bottom');
});

it('preserves app-authored implicit middle and explicit alignments with and without metadata', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  [undefined, 'top', 'middle', 'bottom'].forEach((valign, c) => wb.setCells(id, [{ r: 0, c, cell: { v: 'Value', ...(valign ? { s: { valign } } : {}) } }]));
  for (const back of [await workbookFromFile(await workbookToXlsx(wb), 'own.xlsx'), await nativeSave(wb)]) {
    expect([0, 1, 2, 3].map(c => back.styleAt(back.activeSheetId, 0, c)?.valign || 'middle')).toEqual(['middle', 'top', 'middle', 'bottom']);
  }
});
