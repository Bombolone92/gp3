// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintSheet, buildPrintTable } from '../src/ui/print.js';

function filteredBook() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const [r, text] of ['Status', 'Excluded', 'Included', 'Included'].entries()) wb.setInput(id, r, 0, text);
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 3, c2: 0 });
  wb.setFilterCriteria(id, 0, { values: ['Included'] });
  return { wb, id };
}

describe('printing filtered sheets', () => {
  it('prints only visible rows, retaining original row headings and repeated headers', () => {
    const { wb, id } = filteredBook();
    wb.setHidden(id, 'row', [3], true);
    const table = buildPrintTable(wb, id, { headers: true, repeatRows: 1 });
    expect([...table.querySelectorAll('tr')].map((row) => row.textContent)).toEqual(['A', '1Status', '3Included']);
    expect(table.querySelectorAll('thead tr')).toHaveLength(2);
    expect(wb.getValue(id, 1, 0)).toBe('Excluded');
    wb.clearFilter(id);
    expect(buildPrintTable(wb, id).textContent).toContain('Excluded');
  });

  it('prints an object anchored in a filtered row where the screen shows it, over the next visible row', () => {
    const { wb, id } = filteredBook();
    for (const r of [1, 2]) wb.addChart(id, { type: 'text', text: `Object ${r}`, anchor: { r, c: 0 }, dx: 0, dy: 5, w: 100, h: 40 });
    const sheet = buildPrintSheet(wb, id, { fit: 'actual' });
    const objects = [...sheet.querySelectorAll('.print-object')];
    expect(objects.map((o) => o.textContent)).toEqual(['Object 1', 'Object 2']);
    // Row 2 is filtered out: both objects sit just under the header row, as on screen, where the grid
    // draws an object at its anchor's collapsed position rather than dropping it.
    for (const o of objects) expect(o.style.top).toBe(`${wb.rowHeight(id, 0) + 5}px`);
  });
});
