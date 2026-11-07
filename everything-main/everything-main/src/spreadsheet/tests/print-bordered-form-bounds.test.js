// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildPrintTable } from '../src/ui/print.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// Paint in the sheet's last row made its whole column a "column format" whose painted-only cells were
// left out of the printed block, and the default sheet is 100 rows: the most natural way to draw a
// form (select all, Borders → All, a title in A1) painted to the last row and printed only A1. Borders
// now count wherever they are, since a bordered cell is a box drawn to be printed; a fill that runs to
// the sheet's last row or column is still a column or row format that prints as far as the data does.
const rows = (table) => table.querySelectorAll('tbody tr').length;
const cols = (table) => table.querySelectorAll('col').length;
const whole = (wb, id, c2) => ({ r1: 0, c1: 0, r2: wb.sheet(id).rows - 1, c2 });

// The forms here are the whole sheet, hundreds to thousands of cells laid out under jsdom: given time under load.
describe('a bordered form that fills the sheet', () => {
  it('prints whole, with a title in its first cell', { timeout: 30000 }, () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Name');
    wb.applyBorders(id, whole(wb, id, 1), 'all');
    const table = buildPrintTable(wb, id);
    expect(rows(table)).toBe(wb.sheet(id).rows);
    expect(cols(table)).toBe(2);
    const last = [...table.querySelectorAll('tbody tr')].pop().children[1];
    expect(last.style.borderBottom).toContain('1px solid');
  });

  it('prints whole with nothing typed into it, as a blank form\'s borders count as used', { timeout: 30000 }, () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.applyBorders(id, whole(wb, id, 2), 'outer');
    const table = buildPrintTable(wb, id);
    expect(rows(table)).toBe(wb.sheet(id).rows);
    expect(cols(table)).toBe(3);
    // The whole sheet bordered edge to edge prints every cell.
    const all = new Workbook();
    const aid = all.sheets[0].id;
    all.setInput(aid, 0, 0, 'Sign-up');
    all.applyBorders(aid, whole(all, aid, all.sheet(aid).cols - 1), 'all');
    const every = buildPrintTable(all, aid);
    expect(rows(every)).toBe(all.sheet(aid).rows);
    expect(cols(every)).toBe(all.sheet(aid).cols);
  });

  it('still prints a column or row filled to the sheet\'s edge only as far as the data', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const sheet = wb.sheet(id);
    for (let r = 0; r < 10; r++) for (let c = 0; c < 3; c++) wb.setInput(id, r, c, String(r + c));
    wb.applyStyle(id, { r1: 0, c1: 1, r2: sheet.rows - 1, c2: 1 }, { bg: '#ffff00' }); // column B, through the data
    wb.applyStyle(id, { r1: 0, c1: 5, r2: sheet.rows - 1, c2: 5 }, { bg: '#ffff00' }); // column F, beside it
    wb.applyStyle(id, { r1: 20, c1: 0, r2: 20, c2: sheet.cols - 1 }, { bg: '#00ff00' }); // row 21, below it
    const table = buildPrintTable(wb, id);
    expect(rows(table)).toBe(10);
    expect(cols(table)).toBe(3);
    // The whole sheet filled, as a background: the data alone prints.
    const filled = new Workbook();
    const fid = filled.sheets[0].id;
    filled.setInput(fid, 0, 0, 'a'); filled.setInput(fid, 1, 1, 'b');
    filled.applyStyle(fid, whole(filled, fid, filled.sheet(fid).cols - 1), { bg: '#eeeeee' });
    expect(rows(buildPrintTable(filled, fid))).toBe(2);
    expect(cols(buildPrintTable(filled, fid))).toBe(2);
  });

  it('takes a border ruled along a whole row or column to the sheet\'s edge as a row or column format', () => {
    // Borders → Bottom on a header row selected by its header underlines every column of the sheet. A
    // lone rule is not a drawn box, so it counts as the row format it is and the table keeps its own
    // width, instead of stretching to column Z and being zoomed to 28% to fit the page.
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const sheet = wb.sheet(id);
    for (let r = 0; r < 10; r++) for (let c = 0; c < 3; c++) wb.setInput(id, r, c, String(r + c));
    wb.applyBorders(id, { r1: 0, c1: 0, r2: 0, c2: sheet.cols - 1 }, 'bottom');
    const table = buildPrintTable(wb, id, { fit: 'width' });
    expect(rows(table)).toBe(10);
    expect(cols(table)).toBe(3);
    expect(table.getAttribute('style') || '').not.toContain('zoom'); // it already fits: nothing is shrunk
    // The header row still prints its rule where the data is.
    expect(table.querySelector('tbody tr').children[0].style.borderBottom).toContain('1px solid');
    // A single side ruled down a whole column to the last row is the same case turned on its side.
    const down = new Workbook();
    const did = down.sheets[0].id;
    for (let r = 0; r < 10; r++) for (let c = 0; c < 3; c++) down.setInput(did, r, c, String(r + c));
    down.applyBorders(did, { r1: 0, c1: 4, r2: down.sheet(did).rows - 1, c2: 4 }, 'left');
    const table2 = buildPrintTable(down, did);
    expect(rows(table2)).toBe(10);
    expect(cols(table2)).toBe(3);
  });

  it('counts a bordered cell in such a column, and a fill that stops short of the edge, as before', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const sheet = wb.sheet(id);
    wb.setInput(id, 0, 0, 'a');
    wb.applyStyle(id, { r1: 0, c1: 3, r2: sheet.rows - 1, c2: 3 }, { bg: '#ffff00' }); // column D filled to the bottom
    wb.applyBorders(id, parseRange('D5:D5'), 'outer'); // one bordered cell in it
    const table = buildPrintTable(wb, id);
    expect(rows(table)).toBe(5);
    expect(cols(table)).toBe(4);
    const short = new Workbook();
    const sid = short.sheets[0].id;
    short.setInput(sid, 0, 0, 'a');
    short.applyStyle(sid, parseRange('C3:C8'), { bg: '#ffff00' });
    expect(rows(buildPrintTable(short, sid))).toBe(8);
    expect(cols(buildPrintTable(short, sid))).toBe(3);
  });
});
