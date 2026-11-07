// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildPrintTable, buildPrintSheet } from '../src/ui/print.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// The printed block came from the used range, which counts only cells with a value or formula, so a
// sheet whose cells carried nothing but fills and borders (a blank form, a sign-up sheet) printed
// nothing, and a formatted region before the first value was left off the page. The printed range now
// includes formatted cells, so such a template prints as designed.
const rows = (table) => [...table.querySelectorAll('tr')];
const cells = (table) => rows(table).map((tr) => [...tr.children]);

describe('formatted blank cells in the printed block', () => {
  it('print a form of fills and borders that holds no value', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.applyStyle(id, parseRange('B2:D4'), { bg: '#ffff00' });
    wb.applyBorders(id, parseRange('B2:D4'), 'all');
    const table = buildPrintTable(wb, id, { headers: true });
    expect(rows(table)).toHaveLength(4); // the letters row and rows 2–4
    expect([...rows(table)[0].children].map((th) => th.textContent)).toEqual(['', 'B', 'C', 'D']);
    const b2 = cells(table)[1][1];
    expect(b2.style.backgroundColor).toBe('rgb(255, 255, 0)');
    expect(b2.style.borderTop).toContain('1px solid');
    expect(b2.textContent).toBe('');
  });

  it('start the block at a formatted region before the first value, and end it after one past the last', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.applyStyle(id, parseRange('A1:C3'), { bg: '#ffff00' });
    wb.setInput(id, 4, 1, 'x'); // B5
    wb.applyBorders(id, parseRange('D7:D7'), 'outer'); // a border alone counts too
    const table = buildPrintTable(wb, id);
    expect(rows(table)).toHaveLength(7);
    expect(table.querySelectorAll('col')).toHaveLength(4);
    expect(cells(table)[0][0].style.backgroundColor).toBe('rgb(255, 255, 0)');
    expect(cells(table)[4][1].textContent).toBe('x');
    expect(cells(table)[6][3].style.borderLeft).toContain('1px solid');
  });

  it('leave out blank cells whose formatting prints nothing, such as bold or a number format', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'a');
    wb.setInput(id, 1, 0, 'b');
    wb.applyStyle(id, parseRange('E10:E10'), { bold: true, fmt: 'currency', cur: 'USD' });
    const table = buildPrintTable(wb, id);
    expect(rows(table)).toHaveLength(2);
    expect(table.querySelectorAll('col')).toHaveLength(1);
    // Nothing but such formatting prints nothing at all.
    const empty = new Workbook();
    empty.applyStyle(empty.sheets[0].id, parseRange('A1:B2'), { bold: true });
    expect(rows(buildPrintTable(empty, empty.sheets[0].id))).toHaveLength(0);
  });

  it('take a fill that runs to the sheet\'s last row or column as a column or row format, not as the block\'s edge', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const sheet = wb.sheet(id);
    wb.setInput(id, 0, 0, 'a'); wb.setInput(id, 0, 1, '1');
    wb.setInput(id, 2, 0, 'c'); wb.setInput(id, 2, 1, '3');
    wb.applyStyle(id, { r1: 0, c1: 5, r2: sheet.rows - 1, c2: 5 }, { bg: '#ffff00' }); // column F filled top to bottom
    wb.applyStyle(id, { r1: 6, c1: 0, r2: 6, c2: sheet.cols - 1 }, { bg: '#00ff00' }); // row 7 filled edge to edge
    const table = buildPrintTable(wb, id);
    expect(rows(table)).toHaveLength(3);
    expect(table.querySelectorAll('col')).toHaveLength(2);
  });

  it('still widen the block over spilled results and floating objects', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, '=SEQUENCE(5)');
    wb.applyStyle(id, parseRange('C1:C2'), { bg: '#ffff00' });
    wb.addChart(id, { type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', anchor: { r: 1, c: 4 }, w: 50, h: 50 });
    const sheet = buildPrintSheet(wb, id, {});
    expect(rows(sheet.querySelector('table'))).toHaveLength(5);
    expect(sheet.querySelector('table').querySelectorAll('col')).toHaveLength(5);
    expect(sheet.querySelectorAll('.print-object')).toHaveLength(1);
  });
});
