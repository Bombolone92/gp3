import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';

/** A three-sheet .xlsx whose workbook part gives the last two sheets the same name. */
function damaged() {
  const book = X.utils.book_new();
  ['First', 'Second', 'Third'].forEach((name, i) => X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([[(i + 1) * 111]]), name));
  const zip = X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = X.CFB.find(zip, '/xl/workbook.xml');
  const xml = new TextDecoder().decode(entry.content);
  expect(xml).toContain('name="Second"');
  entry.content = new TextEncoder().encode(xml.replace('name="Second"', 'name="Dup"').replace('name="Third"', 'name="Dup"'));
  entry.size = entry.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

// The reader keys sheets by name, so the second of two same-named sheets lands on top of
// the first: the file opened with one sheet's data gone and the other's shown twice, and a
// save wrote it back that way. Excel refuses such a file with a repair prompt; so do we.
it('refuses a workbook whose sheets share a name instead of opening one over the other', async () => {
  await expect(workbookFromFile(damaged(), 'dup.xlsx')).rejects.toThrow(/Two sheets are named "Dup"/);
});

it('still opens a workbook whose sheet names differ only in case, as its writer allowed', async () => {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([[1]]), 'data');
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([[2]]), 'other');
  const zip = X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = X.CFB.find(zip, '/xl/workbook.xml');
  entry.content = new TextEncoder().encode(new TextDecoder().decode(entry.content).replace('name="other"', 'name="Data"'));
  entry.size = entry.content.length;
  const wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'case.xlsx');
  expect(wb.sheets).toHaveLength(2);
  expect(wb.sheets.map((s) => wb.getValue(s.id, 0, 0))).toEqual([1, 2]);
});
