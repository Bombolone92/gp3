import { expect, it } from 'vitest';
import { formatWithCode, codeDateKind } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

// Verified in desktop Excel. These are weekday codes
// in invariant workbook formats, not localized French/Spanish year codes.
it.each([
  ['aaa', 'Mon'], ['aaaa', 'Monday'], ['aaaaaa', 'Monday'],
  ['AAA', 'Mon'], ['AAAA', 'Monday'], ['a', 'a'], ['aa', 'aa'],
  ['[$-411]aaa', '月'], ['[$-411]aaaa', '月曜日'], ['[$-40c]aaaa', 'lundi'],
  ['aaa h:mm', 'Mon 0:00'], ['aaaa AM/PM', 'Monday AM'],
  ['aaaaAM/PM', 'MondayAM'], ['aaaA/P', 'MonA'], ['aaAM/PM', 'aaAM'],
  ['"aaaa"', 'aaaa'], ['\\a\\a\\a', 'aaa'],
])('formats %s with weekday-code semantics', (code, expected) => {
  expect(formatWithCode(45208, code)).toBe(expected);
});
it('uses date semantics only for unescaped weekday fields and preserves section selection', () => {
  expect(codeDateKind(45208, 'aaaa')).toBe('date');
  expect(codeDateKind(45208, 'aaa h:mm')).toBe('datetime');
  expect(codeDateKind(45208, '"aaaa"')).toBeNull();
  expect(codeDateKind(45208, 'aa')).toBeNull();
  expect(formatWithCode(45208, '[>0]aaaa;0')).toBe('Monday');
  expect(formatWithCode(0, '[>0]aaaa;0')).toBe('0');
  const wb = new Workbook(), sid = wb.activeSheetId;
  wb.setInput(sid, 0, 0, '=TEXT(45208,"0 aaa")');
  expect(wb.getValue(sid, 0, 0)).toMatchObject({ error: '#VALUE!' });
});
it('recalculates TEXT weekday names after edits and preserves authored formats in native XLSX', async () => {
  let wb = new Workbook(), sid = wb.activeSheetId;
  wb.setInput(sid, 0, 0, '45208');
  wb.setInput(sid, 0, 1, '=TEXT(A1,"aaaa")');
  wb.applyStyle(sid, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: 'aaa' });
  expect(wb.getValue(sid, 0, 1)).toBe('Monday');
  wb.setInput(sid, 0, 0, '45209'); expect(wb.getValue(sid, 0, 1)).toBe('Tuesday');
  wb.undo(); expect(wb.getValue(sid, 0, 1)).toBe('Monday'); wb.redo();
  wb.pasteCells(sid, wb.copyCells(sid, [0], [0]), 2, 2, { r: 0, c: 0 });
  expect(wb.getDisplay(sid, 2, 2)).toBe('Tue');
  for (let i = 0; i < 2; i++) {
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })); sid = wb.activeSheetId;
    expect(wb.getValue(sid, 0, 1)).toBe('Tuesday');
    expect(wb.getDisplay(sid, 0, 0)).toBe('Tue');
    expect(wb.styleAt(sid, 0, 0).code).toBe('aaa');
  }
});
