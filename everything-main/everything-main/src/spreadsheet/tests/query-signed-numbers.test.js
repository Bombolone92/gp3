import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// The query tokenizer had no path for a minus sign, so "where B > -3" was #VALUE!.
it('reads negative number literals in QUERY conditions', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const [r, a, b] of [[0, 'x', -4], [1, 'y', -2], [2, 'z', 3], [3, 'w', 0]]) { wb.setInput(id, r, 0, a); wb.setInput(id, r, 1, String(b)); }
  const rows = (text) => {
    wb.setInput(id, 9, 5, `=QUERY(A1:B4,"${text}")`);
    const first = wb.getValue(id, 9, 5);
    if (first && typeof first === 'object' && first.error) return first.error;
    const out = [];
    for (let r = 9; r < 14; r++) { const v = wb.getValue(id, r, 5); if (v != null) out.push(v); }
    return out;
  };
  expect(rows('select A where B > -3')).toEqual(['y', 'z', 'w']);
  expect(rows('select A where B = -4')).toEqual(['x']);
  expect(rows('select A where B < -1')).toEqual(['x', 'y']);
  expect(rows('select A where B >= -.5')).toEqual(['z', 'w']);
  expect(rows('select A where B <= -2 order by B')).toEqual(['x', 'y']);
  expect(rows('select B where B > 1')).toEqual([3]);
});
