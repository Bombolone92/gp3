// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildPrintSheet } from '../src/ui/print.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// A chart, image or text box whose anchor row or column was hidden (by hand or by a filter) was left out
// of the printout, while the grid keeps drawing it at its anchor's position, collapsed onto the next
// visible line; so the screen showed the chart and the paper did not.
function book() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  [['x', 'y'], ['1', '2'], ['3', '5']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  wb.setInput(id, 0, 5, 'end'); // F1, so the block spans A–F
  return { wb, id };
}
const objects = (sheet) => [...sheet.querySelectorAll('.print-object')];

describe('objects anchored in hidden lines', () => {
  it('print at the position the next visible column gives when the anchor column is hidden', () => {
    const { wb, id } = book();
    wb.addChart(id, { type: 'column', range: parseRange('A1:B3'), anchor: { r: 0, c: 3 }, dx: 4, dy: 0, w: 200, h: 100 }); // D1
    expect(objects(buildPrintSheet(wb, id, { fit: 'actual' }))).toHaveLength(1);
    wb.setHidden(id, 'col', [3], true);
    const hidden = objects(buildPrintSheet(wb, id, { fit: 'actual' }));
    expect(hidden).toHaveLength(1);
    expect(hidden[0].style.left).toBe(`${3 * wb.colWidth(id, 0) + 4}px`); // after A, B and C, where E now starts
    expect(hidden[0].querySelector('svg')).not.toBeNull();
    const withHeaders = objects(buildPrintSheet(wb, id, { fit: 'actual', headers: true }));
    expect(withHeaders[0].style.left).toBe(`${34 + 3 * wb.colWidth(id, 0) + 4}px`);
  });

  it('print at the position the next visible row gives when the anchor row is hidden', () => {
    const { wb, id } = book();
    wb.addChart(id, { type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', anchor: { r: 1, c: 0 }, dx: 0, dy: 3, w: 50, h: 50 });
    wb.setHidden(id, 'row', [1], true);
    const [image] = objects(buildPrintSheet(wb, id, { fit: 'actual' }));
    expect(image).toBeDefined();
    expect(image.style.top).toBe(`${wb.rowHeight(id, 0) + 3}px`); // under row 1, where row 3 now begins
    // Hidden at the very top, it prints at the top.
    wb.setHidden(id, 'row', [1], false);
    wb.setHidden(id, 'row', [0], true);
    wb.sheet(id).charts[0].anchor = { r: 0, c: 0 };
    expect(objects(buildPrintSheet(wb, id, { fit: 'actual' }))[0].style.top).toBe('3px');
  });

  it('still leave out an object outside the printed selection', () => {
    const { wb, id } = book();
    wb.addChart(id, { type: 'text', text: 'note', anchor: { r: 0, c: 3 }, dx: 0, dy: 0, w: 100, h: 40 });
    wb.setHidden(id, 'col', [3], true);
    expect(objects(buildPrintSheet(wb, id, { fit: 'actual', range: parseRange('A1:B3') }))).toHaveLength(0);
    expect(objects(buildPrintSheet(wb, id, { fit: 'actual', range: parseRange('A1:F3') }))).toHaveLength(1);
  });
});
