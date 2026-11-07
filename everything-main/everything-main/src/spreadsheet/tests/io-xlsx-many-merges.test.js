import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';

function withMerges(refs) {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['x']]), 'Data');
  const zip = X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  entry.content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><mergeCells count="${refs.length}">${refs.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells></worksheet>`);
  entry.size = entry.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
const stacked = (n) => Array.from({ length: n }, (_, i) => `A${i + 1}:B${i + 1}`);
async function timed(refs) {
  const bytes = withMerges(refs);
  const start = performance.now();
  const wb = await workbookFromFile(bytes, 'merges.xlsx');
  return { ms: performance.now() - start, merges: wb.activeSheet.merges };
}

// Each merge of a file was checked against every merge kept before it, so a report of
// 20,000 one-row merges, as other programs' exports carry, took seconds to open and grew
// with the square of the count.
it('opens a sheet of thousands of merges in about the time of their count, not its square', { timeout: 60000 }, async () => {
  await timed(stacked(3000));
  const small = await timed(stacked(3000)), large = await timed(stacked(24000));
  expect(small.merges).toHaveLength(3000);
  expect(large.merges).toHaveLength(24000);
  expect(large.merges[23999]).toEqual({ r1: 23999, c1: 0, r2: 23999, c2: 1 });
  // Eight times the merges: eight times the work when linear, sixty-four when quadratic.
  expect(large.ms).toBeLessThan(small.ms * 24 + 500);
});

it('still keeps the first of two overlapping merges among many, whatever their size and order', async () => {
  const refs = [...stacked(500), 'C1:C1048576', 'A250:D260', 'C5:E5', 'F1:XFD1', 'G1:G2', 'E2:E3', 'E600:F700', 'F650:F650', 'A600:B600'];
  const { merges } = await timed(refs);
  const has = (ref) => merges.some((m) => X.utils.encode_range({ s: { r: m.r1, c: m.c1 }, e: { r: m.r2, c: m.c2 } }) === ref);
  expect(merges).toHaveLength(500 + 5);
  expect(has('C1:C1048576')).toBe(true);
  expect(has('A250:D260')).toBe(false); // crosses the stacked rows and the column merge
  expect(has('C5:E5')).toBe(false); // shares C5 with the column merge
  expect(has('F1:XFD1')).toBe(true);
  expect(has('G1:G2')).toBe(false); // shares G1 with the row merge
  expect(has('E2:E3')).toBe(true);
  expect(has('E600:F700')).toBe(true);
  expect(has('F650:F650')).toBe(false); // inside E600:F700
  expect(has('A600:B600')).toBe(true);
});
