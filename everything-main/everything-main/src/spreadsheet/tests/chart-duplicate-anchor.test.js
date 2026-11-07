import { describe, expect, it } from 'vitest';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { defaultChart, placeAlong } from '../src/core/charts.js';

// Duplicate nudged the copy 24 pixels down and right but kept the original's anchor, so after a few
// duplicates the copy was anchored to a cell it did not lie in: hiding or narrowing that column moved
// it, inserting a column where it actually lay left it behind, and deleting the anchor column dropped
// it onto the cells that took the column's place. A drag anchors an object to the cell under its
// corner; a duplicate now does the same, kept inside the sheet.
function book() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'a'); wb.setInput(id, 0, 1, '3');
  const left = (ch) => { let x = 0; for (let c = 0; c < ch.anchor.c; c++) x += wb.colWidth(id, c); return x + ch.dx; };
  const top = (ch) => { let y = 0; for (let r = 0; r < ch.anchor.r; r++) y += wb.rowHeight(id, r); return y + ch.dy; };
  return { wb, id, left, top };
}

describe('duplicating a floating object', () => {
  it('anchors each copy to the cell its corner lies in, 24 pixels down and right of the original', () => {
    const { wb, id, left, top } = book();
    let cid = wb.addChart(id, { ...defaultChart(parseRange('A1:B1'), { r: 0, c: 3 }), dx: 8, dy: 6 });
    const first = wb.chartById(id, cid);
    for (let k = 1; k <= 5; k++) {
      cid = wb.duplicateChart(id, cid);
      const copy = wb.chartById(id, cid);
      expect(left(copy), `copy ${k}`).toBe(left(first) + 24 * k);
      expect(top(copy), `copy ${k}`).toBe(top(first) + 24 * k);
      expect(copy.dx, `copy ${k}`).toBeLessThan(wb.colWidth(id, copy.anchor.c));
      expect(copy.dy, `copy ${k}`).toBeLessThan(wb.rowHeight(id, copy.anchor.r));
    }
    const last = wb.chartById(id, cid);
    // 8 + 120 = 128 px past D lands 28 px into E; 6 + 120 = 126 px down lands in the row holding it.
    const rows = Math.floor(126 / DEFAULT_ROW_HEIGHT);
    expect(last.anchor).toEqual({ r: rows, c: 4 });
    expect([last.dx, last.dy]).toEqual([28, 126 - rows * DEFAULT_ROW_HEIGHT]);
    // Inserting a column before E moves the copy with it and leaves the original at D.
    wb.insertCols(id, 4, 1);
    expect(wb.chartById(id, cid).anchor.c).toBe(5);
    expect(wb.chartById(id, first.id).anchor.c).toBe(3);
  });

  it('passes over a hidden column or row rather than anchoring the copy to it', () => {
    const { wb, id } = book();
    wb.setHidden(id, 'col', [4], true); // E
    wb.setHidden(id, 'row', [1], true);
    const cid = wb.duplicateChart(id, wb.addChart(id, { ...defaultChart(parseRange('A1:B1'), { r: 0, c: 3 }), dx: 90, dy: 20 }));
    const copy = wb.chartById(id, cid);
    // 20 + 24 = 44 px down, with row 2 hidden, counts rows 1, 3, 4… only.
    let dy = 44, r = 0;
    while (r === 1 || dy >= DEFAULT_ROW_HEIGHT) { if (r !== 1) dy -= DEFAULT_ROW_HEIGHT; r++; }
    expect(copy.anchor).toEqual({ r, c: 5 });
    expect([copy.dx, copy.dy]).toEqual([14, dy]);
  });

  it('keeps the copy inside the sheet, pulled back from its right and bottom edges', () => {
    const { wb, id, left, top } = book();
    const sheet = wb.sheet(id);
    let width = 0; for (let c = 0; c < sheet.cols; c++) width += wb.colWidth(id, c);
    let height = 0; for (let r = 0; r < sheet.rows; r++) height += wb.rowHeight(id, r);
    const cid = wb.duplicateChart(id, wb.addChart(id, { ...defaultChart(parseRange('A1:B1'), { r: sheet.rows - 3, c: sheet.cols - 2 }), dx: 50, dy: 10, w: 480, h: 300 }));
    const copy = wb.chartById(id, cid);
    expect(left(copy) + copy.w).toBe(width);
    expect(top(copy) + copy.h).toBe(height);
    expect(copy.dx).toBeLessThan(wb.colWidth(id, copy.anchor.c));
    expect(copy.dy).toBeLessThan(wb.rowHeight(id, copy.anchor.r));
  });

  it('places along a line of widths as the grid does: past hidden lines, and back from the sheet\'s end', () => {
    const widths = [100, 0, 100, 50];
    const sizeOf = (i) => widths[i];
    expect(placeAlong(sizeOf, 4, 0, 30, 20)).toEqual({ index: 0, offset: 30 });
    expect(placeAlong(sizeOf, 4, 0, 100, 20)).toEqual({ index: 2, offset: 0 }); // the hidden second line has no span to land in
    expect(placeAlong(sizeOf, 4, 0, 230, 10)).toEqual({ index: 3, offset: 30 });
    expect(placeAlong(sizeOf, 4, 0, 249, 30)).toEqual({ index: 3, offset: 20 }); // pulled back 29 to end at 250
    expect(placeAlong(sizeOf, 4, 2, 140, 100)).toEqual({ index: 2, offset: 50 }); // from the third line, pulled back over two
    expect(placeAlong(sizeOf, 4, 0, 0, 1000)).toEqual({ index: 0, offset: 0 }); // wider than the sheet: at its start
  });
});
