// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintTable } from '../src/ui/print.js';
import { parseRange } from '../src/core/cell.js';

// A merge is drawn from its own top-left cell, and the grid keeps showing the block when that cell's row
// or column is hidden or filtered away. Print used to demand that the first printed line *be* the merge's
// own first line, so a hidden column A blanked a merged title and a filtered group label vanished from the
// page. Only two cases still print nothing: the lower half of a merge the repeating header cut in two
// (an HTML row span cannot cross out of <thead>) and a merge a print selection starts inside.
const bodyText = (table) => [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent).join('|'));

describe('a merge whose own top-left cell is not printed', () => {
  it('prints the merged title when the merge starts in a hidden column', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Quarterly summary');
    wb.mergeCells(id, parseRange('A1:C1'));
    for (let r = 1; r < 4; r++) for (let c = 0; c < 3; c++) wb.setInput(id, r, c, `${r}${c}`);
    wb.setHidden(id, 'col', [0], true);
    const title = buildPrintTable(wb, id).querySelector('tbody td');
    expect(title.textContent).toBe('Quarterly summary');
    expect(title.colSpan).toBe(2);
  });

  it('prints a group label whose row a filter hides, and its style with it', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    for (const [c, text] of ['Group', 'Item', 'Qty'].entries()) wb.setInput(id, 0, c, text);
    wb.setInput(id, 1, 0, 'Group A');
    wb.applyStyle(id, parseRange('A2:A2'), { bold: true });
    wb.mergeCells(id, parseRange('A2:A4'));
    for (let r = 1; r < 4; r++) { wb.setInput(id, r, 1, `b${r}`); wb.setInput(id, r, 2, r === 1 ? 'Excluded' : 'Included'); }
    wb.setFilterRange(id, { r1: 0, c1: 2, r2: 3, c2: 2 });
    wb.setFilterCriteria(id, 2, { values: ['Included'] });
    const table = buildPrintTable(wb, id);
    expect(bodyText(table)).toEqual(['Group|Item|Qty', 'Group A|b2|Included', 'b3|Included']);
    const label = table.querySelectorAll('tbody tr')[1].children[0];
    expect(label.rowSpan).toBe(2);
    expect(label.style.fontWeight).toBe('600');
  });

  it('still leaves the lower half of a merge the repeating header cut blank', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Report title');
    wb.mergeCells(id, { r1: 0, c1: 0, r2: 2, c2: 2 });
    const table = buildPrintTable(wb, id, { repeatRows: 1 });
    expect(table.querySelector('thead td').textContent).toBe('Report title');
    expect(table.querySelector('tbody').textContent).toBe('');
  });

  it('still leaves the title out of a print selection that starts inside the merge', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Report title');
    wb.mergeCells(id, { r1: 0, c1: 0, r2: 2, c2: 2 });
    const table = buildPrintTable(wb, id, { range: { r1: 1, c1: 1, r2: 2, c2: 2 } });
    expect(table.textContent).not.toContain('Report title');
  });
});
