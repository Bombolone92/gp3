import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookToOds, workbookToXlsx, workbookFromFile } from '../src/core/io.js';

function book() {
  const wb = new Workbook({ sheets: [{ name: 'Summary' }, { name: 'Lookup', hidden: true }, { name: 'Secret', hidden: true, veryHidden: true }] });
  const [summary, lookup, secret] = wb.sheets;
  wb.setInput(lookup.id, 0, 0, '21');
  wb.setInput(secret.id, 0, 0, '2');
  wb.setInput(summary.id, 0, 0, '=Lookup!A1*Secret!A1');
  return wb;
}

// ODF hides a sheet through a table style the writer does not emit, and the settings block
// recorded nothing, so every hidden or very hidden sheet reappeared after an .ods round trip.
it('keeps hidden and very hidden sheets through an .ods round trip', async () => {
  const wb = book();
  const back = await workbookFromFile(await workbookToOds(wb), 'hidden.ods');
  expect(back.sheets.map((s) => [s.name, s.hidden, s.veryHidden])).toEqual([['Summary', false, false], ['Lookup', true, false], ['Secret', true, true]]);
  expect(back.activeSheet.name).toBe('Summary');
  expect(back.getValue(back.activeSheetId, 0, 0)).toBe(42);
  expect(back.dirty).toBe(false);
  const again = await workbookFromFile(await workbookToOds(back), 'hidden-again.ods');
  expect(again.sheets.map((s) => s.hidden)).toEqual([false, true, true]);
});

it('hides the sheets through their table style when the .ods is written without the settings block', async () => {
  const back = await workbookFromFile(await workbookToOds(book(), { settings: false }), 'plain.ods');
  // ODF has no very-hidden state, so both come back plainly hidden.
  expect(back.sheets.map((s) => [s.hidden, s.veryHidden])).toEqual([[false, false], [true, false], [true, false]]);
});

it('leaves an .xlsx sheet another program unhid visible, as its own visibility flag says', async () => {
  const raw = X.read(await (await workbookToXlsx(book())).arrayBuffer(), { type: 'array' });
  for (const entry of raw.Workbook.Sheets) if (entry.name === 'Lookup') entry.Hidden = 0;
  const back = await workbookFromFile(X.write(raw, { type: 'array', bookType: 'xlsx' }), 'unhidden.xlsx');
  expect(back.sheets.map((s) => [s.name, s.hidden, s.veryHidden])).toEqual([['Summary', false, false], ['Lookup', false, false], ['Secret', true, true]]);
});
