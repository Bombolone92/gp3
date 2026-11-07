import { describe, expect, it } from 'vitest';
import { Workbook, cellFromInput } from '../src/core/workbook.js';
import { MAX_TEXT } from '../src/core/cell.js';

const long = 'x'.repeat(MAX_TEXT + 100);

// A cell holds no more text than an .xlsx file can store per cell. Only setInput cut a longer entry and
// announced it; text pasted, filled or written through setCells was stored whole and cut silently on save,
// so the file reopened shorter than the session had shown.
describe('text longer than a cell can hold', () => {
  const book = () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const events = [];
    wb.addEventListener('change', (e) => { if (e.detail.type === 'truncated') events.push(e.detail); });
    return { wb, id, events, len: (r, c = 0) => wb.getCell(id, r, c).v.length };
  };

  it('is cut at every door, and each write announces the cut once', () => {
    const { wb, id, events, len } = book();
    wb.pasteValues(id, [[long]], 0, 0);
    wb.setCells(id, [{ r: 1, c: 0, cell: { v: long, f: null } }]);
    wb.pasteCells(id, [[{ v: long, f: null }]], 2, 0, { r: 0, c: 0 });
    wb.fillInput(id, { r1: 3, c1: 0, r2: 3, c2: 0 }, long, { r: 3, c: 0 });
    wb.setInput(id, 4, 0, long);
    wb.setCells(id, [{ r: 5, c: 0, cell: cellFromInput(long, undefined) }]); // the editor's plain-text paste
    wb.pasteLiteralValues(id, [[long]], 6, 0);
    expect([0, 1, 2, 3, 4, 5, 6].map((r) => len(r))).toEqual(Array(7).fill(MAX_TEXT));
    expect(events.map((e) => [e.r, e.c, e.max])).toEqual([0, 1, 2, 3, 4, 5, 6].map((r) => [r, 0, MAX_TEXT]));
    expect(wb.toJSON().sheets[0].cells['0,0'].v.length).toBe(MAX_TEXT);
  });

  it('announces a pasted block of long texts once, naming the first cut cell', () => {
    const { wb, id, events, len } = book();
    wb.pasteValues(id, [['short', long], [long, long]], 2, 3);
    expect([len(2, 4), len(3, 3), len(3, 4)]).toEqual([MAX_TEXT, MAX_TEXT, MAX_TEXT]);
    expect(events).toEqual([{ type: 'truncated', sheetId: id, r: 2, c: 4, max: MAX_TEXT }]);
  });

  it('keeps an emoji at the limit whole when the text is pasted', () => {
    const { wb, id } = book();
    const text = 'a'.repeat(MAX_TEXT - 1) + '😀' + 'b'.repeat(50);
    wb.pasteValues(id, [[text]], 0, 0);
    expect(wb.getCell(id, 0, 0).v.length).toBe(MAX_TEXT - 1); // the pair would have been cut in two
    expect(wb.getCell(id, 0, 0).v.endsWith('a')).toBe(true);
  });

  it('records one undo step for the cut write, and a refused write announces nothing', () => {
    const { wb, id, events } = book();
    wb.pasteValues(id, [[long]], 0, 0);
    expect(wb.undoLabel()).toBe('Paste');
    wb.undo();
    expect(wb.getCell(id, 0, 0)).toBeUndefined();
    wb.protectRange(id, { r1: 1, c1: 0, r2: 1, c2: 0 });
    events.length = 0;
    wb.pasteValues(id, [[long]], 1, 0);
    expect(wb.getCell(id, 1, 0)).toBeUndefined();
    expect(events).toEqual([]);
  });
});
