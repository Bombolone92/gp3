import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const NFC = 'Ünïcode'; // precomposed
const NFD = 'Ünïcode'; // the same letters, typed as base letters plus combining marks

// A sheet name typed with combining marks did not find the sheet named with precomposed letters.
it('finds a sheet whichever way its accented letters were composed', () => {
  const wb = new Workbook();
  const first = wb.activeSheetId;
  const sheet = wb.addSheet(NFC);
  expect(NFD).not.toBe(NFC);
  expect(wb.sheetByName(NFD)).toBe(sheet);
  expect(wb.sheetByName(NFD.toUpperCase())).toBe(sheet);
  wb.setInput(sheet.id, 0, 0, '7');
  wb.setInput(first, 0, 0, `='${NFD}'!A1*2`);
  expect(wb.getValue(first, 0, 0)).toBe(14);
  expect(wb.sheetsBetween(NFD, wb.sheet(first).name)).toEqual([wb.sheet(first).name, NFC]);
  // The two spellings are one name: a second sheet may not take it.
  expect(wb.validateSheetName(NFD)).toBe('A sheet with that name already exists');
  expect(wb.addSheet(NFD).name).not.toBe(NFD);
});
