// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildPrintTable, buildPrintSheet, buildPrintRoot, printableWidth } from '../src/ui/print.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// "Fit to page width" wrote every column as a percentage of the table and stretched the table to the
// page, so a sheet wider than the printable width drew each column at a fraction of its screen width at
// the same font size, and the print CSS then cut every value that no longer fit with an ellipsis
// (1,234,5…). Fitting now scales the whole page, text included, so nothing is cut.
function wide(columns = 12, rows = 2) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) wb.setInput(id, r, c, '1234567');
  return { wb, id };
}

describe('fit to page width', () => {
  it('knows the printable width of each paper, orientation and margin', () => {
    expect(printableWidth({ paper: 'letter', orientation: 'portrait', margins: 'normal' })).toBeCloseTo(725.3, 0);
    expect(printableWidth({ paper: 'letter', orientation: 'landscape', margins: 'normal' })).toBeCloseTo(965.3, 0);
    expect(printableWidth({ paper: 'a4', orientation: 'portrait', margins: 'wide' })).toBeCloseTo(642.5, 0);
    expect(printableWidth({ paper: 'tabloid', orientation: 'portrait', margins: 'narrow' })).toBeCloseTo(1010.6, 0);
    expect(printableWidth({})).toBeCloseTo(725.3, 0); // the defaults: Letter, portrait, normal
  });

  it('zooms a table wider than the page down to it, text and all, with pixel widths', () => {
    const { wb, id } = wide(12); // 1,200px of columns
    const table = buildPrintTable(wb, id, { fit: 'width', paper: 'letter', orientation: 'portrait', margins: 'normal' });
    expect(table.classList.contains('actual')).toBe(true);
    expect(table.style.width).toBe('1200px');
    expect(table.style.zoom).toBe('0.6'); // 725.3 / 1200, rounded down to a whole percentage
    expect(buildPrintTable(wb, id, { fit: 'width', paper: 'a4', orientation: 'portrait', margins: 'normal' }).style.zoom).toBe('0.58');
    expect(buildPrintTable(wb, id, { fit: 'width', paper: 'letter', orientation: 'landscape', margins: 'normal' }).style.zoom).toBe('0.8');
    expect(buildPrintTable(wb, id, { fit: 'width', paper: 'letter', orientation: 'portrait', margins: 'wide' }).style.zoom).toBe('0.55');
    expect(buildPrintTable(wb, id, { fit: 'width', paper: 'letter', orientation: 'portrait', margins: 'narrow' }).style.zoom).toBe('0.64');
    // Row and column headers take their column's width from the page too.
    expect(buildPrintTable(wb, id, { fit: 'width', headers: true }).style.zoom).toBe('0.58');
    // Left out, the page is the default one.
    expect(buildPrintTable(wb, id, { fit: 'width' }).style.zoom).toBe('0.6');
    expect(buildPrintTable(wb, id, {}).style.zoom).toBe('0.6');
  });

  it('still stretches a table narrower than the page to it, and leaves actual size and custom scales alone', () => {
    const { wb, id } = wide(3);
    const table = buildPrintTable(wb, id, { fit: 'width' });
    expect(table.classList.contains('actual')).toBe(false);
    expect(table.style.width).toBe('');
    expect(table.style.zoom || '').toBe(''); // never set (jsdom reads an unset zoom as undefined)
    expect(table.querySelector('col').style.width).toBe('33.33%');
    const { wb: big, id: bigId } = wide(12);
    expect(buildPrintTable(big, bigId, { fit: 'actual' }).style.zoom || '').toBe('');
    expect(buildPrintTable(big, bigId, { fit: 'scale', scale: 80 }).style.zoom).toBe('0.8');
  });

  it('goes no smaller than ten percent', () => {
    const { wb, id } = wide(26, 1);
    for (let c = 0; c < 26; c++) wb.setColWidth(id, c, 400); // 10,400px
    expect(buildPrintTable(wb, id, { fit: 'width' }).style.zoom).toBe('0.1');
  });

  it('places objects in pixels inside the zoomed sheet, and carries the page from the print options', () => {
    const { wb, id } = wide(12);
    wb.addChart(id, { type: 'column', range: parseRange('A1:B2'), anchor: { r: 0, c: 2 }, dx: 8, dy: 6, w: 240, h: 150 });
    const sheet = buildPrintSheet(wb, id, { fit: 'width' });
    expect(sheet.style.zoom).toBe('0.6');
    expect(sheet.querySelector('table').style.zoom).toBe('');
    expect(sheet.querySelector('.print-object').style.left).toBe('208px');
    const root = buildPrintRoot(wb, id, 'Wide', { fit: 'width', paper: 'a4', orientation: 'landscape', marginBoxes: false });
    expect(root.querySelector('.print-sheet').style.zoom).toBe('0.85');
    expect(root.querySelector('style').textContent).toContain('@page { size: A4 landscape; margin: 12mm; }');
    // A sheet that fits is stretched as before, objects placed as percentages.
    const { wb: small, id: smallId } = wide(3);
    small.addChart(smallId, { type: 'column', range: parseRange('A1:B2'), anchor: { r: 0, c: 1 }, dx: 0, dy: 0, w: 100, h: 60 });
    expect(buildPrintSheet(small, smallId, { fit: 'width' }).querySelector('.print-object').style.left).toMatch(/%$/);
  });
});
