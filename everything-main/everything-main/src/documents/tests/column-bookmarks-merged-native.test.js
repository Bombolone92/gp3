import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';

const folder = 'tests/fixtures/column-bookmarks/';
const reference = JSON.parse(readFileSync(folder + 'merge-native-ranges.json', 'utf8').replace(/^\uFEFF/, ''));
const cases = JSON.parse(readFileSync(folder + 'merge-cases.json', 'utf8'));
const source = readFileSync(folder + 'merge-control.docx');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const expected = {
  PlainMiddle: ['R1C2', 'R2C2', 'R3C2'],
  TopMergedFirst: ['R1C1/R1C2', 'R2C1', 'R2C2', 'R3C1', 'R3C2'],
  TopMergedSecond: ['R1C3', 'R2C3', 'R3C3'],
  TopMergedBoth: ['R1C1/R1C2', 'R1C3', 'R2C1', 'R2C2', 'R2C3', 'R3C1', 'R3C2', 'R3C3'],
  MiddleMergedFirst: ['R1C1', 'R2C1/R2C2', 'R3C1'],
  MiddleMergedSecond: ['R1C2', 'R2C1/R2C2', 'R3C2'],
  BottomMergedSecond: ['R1C2', 'R2C2', 'R3C1/R3C2'],
  StartAfterMerge: ['R2C2', 'R3C2'],
  StartAtMerge: ['R2C3', 'R3C3'],
  EndBeforeMerge: ['R1C2', 'R2C2'],
  InlineEndpoints: ['R1C2', 'R2C2', 'R3C2'],
  TableEnd: ['R1C1', 'R1C2', 'R1C3', 'R2C1', 'R2C2', 'R2C3', 'R3C1', 'R3C2', 'R3C3'],
};

it('binds native merged-column observations to their exact source, PDF and marker configuration', () => {
  expect(hash(source)).toBe(reference.sourceSha256);
  expect(hash(readFileSync(folder + 'merge-native.pdf'))).toBe(reference.pdfSha256);
  expect(reference.pages).toBe(12);
  expect(reference.bookmarks).toHaveLength(cases.length);
  const dom = new JSDOM(strFromU8(unzipSync(source)['word/document.xml']), { contentType: 'text/xml' });
  try {
    const doc = dom.window.document;
    const starts = [...doc.getElementsByTagNameNS(w, 'bookmarkStart')];
    const ends = [...doc.getElementsByTagNameNS(w, 'bookmarkEnd')];
    expect(starts).toHaveLength(cases.length);
    for (const [index, control] of cases.entries()) {
      const start = starts.find(node => node.getAttributeNS(w, 'name') === control.name);
      const end = ends.find(node => node.getAttributeNS(w, 'id') === String(index));
      expect(start.getAttributeNS(w, 'colFirst')).toBe(String(control.first));
      expect(start.getAttributeNS(w, 'colLast')).toBe(String(control.last));
      expect(start.parentElement.localName).toBe(control.inline ? 'p' : 'tc');
      expect(end.parentElement.localName).toBe(control.inline ? 'p' : control.table_end ? 'tbl' : 'tc');
      const table = doc.getElementsByTagNameNS(w, 'tbl')[index];
      const mergedRows = [...table.getElementsByTagNameNS(w, 'tr')]
        .flatMap((row, i) => row.getElementsByTagNameNS(w, 'gridSpan').length ? [i] : []);
      expect(mergedRows).toEqual(control.merge_row === undefined ? [] : [control.merge_row]);
    }
  } finally { dom.window.close(); }
});

it.each(Object.entries(expected))('records the complete native cell selection for %s', (name, cells) => {
  const bookmark = reference.bookmarks.find(entry => entry.name === name);
  expect(bookmark.column).toBe(true);
  expect(bookmark.selectionType).toBe(4);
  expect(bookmark.selectedCellCount).toBe(cells.length);
  expect(bookmark.selectedCells.map(cell => cell.text.replace(/\r\x07$/, '').replaceAll('\r', '/'))).toEqual(cells);
});
