import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

/**
 * Merging keeps the top-left value and clears the rest. The warning lived only in the editor's own
 * menu command, which counts the cells before merging, so every other door — a script, a template, an
 * import, a future menu entry — merged destructively in silence. The model now says so itself.
 */
function heard(wb) {
  const seen = [];
  wb.addEventListener('change', (e) => { if (e.detail.type === 'merged-values-dropped') seen.push(e.detail); });
  return seen;
}

describe('merging cells that hold something', () => {
  it('says which range lost values and how many, once they are cleared', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (const [r, c] of [[0, 0], [0, 1], [1, 0]]) wb.setInput(id, r, c, `cell ${r}${c}`);
    const seen = heard(wb);
    let atEvent;
    wb.addEventListener('change', (e) => { if (e.detail.type === 'merged-values-dropped') atEvent = wb.getValue(id, 0, 1); });
    expect(wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 })).toBe(true);
    expect(seen).toEqual([{ type: 'merged-values-dropped', sheetId: id, range: { r1: 0, c1: 0, r2: 1, c2: 1 }, count: 2 }]);
    expect(atEvent).toBe(null); // said after the write, so a listener reading the cells sees them cleared
    expect(wb.getValue(id, 0, 0)).toBe('cell 00');
  });

  it('counts a formula the merge discards as well as a value', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1');
    wb.setInput(id, 0, 1, '=A1+1');
    const seen = heard(wb);
    wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 1 });
    expect(seen[0].count).toBe(1);
  });

  it('says nothing when the block holds only its top-left value, or nothing at all', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'only');
    const seen = heard(wb);
    expect(wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 })).toBe(true);
    expect(wb.mergeCells(id, { r1: 4, c1: 0, r2: 5, c2: 1 })).toBe(true);
    expect(seen).toEqual([]);
  });

  it('says nothing for a merge that is refused', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'a');
    wb.setInput(id, 0, 1, 'b');
    wb.protectRange(id, { r1: 0, c1: 0, r2: 0, c2: 1 });
    const seen = heard(wb);
    expect(wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 1 })).toBe(false);
    expect(seen).toEqual([]);
    expect(wb.getValue(id, 0, 1)).toBe('b');
  });

  it('is announced with the batch it belongs to, not from inside it', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (const [r, c] of [[0, 0], [0, 1], [2, 0], [2, 1]]) wb.setInput(id, r, c, `${r}${c}`);
    const seen = heard(wb);
    let inBody = true;
    wb.addEventListener('change', (e) => { if (e.detail.type === 'merged-values-dropped') e.detail.duringBody = inBody; });
    wb.transaction('Merge horizontally', () => {
      wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 1 });
      wb.mergeCells(id, { r1: 2, c1: 0, r2: 2, c2: 1 });
      inBody = false;
    });
    // One announcement per kind and sheet for the batch, the last of them, as every other kind is.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ range: { r1: 2, c1: 0, r2: 2, c2: 1 }, count: 1, duringBody: false });
  });
});
