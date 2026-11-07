// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintTable } from '../src/ui/print.js';
import { parseRange } from '../src/core/cell.js';

// The grid draws a tick box for every cell a checkbox rule covers, blank ones included. Print knew
// nothing of data validation, so a printed checklist read TRUE and FALSE, and the empty-looking box
// cells let the label beside them spill across on paper.
function checklist() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'Task');
  wb.setInput(id, 0, 1, 'Done');
  wb.setInput(id, 1, 0, 'Book the room');
  wb.setInput(id, 1, 1, 'TRUE');
  wb.setInput(id, 2, 0, 'Send the agenda');
  wb.setInput(id, 2, 1, 'FALSE');
  wb.setInput(id, 3, 0, 'A task whose name is far too long for its column');
  wb.addValidation(id, { type: 'checkbox', range: parseRange('B2:B4') });
  return { wb, id };
}
const body = (table) => [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.children]);

describe('printing a checkbox column', () => {
  it('draws a box, ticked or empty, in place of TRUE and FALSE', () => {
    const { wb, id } = checklist();
    const rows = body(buildPrintTable(wb, id));
    expect(buildPrintTable(wb, id).textContent).not.toContain('TRUE');
    expect(buildPrintTable(wb, id).textContent).not.toContain('FALSE');
    const boxes = rows.slice(1).map((row) => row[1].querySelector('svg'));
    expect(boxes.map((svg) => svg?.getAttribute('aria-label'))).toEqual(['Checked', 'Unchecked', 'Unchecked']);
    // The tick is drawn in the theme's ink over the accent fill, so it prints on white paper.
    expect(rows[1][1].innerHTML).toContain('var(--accent)');
    expect(rows[2][1].innerHTML).toContain('var(--ink-3)');
  });

  it('counts a box cell as filled, so the label beside it is not spilled across', () => {
    const { wb, id } = checklist();
    const rows = body(buildPrintTable(wb, id));
    expect(rows[3][0].classList.contains('spill')).toBe(false);
    // Without the rule the same label does run over its empty neighbour.
    const plain = new Workbook();
    const pid = plain.sheets[0].id;
    plain.setInput(pid, 0, 0, 'A task whose name is far too long for its column');
    plain.setInput(pid, 0, 2, 'end');
    expect(body(buildPrintTable(plain, pid))[0][0].classList.contains('spill')).toBe(true);
  });

  it('draws the box for a formula that works out true, and leaves other booleans as words', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, '=1>0');
    wb.setInput(id, 0, 1, 'TRUE'); // no rule here
    wb.addValidation(id, { type: 'checkbox', range: parseRange('A1:A1') });
    const [row] = body(buildPrintTable(wb, id));
    expect(row[0].querySelector('svg')?.getAttribute('aria-label')).toBe('Checked');
    expect(row[1].textContent).toBe('TRUE');
  });
});
