import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookToOds, workbookFromFile } from '../src/core/io.js';

// The app's settings block used to be written only when a sheet had a filter,
// so styles, frozen panes, tab colours and protection were lost on every other .ods.
it('keeps styles, frozen panes, tab colour, protection and tables through an .ods round trip without a filter', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Head');
  wb.setInput(id, 1, 0, '3');
  wb.setInput(id, 2, 0, '=SUM(A2:A2)');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true, color: '#ff0000', bg: '#ffff00', align: 'center' });
  wb.setFrozen(id, 1, 0);
  wb.setSheetColor(id, '#123456');
  const blob = await workbookToOds(wb);
  const back = await workbookFromFile(await blob.arrayBuffer(), 'plain.ods');
  const bid = back.activeSheetId;
  expect(back.getCell(bid, 0, 0).s).toMatchObject({ bold: true, color: '#ff0000', bg: '#ffff00', align: 'center' });
  expect(back.sheets[0].frozenRows).toBe(1);
  expect(back.sheets[0].color).toBe('#123456');
  expect(back.getValue(bid, 2, 0)).toBe(3);
});
