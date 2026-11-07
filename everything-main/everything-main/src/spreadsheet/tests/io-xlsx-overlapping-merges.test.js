import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

async function open(mergeCells) {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['x']]), 'Data');
  const zip = X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  entry.content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="5"><c r="A5"><v>1</v></c></row><row r="6"><c r="B6"><v>2</v></c></row></sheetData><mergeCells count="${mergeCells.length}">${mergeCells.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells></worksheet>`);
  entry.size = entry.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'merges.xlsx');
}

// Two merges sharing a cell leave it hidden under one block and the anchor of the other, a
// state the app never creates itself (merging over a block replaces it) and Excel refuses
// with a repair prompt. The later of two such merges in the file is dropped on open.
it('keeps the first of two overlapping merges from a file and drops the later one', async () => {
  const wb = await open(['A5:B6', 'B6:C7', 'E1:F2', 'F2:F3', 'H1:H3']);
  const id = wb.activeSheetId;
  expect(wb.activeSheet.merges).toEqual([
    { r1: 4, c1: 0, r2: 5, c2: 1 },
    { r1: 0, c1: 4, r2: 1, c2: 5 },
    { r1: 0, c1: 7, r2: 2, c2: 7 },
  ]);
  expect(wb.mergeAt(id, 6, 2)).toBeNull();
  const back = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  expect(back.activeSheet.merges).toEqual(wb.activeSheet.merges);
});

it('keeps merges that only touch along an edge', async () => {
  const wb = await open(['A1:B2', 'C1:D2', 'A3:B4']);
  expect(wb.activeSheet.merges).toHaveLength(3);
});
