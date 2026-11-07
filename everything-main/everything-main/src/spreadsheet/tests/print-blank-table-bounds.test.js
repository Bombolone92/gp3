// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintTable } from '../src/ui/print.js';

function form() {
  return new Workbook({ sheets: [{ name: 'Packing', cells: { '2,1': { v: 'Item' }, '2,2': { v: 'Packed' } },
    tables: [{ name: 'PackingList', range: { r1: 2, c1: 1, r2: 8, c2: 2 }, totalsRow: true, style: 'custom',
      customStyle: { wholeTable: { bh: true, bhBorder: { bs: 'thin', bc: '#d4d4d4' } },
        totalRow: { bb: true, bbBorder: { bs: 'medium', bc: '#39c199' } } } }] }] });
}
const rows = table => [...table.querySelectorAll('tbody tr')];

it('prints a table through its blank body and total rows, including the final table border', () => {
  const wb = form(), printed = buildPrintTable(wb, wb.activeSheetId), body = rows(printed);
  expect(body).toHaveLength(7);
  expect(printed.querySelectorAll('col')).toHaveLength(2);
  expect(body.at(-1).children[1].style.borderBottom).toBe('2px solid rgb(57, 193, 153)');
  expect(body[2].children[0].style.borderTop).toBe('1px solid rgb(212, 212, 212)');
});

it('includes the table extent beside existing content without printing hidden rows', () => {
  const wb = form(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Travel');
  wb.setHidden(id, 'row', [4, 5], true);
  const printed = buildPrintTable(wb, id);
  expect(rows(printed)).toHaveLength(7);
  expect(printed.querySelectorAll('col')).toHaveLength(3);
  expect(rows(printed).at(-1).children[2].style.borderBottom).toBe('2px solid rgb(57, 193, 153)');
});

it('keeps an explicit print range within its requested bounds even when a table extends beyond it', () => {
  const wb = form(), printed = buildPrintTable(wb, wb.activeSheetId, { range: { r1: 3, c1: 2, r2: 4, c2: 2 } });
  expect(rows(printed)).toHaveLength(2);
  expect(printed.querySelectorAll('col')).toHaveLength(1);
  expect(rows(printed).at(-1).children[0].style.borderBottom).toBe('1px solid rgb(212, 212, 212)');
});
