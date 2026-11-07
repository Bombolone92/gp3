// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { placeImport } from '../src/ui/importdialog.js';

// A formula reaching another sheet of the file arrives as the value it showed there. IMAGE
// answers a picture object, and the grid shows any such value as the picture whether or not
// the book may reach out: placed as a value, =IMAGE(Data!A1) fetched its address without
// consent for as long as the cell lived. The address arrives as text instead.

const URL = 'https://attacker.example/pixel.png';
function source() {
  const other = new Workbook({ sheets: [{ name: 'Sheet1' }, { name: 'Data' }] });
  const [first, data] = other.sheets;
  other.setInput(data.id, 0, 0, URL);
  other.setInput(first.id, 0, 0, '=IMAGE(Data!A1)');
  other.setInput(first.id, 1, 0, '=IMAGE(Data!A1:A1)');
  other.setInput(first.id, 0, 1, '=IMAGE("data:image/png;base64,AAAA")+0');
  other.setInput(first.id, 1, 1, '=Data!A1');
  expect(other.getValue(first.id, 0, 0)).toEqual({ image: URL, fit: 'contain' });
  return { other, first };
}

const pictures = (wb) => wb.sheets.flatMap((s) => [...s.cells.values()]).filter((cell) => cell.v && typeof cell.v === 'object' && 'image' in cell.v);

it.each([true, false])('places a cross-sheet IMAGE result as its address text in every pasting mode (target allowed: %s)', (allowed) => {
  for (const mode of ['cell', 'append', 'replace']) {
    const { other, first } = source();
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setExternalAllowed(allowed);
    expect(placeImport(wb, id, other, { mode, otherSheetId: first.id, at: { r: 0, c: 0 } })).toBeTruthy();
    const r0 = 0; // the target is empty, so an append starts at the first row too
    expect(wb.getCell(id, r0, 0)).toMatchObject({ v: URL, f: null });
    expect(wb.getCell(id, r0 + 1, 0)).toMatchObject({ v: URL, f: null });
    expect(wb.getValue(id, r0, 0)).toBe(URL);
    expect(wb.getCell(id, r0 + 1, 1)).toMatchObject({ v: URL, f: null });
    expect(pictures(wb)).toEqual([]);
    // A same-sheet IMAGE stays a formula, judged by the gate as ever.
    expect(wb.getCell(id, r0, 1).f).toBeTruthy();
  }
});

it('keeps the formula, blocked, when the file\'s sheets are added whole', () => {
  const { other, first } = source();
  const wb = new Workbook();
  wb.setExternalAllowed(false);
  placeImport(wb, wb.activeSheetId, other, { mode: 'sheets' });
  const added = wb.sheets[1]; // renamed to Sheet1 (2) beside the target's own Sheet1
  expect(wb.getCell(added.id, 0, 0).f).toBe('IMAGE(Data!A1)');
  expect(wb.getValue(added.id, 0, 0)).toEqual({ error: '#BLOCKED!' });
  expect(pictures(wb)).toEqual([]);
});
