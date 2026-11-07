import { expect, it } from 'vitest';
import { parseRefText, refToText } from '../src/core/refs.js';
import { parseImportRange } from '../src/core/importrange.js';
import { Workbook } from '../src/core/workbook.js';

const invalid = ['A0', '0:0', '0:1', '1:0', '$0:$1', 'XFE1', '$XFE$1', 'A1048577', '$A$1048577',
  'A1:XFE1', 'XFE1:A1', 'A1:A1048577', 'A1048577:A1', 'XFE:XFE', 'XFD:XFE', 'XFE:XFD',
  '1048577:1048577', '1048576:1048577', '1048577:1048576'];

it.each(invalid)('rejects out-of-grid reference %s in shared and import parsing', (text) => {
  expect(parseRefText(text)).toBeNull();
  expect(parseImportRange(text)).toBeNull();
  expect(parseImportRange(`'Source Data'!${text}`)).toBeNull();
});

it.each(['A1', '$XFD$1048576', 'XFD1:XFD1048576', 'A1048576:XFD1048576', 'XFD:XFD', '1048576:1048576'])
  ('retains valid boundary reference %s', (text) => {
    expect(refToText(parseRefText(text))).toBe(text);
    expect(parseImportRange(`'Source Data'!${text}`).sheet).toBe('Source Data');
  });

it.each(['0:1', 'XFE1', 'A1048577', 'XFD:XFE', '1048576:1048577'])('returns REF for INDIRECT of %s', (text) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '7');
  wb.setInput(id, 2, 2, `=INDIRECT("${text}")`);
  wb.setInput(id, 3, 2, `=IFERROR(INDIRECT("${text}"),"invalid")`);
  expect(wb.getValue(id, 2, 2)).toEqual({ error: '#REF!' });
  expect(wb.getValue(id, 3, 2)).toBe('invalid');
});

it('rejects a row-zero formula instead of silently summing row one', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '7');
  wb.setInput(id, 2, 2, '=SUM(0:1)');
  expect(wb.getValue(id, 2, 2)).toEqual({ error: '#ERROR!' });
  wb.setInput(id, 2, 2, '=SUM(1:1)');
  expect(wb.getValue(id, 2, 2)).toBe(7);
  wb.undo();
  expect(wb.getValue(id, 2, 2)).toEqual({ error: '#ERROR!' });
});
