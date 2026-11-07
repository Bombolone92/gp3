import { expect, it, vi } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

it.each([
  [{ fmt: 'date' }, '2024-01-15'],
  [{ fmt: 'date', dateStyle: 'medium' }, 'Jan 15, 2024'],
  [{ fmt: 'date', dateStyle: 'long' }, 'January 15, 2024'],
  [{ fmt: 'datetime' }, '2024-01-15 12:00'],
  [{ fmt: 'datetime', sec: true }, '2024-01-15 12:00:15'],
  [{ fmt: 'datetime', dateStyle: 'medium' }, 'Jan 15, 2024 12:00'],
  [{ fmt: 'datetime', dateStyle: 'medium', sec: true }, 'Jan 15, 2024 12:00:15'],
  [{ fmt: 'datetime', dateStyle: 'long' }, 'January 15, 2024 12:00'],
  [{ fmt: 'datetime', dateStyle: 'long', sec: true }, 'January 15, 2024 12:00:15'],
  [{ fmt: 'time' }, '12:00'],
  [{ fmt: 'time', sec: true }, '12:00:15'],
  [{ fmt: 'custom', code: 'dd.mm.yyyy' }, '15.01.2024'],
  [{ fmt: 'custom', code: 'ddd, mmm d, yyyy' }, 'Mon, Jan 15, 2024'],
  [{ fmt: 'custom', code: 'hh.mm.ss' }, '12.00.15'],
  [{ fmt: 'custom', code: 'hh-mm-ss' }, '12-00-15'],
  [{ fmt: 'custom', code: 'hh:mm AM/PM' }, '12:00 PM'],
  [{ fmt: 'custom', code: 'hh:mm:ss AM/PM' }, '12:00:15 PM'],
  [{ fmt: 'custom', code: 'dd/mm/yyyy' }, '15/01/2024'],
  [{ fmt: 'custom', code: 'yyyy"-"mm"-"dd' }, '2024-01-15'],
  [{ fmt: 'custom', code: '"On "yyyy-mm-dd' }, 'On 2024-01-15'],
])('preserves ODS date/time separators for %j', async (style, expected) => {
  const wb = new Workbook();
  const value = 45306.5 + 15 / 86400;
  wb.setCells(wb.activeSheetId, [{ r: 0, c: 0, cell: { v: value, s: style } }]);
  const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const bytes = await (await workbookToOds(wb)).arrayBuffer();
    const raw = XLSX.read(bytes, { type: 'array', cellNF: true });
    const cell = raw.Sheets[raw.SheetNames[0]].A1;
    expect(cell.v).toBe(value);
    expect(XLSX.SSF.format(cell.z, cell.v)).toBe(expected);
    const back = await workbookFromFile(bytes, 'dates.ods');
    expect(back.getValue(back.activeSheetId, 0, 0)).toBe(value);
    expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe(expected);
    expect(warning).not.toHaveBeenCalled();
  } finally { warning.mockRestore(); }
});

it('writes ISO date separators as literal text in the ODS style XML', async () => {
  const wb = new Workbook();
  wb.setCells(wb.activeSheetId, [{ r: 0, c: 0, cell: { v: 45306.5, s: { fmt: 'datetime' } } }]);
  const zip = XLSX.CFB.read(new Uint8Array(await (await workbookToOds(wb)).arrayBuffer()), { type: 'array' });
  const xml = new TextDecoder().decode(zip.FileIndex.find((file) => file.name === 'content.xml').content);
  expect(xml).toContain('<number:year number:style="long"/><number:text>-</number:text><number:month');
  expect(xml).toContain('<number:day number:style="long"/><number:text> </number:text><number:hours');
});
