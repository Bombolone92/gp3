import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

it.each(['A500:AB510', 'AB510:A500', 'XFC1048575:XFD1048576'])(
  'preserves the full explicit destination %s beyond current sheet dimensions', (address) => {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.defineName('Far', `Sheet1!${address}`);
    const expected = { sheetId: id, range: parseRange(address) };
    expect(wb.resolveLink(`#${address}`)).toEqual(expected);
    expect(wb.resolveLink('#Far')).toEqual(expected);
  },
);
it.each([['A:B', 'cols'], ['2:3', 'rows']])('takes whole-axis reference %s to the far edge of the grid on its open axis', (address, kind) => {
  const wb = new Workbook(), sheet = wb.sheets[0];
  wb.defineName('Axis', `Sheet1!${address}`);
  // Whole lines: row 1,048,576 or column XFD, however far the sheet has been scrolled.
  const range = kind === 'cols' ? { r1: 0, c1: 0, r2: 1048575, c2: 1 }
    : { r1: 1, c1: 0, r2: 2, c2: 16383 };
  expect(wb.resolveLink(`#${address}`)).toEqual({ sheetId: sheet.id, range });
  expect(wb.resolveLink('#Axis')).toEqual({ sheetId: sheet.id, range });
});
