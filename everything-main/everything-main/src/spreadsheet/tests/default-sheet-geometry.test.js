import { Blob as NodeBlob } from 'node:buffer';
import { expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { Workbook, DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, EXCEL_SHEET_DEFAULTS } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

vi.stubGlobal('Blob', NodeBlob);

it('starts a new blank workbook at 64px columns and 20px rows, and keeps them through a save', async () => {
  const { wb } = Doc.blank({ excel: true });
  const id = wb.activeSheetId;
  expect([wb.colWidth(id, 0), wb.rowHeight(id, 0)]).toEqual([64, 20]);
  // A sheet added beside it takes the same geometry.
  const added = wb.addSheet();
  expect([wb.colWidth(added.id, 3), wb.rowHeight(added.id, 3)]).toEqual([64, 20]);
  const json = new Workbook(JSON.parse(JSON.stringify(wb.toJSON())));
  expect([json.colWidth(json.sheets[0].id, 0), json.rowHeight(json.sheets[0].id, 0)]).toEqual([64, 20]);
  const back = await workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'blank.xlsx');
  expect([back.colWidth(back.sheets[0].id, 0), back.rowHeight(back.sheets[0].id, 0)]).toEqual([64, 20]);
  expect(EXCEL_SHEET_DEFAULTS).toEqual({ defaultColWidth: 64, defaultRowHeight: 20 });
});

it('leaves workbooks that rely on the app\'s own defaults as they were', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  expect([wb.colWidth(id, 0), wb.rowHeight(id, 0)]).toEqual([DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT]);
  const added = wb.addSheet();
  expect(wb.colWidth(added.id, 0)).toBe(DEFAULT_COL_WIDTH);
  expect(Doc.blank().wb.colWidth(Doc.blank().wb.activeSheetId, 0)).toBe(DEFAULT_COL_WIDTH);
  const back = await workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'old.xlsx');
  expect(back.colWidth(back.sheets[0].id, 0)).toBe(DEFAULT_COL_WIDTH);
});

it('starts a new blank workbook in the Calibri 11 body font, aligned to the bottom, and keeps both through a save', async () => {
  const { wb } = Doc.blank({ excel: true });
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Synthetic');
  expect(wb.normalFont).toMatchObject({ name: 'Calibri', sz: 11, scheme: 'minor' });
  expect(wb.displayStyleAt(id, 0, 0)).toMatchObject({ font: 'calibri', size: 11 * 4 / 3, valign: 'bottom', scheme: 'minor' });
  const added = wb.addSheet();
  expect(wb.displayStyleAt(added.id, 0, 0)).toMatchObject({ valign: 'bottom' });
  const back = await workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'blank.xlsx');
  expect(back.normalFont).toMatchObject({ name: 'Calibri', sz: 11 });
  expect(back.displayStyleAt(back.sheets[0].id, 0, 0)).toMatchObject({ size: 11 * 4 / 3, valign: 'bottom' });
});
