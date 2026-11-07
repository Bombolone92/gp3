import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Large ranges must have the same complete appearance as small ones, while
// storing formatting as line defaults or sparse rectangles.
function bigSheet(rows = 3000) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.ensureSize(id, rows, 26);
  return { wb, id, rows };
}

describe('borders over a selection of more than 50,000 cells', () => {
  it('draws all borders across the whole sheet and future cells without allocating blanks', () => {
    const { wb, id, rows } = bigSheet();
    wb.setInput(id, 0, 0, 'x');
    wb.setInput(id, 4, 1, 'y');
    const events = [];
    wb.addEventListener('change', (e) => { if (e.detail.type === 'cells') events.push(e.detail); });
    wb.applyBorders(id, { r1: 0, c1: 0, r2: rows - 1, c2: 25, scope: 'sheet' }, 'all');
    expect(events.length).toBeGreaterThan(0);
    expect(wb.styleAt(id, 0, 0).bt).toBe(true);
    expect(wb.styleAt(id, 4, 1).br).toBe(true);
    expect(wb.styleAt(id, 50, 10).bl).toBe(true);
    expect(wb.styleAt(id, 2500, 0).br).toBe(true);
    expect(wb.styleAt(id, 800000, 14000).br).toBe(true);
    expect(wb.activeSheet.cells.size).toBe(2);
  });

  it('draws an outline on the selection\'s own edges however many rows it spans', () => {
    const { wb, id, rows } = bigSheet();
    wb.applyBorders(id, { r1: 1, c1: 1, r2: rows - 1, c2: 25 }, 'outer');
    expect(wb.styleAt(id, 1, 1)).toMatchObject({ bt: true, bl: true });
    expect(wb.styleAt(id, rows - 1, 25)).toMatchObject({ bb: true, br: true });
    expect(wb.styleAt(id, 1500, 1)).toMatchObject({ bl: true });
    expect(wb.styleAt(id, 1500, 1).bt).toBeFalsy();
    expect(wb.getCell(id, 1500, 10)).toBeUndefined();
  });

  it('draws one named side on that side whole', () => {
    const { wb, id, rows } = bigSheet();
    wb.applyBorders(id, { r1: 1, c1: 1, r2: rows - 1, c2: 25 }, 'bottom');
    expect(wb.styleAt(id, rows - 1, 12)).toMatchObject({ bb: true });
    expect(wb.getCell(id, 0, 12)).toBeUndefined();
  });

  it('clears borders from the cells that carry them', () => {
    const { wb, id, rows } = bigSheet();
    wb.setInput(id, 7, 3, 'z');
    wb.applyBorders(id, { r1: 7, c1: 3, r2: 7, c2: 3 }, 'all');
    expect(wb.getCell(id, 7, 3).s.bt).toBe(true);
    wb.applyBorders(id, { r1: 0, c1: 0, r2: rows - 1, c2: 25 }, 'none');
    expect(wb.getCell(id, 7, 3).s).toBeUndefined();
  });

  it('restyles the borders already on the sheet', () => {
    const { wb, id, rows } = bigSheet();
    wb.applyBorders(id, { r1: 2, c1: 2, r2: 3, c2: 3 }, 'all');
    wb.applyBorders(id, { r1: 0, c1: 0, r2: rows - 1, c2: 25 }, 'restyle', { color: '#ff0000', style: 'thick' });
    expect(wb.getCell(id, 2, 2).s).toMatchObject({ bc: '#ff0000', bs: 'thick' });
  });

  it('applies the whole gesture when a cell style pairs a style with a border', () => {
    const { wb, id, rows } = bigSheet();
    const block = { r1: 1, c1: 0, r2: rows - 1, c2: 19 }; // 59,980 cells, and not a whole column
    wb.transaction('Cell style', () => {
      wb.applyStyle(id, block, { bold: true });
      wb.applyBorders(id, block, 'top');
    });
    expect(wb.styleAt(id, 1, 0)).toMatchObject({ bold: true, bt: true });
    wb.undo();
    expect(wb.getCell(id, 1, 0)).toBeUndefined();
  });

  it('still fills every cell of a selection under the cap', () => {
    const { wb, id } = bigSheet(100);
    wb.applyBorders(id, { r1: 1, c1: 1, r2: 98, c2: 24 }, 'all');
    expect(wb.getCell(id, 98, 24).s).toMatchObject({ bt: true, bb: true, bl: true, br: true });
  });
});
