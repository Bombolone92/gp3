// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintTable } from '../src/ui/print.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { cellsToHtml } from '../src/core/clipboard.js';
import { parseRange } from '../src/core/cell.js';

// A format applied to a whole column or row is kept on the line itself, so it holds for the rows the
// sheet has not reached yet without storing a cell for each of them. Print, charts and the clipboard
// still read `cell.s` alone, so a value written far below the handful of cells the format materialised
// came out plain: a currency column charted as bare numbers, a yellow column printed white.
const big = (rows = 5000) => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.ensureSize(id, rows, 26);
  return { wb, id, sheet: wb.sheet(id) };
};
const wholeColumn = (wb, id, c) => ({ r1: 0, c1: c, r2: wb.sheet(id).rows - 1, c2: c });
const bodyRows = (table) => [...table.querySelectorAll('tbody tr')];

describe('printing a whole-column or whole-row format', () => {
  it('prints a value written far below the format with the column\'s fill, weight and number format', () => {
    const { wb, id } = big();
    wb.setInput(id, 0, 0, 'Name');
    wb.applyStyle(id, wholeColumn(wb, id, 1), { bg: '#ffff00', bold: true, fmt: 'currency', cur: 'USD' });
    wb.setCells(id, [{ r: 3000, c: 1, cell: { v: 5, f: null } }], 'Paste');
    const last = [...bodyRows(buildPrintTable(wb, id)).pop().children];
    expect(last[1].textContent).toBe('$5.00');
    expect(last[1].style.backgroundColor).toBe('rgb(255, 255, 0)');
    expect(last[1].style.fontWeight).toBe('600');
  });

  it('prints the fill of a blank cell in such a column, as the grid draws it', () => {
    const { wb, id } = big();
    wb.applyStyle(id, wholeColumn(wb, id, 1), { bg: '#ffff00' });
    wb.setCells(id, [{ r: 2000, c: 0, cell: { v: 'a', f: null } }, { r: 2000, c: 2, cell: { v: 'c', f: null } }], 'Paste');
    const row = [...bodyRows(buildPrintTable(wb, id))[0].children];
    expect(row.map((td) => td.textContent)).toEqual(['a', '', 'c']);
    expect(row[1].style.backgroundColor).toBe('rgb(255, 255, 0)');
  });

  it('still takes such a format as a column or row format, not as the printed block\'s edge', () => {
    const { wb, id } = big();
    for (let r = 0; r < 10; r++) for (let c = 0; c < 3; c++) wb.setInput(id, r, c, String(r + c));
    wb.applyStyle(id, wholeColumn(wb, id, 1), { bg: '#ffff00' }); // through the data
    wb.applyStyle(id, wholeColumn(wb, id, 5), { bg: '#ffff00' }); // beside it
    wb.applyStyle(id, { r1: 20, c1: 0, r2: 20, c2: wb.sheet(id).cols - 1 }, { bg: '#00ff00' }); // below it
    const table = buildPrintTable(wb, id);
    // The cells the format materialised beside the data must not stretch the block either.
    expect(bodyRows(table)).toHaveLength(10);
    expect(table.querySelectorAll('col')).toHaveLength(3);
  });

  it('asks the workbook for a line format only on a sheet that has one', { timeout: 60000 }, () => {
    const count = (wb, id) => {
      let calls = 0;
      const real = wb.styleAt.bind(wb);
      wb.styleAt = (...a) => { calls++; return real(...a); };
      buildPrintTable(wb, id);
      wb.styleAt = real;
      return calls;
    };
    const plain = new Workbook();
    const pid = plain.sheets[0].id;
    for (let r = 0; r < 200; r++) for (let c = 0; c < 20; c++) plain.setInput(pid, r, c, String(r + c));
    expect(count(plain, pid)).toBe(0);
    // With one, the lookup is per printed cell and no more: 200 × 20 cells, twice over at the very most.
    const lined = new Workbook();
    const lid = lined.sheets[0].id;
    for (let r = 0; r < 200; r++) for (let c = 0; c < 20; c++) lined.setInput(lid, r, c, String(r + c));
    lined.applyStyle(lid, wholeColumn(lined, lid, 1), { bg: '#ffff00' });
    expect(count(lined, lid)).toBeLessThanOrEqual(2 * 200 * 20);
  });
});

describe('a chart over a whole-column format', () => {
  it('takes the column\'s number format for its axis and its tooltips', () => {
    const { wb, id } = big();
    wb.applyStyle(id, wholeColumn(wb, id, 1), { fmt: 'currency', cur: 'USD' });
    wb.setCells(id, [
      { r: 1000, c: 0, cell: { v: 'a', f: null } }, { r: 1000, c: 1, cell: { v: 5, f: null } },
      { r: 1001, c: 0, cell: { v: 'b', f: null } }, { r: 1001, c: 1, cell: { v: 7, f: null } },
    ], 'Paste');
    const chart = { type: 'column', range: parseRange('A1001:B1002'), legend: false };
    const data = chartData(wb, id, chart);
    expect(data.valueStyle).toMatchObject({ fmt: 'currency', cur: 'USD' });
    expect(renderChartSvg(data, chart, 480, 300)).toContain('$');
  });
});

describe('copying a cell in a whole-column format', () => {
  it('writes the format the column gives it into the HTML flavour, leaving the embedded cells alone', () => {
    const { wb, id } = big();
    wb.applyStyle(id, wholeColumn(wb, id, 1), { bg: '#ffff00', fmt: 'currency', cur: 'USD' });
    wb.setCells(id, [{ r: 3000, c: 1, cell: { v: 5, f: null } }], 'Paste');
    const range = { r1: 3000, c1: 1, r2: 3000, c2: 1 };
    const cells = wb.copyRange(id, range);
    const styles = [[wb.styleAt(id, 3000, 1)]];
    const html = cellsToHtml([[wb.getDisplay(id, 3000, 1)]], cells, null, [[5]], null, { styles });
    expect(html).toContain('background-color:#ffff00');
    expect(html).toContain('mso-number-format');
    // The embedded copy is the cells as the sheet stores them, so an in-app paste is unchanged.
    expect(html).toContain(`data-spreadsheet-cells="${JSON.stringify(cells).replace(/"/g, '&quot;')}"`);
  });
});
