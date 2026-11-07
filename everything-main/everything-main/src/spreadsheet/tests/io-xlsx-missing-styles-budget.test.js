import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';

/** An .xlsx of `rows` rows of a number and a text, with and without its styles part. */
function files(rows) {
  let data = '';
  for (let r = 1; r <= rows; r++) data += `<row r="${r}"><c r="A${r}"><v>${r}</v></c><c r="B${r}" t="inlineStr"><is><t>t${r}</t></is></c></row>`;
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['x']]), 'Data');
  const zip = X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const sheet = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  sheet.content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`);
  sheet.size = sheet.content.length;
  const withStyles = X.CFB.write(zip, { type: 'array', fileType: 'zip' });
  const i = zip.FileIndex.findIndex((e) => e.name === 'styles.xml');
  zip.FileIndex.splice(i, 1);
  zip.FullPaths.splice(i, 1);
  for (const [path, pattern] of [['/xl/_rels/workbook.xml.rels', /<Relationship [^>]*styles\.xml"[^>]*\/>/], ['/[Content_Types].xml', /<Override [^>]*styles\.xml"[^>]*\/>/]]) {
    const part = X.CFB.find(zip, path);
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(pattern, ''));
    part.size = part.content.length;
  }
  return { withStyles, withoutStyles: X.CFB.write(zip, { type: 'array', fileType: 'zip' }) };
}
async function timed(bytes) {
  const start = performance.now();
  const wb = await workbookFromFile(bytes, 'plain.xlsx');
  return { ms: performance.now() - start, wb };
}

// A file with no styles part made the reader look up a fill style for every cell and throw
// and catch for each, so such a file opened seven to fifteen times slower than one with the
// part. Without the part there is no style to look up.
it('opens a file with no styles part about as fast as one with it', async () => {
  const { withStyles, withoutStyles } = files(30000);
  await timed(withStyles);
  const reference = await timed(withStyles);
  const plain = await timed(withoutStyles);
  expect(plain.wb.activeSheet.cells.size).toBe(60000);
  expect(plain.wb.getValue(plain.wb.activeSheetId, 29999, 1)).toBe('t30000');
  expect(plain.ms).toBeLessThan(reference.ms * 3 + 500);
});
