import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// A merged block is drawn from its anchor, whose style carried only the top and left edges of an
// outline: the bottom and right edges were stored on cells the merge hides, so the block showed two
// sides. The anchor now carries the whole outline; the edge cells keep theirs for export.
describe('borders on a merged block', () => {
  const setup = () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.mergeCells(id, parseRange('A1:B2'));
    const s = (a) => { const { r1, c1 } = parseRange(a); return wb.getCell(id, r1, c1)?.s; };
    return { wb, id, s };
  };

  it('puts the outline\'s bottom and right edges on the anchor too, with their colour and style', () => {
    const { wb, id, s } = setup();
    wb.applyBorders(id, parseRange('A1:B2'), 'outer', { color: '#c22a2a', style: 'thick' });
    expect(s('A1')).toEqual({ bt: true, bb: true, bl: true, br: true, bc: '#c22a2a', bs: 'thick' });
    expect(s('A2')).toEqual({ bl: true, bb: true, bc: '#c22a2a', bs: 'thick' });
    expect(s('B1')).toEqual({ bt: true, br: true, bc: '#c22a2a', bs: 'thick' });
    expect(s('B2')).toEqual({ bb: true, br: true, bc: '#c22a2a', bs: 'thick' });
    wb.undo();
    expect([s('A1'), s('A2'), s('B1'), s('B2')]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('follows a single side and clears with the sides', () => {
    const { wb, id, s } = setup();
    wb.applyBorders(id, parseRange('A1:B2'), 'bottom', { color: '#0a63f0' });
    expect(s('A1')).toEqual({ bb: true, bc: '#0a63f0' });
    expect(s('B2')).toEqual({ bb: true, bc: '#0a63f0' });
    expect(s('B1')).toBeUndefined();
    wb.applyBorders(id, parseRange('A1:B2'), 'right');
    expect(s('A1')).toEqual({ bb: true, br: true, bc: '#0a63f0' });
    expect(s('B1')).toEqual({ br: true });
    wb.applyBorders(id, parseRange('A1:B2'), 'none');
    expect([s('A1'), s('A2'), s('B1'), s('B2')]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('inside a larger range, mirrors what the block\'s last row and column were given', () => {
    const { wb, id, s } = setup();
    wb.applyBorders(id, parseRange('A1:C3'), 'outer');
    expect(s('A1')).toEqual({ bt: true, bl: true }); // the block's bottom and right are inner lines of the range
    wb.applyBorders(id, parseRange('A1:C3'), 'inner');
    expect(s('A1')).toEqual({ bt: true, bl: true, bb: true, br: true });
    wb.applyBorders(id, parseRange('A1:C3'), 'none');
    wb.applyBorders(id, parseRange('A1:C3'), 'all');
    expect(s('A1')).toEqual({ bt: true, bb: true, bl: true, br: true });
    expect(s('C3')).toEqual({ bt: true, bb: true, bl: true, br: true });
  });

  it('treats a block one row or one column tall the same way', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.mergeCells(id, parseRange('D1:F1'));
    wb.applyBorders(id, parseRange('D1:F1'), 'outer');
    expect(wb.getCell(id, 0, 3).s).toEqual({ bt: true, bb: true, bl: true, br: true });
    expect(wb.getCell(id, 0, 5).s).toEqual({ bt: true, bb: true, br: true });
    wb.mergeCells(id, parseRange('A5:A7'));
    wb.applyBorders(id, parseRange('A5:A7'), 'outer', { style: 'dashed' });
    expect(wb.getCell(id, 4, 0).s).toEqual({ bt: true, bb: true, bl: true, br: true, bs: 'dashed' });
    expect(wb.getCell(id, 6, 0).s).toEqual({ bb: true, bl: true, br: true, bs: 'dashed' });
  });
});
