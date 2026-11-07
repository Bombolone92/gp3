import { Blob as NodeBlob } from 'node:buffer';
import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

vi.stubGlobal('Blob', NodeBlob);

it('stripes every other column of a table with Banded Columns, and keeps the choice in XLSX', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  [['A', 'B', 'C'], ['1', '2', '3'], ['4', '5', '6']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  const t = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, { banded: false });
  const tableId = typeof t === 'string' ? t : t?.id ?? wb.tablesOn(id)[0].id;
  wb.updateTable(id, tableId, { bandedColumns: true });
  const bg = (r, c) => wb._tableStyleAt(wb.sheet(id), r, c)?.bg ?? null;
  const looks = [0, 1, 2].map((c) => bg(1, c));
  expect(looks[0]).toBeTruthy();
  expect(looks[1]).toBeFalsy();
  expect(looks[2]).toBe(looks[0]);
  const back = await workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'banded.xlsx');
  expect(back.tablesOn(back.activeSheetId)[0].bandedColumns).toBe(true);
});
