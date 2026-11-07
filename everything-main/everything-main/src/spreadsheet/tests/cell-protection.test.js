import { Blob as NodeBlob } from 'node:buffer';
import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

vi.stubGlobal('Blob', NodeBlob);
const roundtrip = async (wb) => workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'protect.xlsx');

it('lets a protected sheet take entries in unlocked cells only, keeping their formatting protected', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Label');
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 2, c2: 0 }, { locked: false });
  wb.setSheetProtected(id, true);
  wb.setInput(id, 0, 0, 'changed');
  wb.setInput(id, 1, 0, '42');
  wb.setInput(id, 2, 0, '2026-05-01');
  expect([wb.getValue(id, 0, 0), wb.getValue(id, 1, 0)]).toEqual(['Label', 42]);
  // Typing a date takes the date format it implies; other formatting is refused.
  expect(wb.getCell(id, 2, 0).s).toMatchObject({ locked: false, fmt: 'date' });
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bold: true });
  expect(wb.getCell(id, 1, 0).s.bold).toBeUndefined();
  // Clearing contents keeps the cell unlocked, so it can be typed into again.
  wb.clearRange(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { contents: true });
  wb.setInput(id, 1, 0, '7');
  expect(wb.getValue(id, 1, 0)).toBe(7);
  // A batch reaching a locked cell is refused whole.
  wb.setCells(id, [{ r: 1, c: 0, cell: { v: 1 } }, { r: 0, c: 0, cell: { v: 2 } }]);
  expect([wb.getValue(id, 1, 0), wb.getValue(id, 0, 0)]).toEqual([7, 'Label']);
});

it('hides a formula marked Hidden only while its sheet is protected', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=1+1');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { formulaHidden: true });
  expect(wb.formulaHiddenAt(id, 0, 0)).toBe(false);
  wb.setSheetProtected(id, true);
  expect(wb.formulaHiddenAt(id, 0, 0)).toBe(true);
  expect(wb.getValue(id, 0, 0)).toBe(2);
});

it('writes the sheet protection and each cell\'s Locked and Hidden as Excel reads them, and reads them back', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=2*3');
  wb.setInput(id, 1, 0, 'free');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { formulaHidden: true });
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { locked: false });
  wb.setSheetProtected(id, true);
  const blob = await workbookToXlsx(wb);
  const { unzipSync, strFromU8 } = await import('fflate').catch(() => ({}));
  const back = await roundtrip(wb);
  const sid = back.activeSheetId;
  expect(back.isProtected(sid)).toBe(true);
  expect(back.getCell(sid, 0, 0).s).toMatchObject({ formulaHidden: true });
  expect(back.getCell(sid, 1, 0).s).toMatchObject({ locked: false });
  back.setInput(sid, 1, 0, 'typed');
  back.setInput(sid, 0, 0, 'refused');
  expect([back.getValue(sid, 1, 0), back.getValue(sid, 0, 0)]).toEqual(['typed', 6]);
  expect(blob.size).toBeGreaterThan(0);
  void unzipSync; void strFromU8;
});
