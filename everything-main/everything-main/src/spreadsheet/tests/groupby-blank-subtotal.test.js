import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

function arr(formula, cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 0, 9, `=${formula}`);
  const range = wb.spillRangeAt(id, 0, 9) || { r1: 0, c1: 9, r2: 0, c2: 9 };
  return wb.rangeValues(id, range);
}

// The subtotal of a group whose first key is blank was labelled " Total", the blank key and a space.
it('labels the subtotal of a blank key Total, without a stray space', () => {
  const cells = { B1: 'x', C1: '1', B2: 'y', C2: '2', A3: 'k', B3: 'x', C3: '4', A4: 'k', B4: 'y', C4: '8' };
  expect(arr('GROUPBY(A1:B4,C1:C4,SUM,0,2)', cells)).toEqual([
    ['', 'x', 1], ['', 'y', 2], ['Total', '', 3],
    ['k', 'x', 4], ['k', 'y', 8], ['k Total', '', 12],
    ['Grand Total', '', 15],
  ]);
});
