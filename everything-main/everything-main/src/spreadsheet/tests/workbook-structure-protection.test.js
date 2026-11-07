import { Blob as NodeBlob } from 'node:buffer';
import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

vi.stubGlobal('Blob', NodeBlob);

it('keeps sheets from being added, removed, renamed, moved, copied, hidden or recoloured while the structure is protected', () => {
  const wb = new Workbook();
  const first = wb.activeSheetId;
  const second = wb.addSheet('Data').id;
  const notices = [];
  wb.addEventListener('change', (e) => { if (e.detail.type === 'protected' && e.detail.structure) notices.push(e.detail); });
  wb.setStructureProtected(true);
  expect(wb.addSheet('More')).toBeNull();
  expect(wb.deleteSheet(second)).toBe(false);
  expect(wb.renameSheet(second, 'Renamed')).toBe(false);
  wb.moveSheet(second, 0);
  expect(wb.duplicateSheet(first)).toBeNull();
  expect(wb.setSheetHidden(second, true)).toBe(false);
  wb.setSheetColor(second, '#ff0000');
  expect(wb.sheets.map((s) => [s.name, s.hidden, s.color || null])).toEqual([['Sheet1', false, null], ['Data', false, null]]);
  expect(notices.length).toBeGreaterThanOrEqual(7);
  // Cells stay editable: only the structure is locked.
  wb.setInput(second, 0, 0, 'still editable');
  expect(wb.getValue(second, 0, 0)).toBe('still editable');
  wb.setStructureProtected(false);
  expect(wb.addSheet('More')).not.toBeNull();
});

it('saves the structure lock in the app\'s format and as the file\'s workbookProtection', async () => {
  const wb = new Workbook();
  wb.setStructureProtected(true);
  expect(new Workbook(JSON.parse(JSON.stringify(wb.toJSON()))).structureProtected).toBe(true);
  const back = await workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'locked.xlsx');
  expect(back.structureProtected).toBe(true);
  wb.setStructureProtected(false);
  const open = await workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'open.xlsx');
  expect(open.structureProtected).toBe(false);
});
