import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Inserting a file's sheets dropped an incoming name that was already defined here, so the
// imported formulas read the destination's definition: a file whose Rate was 7 showed 200
// where it had shown 14, with no message. The file's definition now joins each imported
// sheet that uses it as that sheet's own local name; only an identical definition is skipped.

function file(rate = '7') {
  const other = new Workbook({ sheets: [{ name: 'Prices' }] });
  other.defineName('Rate', rate);
  other.setInput(other.activeSheetId, 0, 0, '=Rate*2');
  return other;
}

function destination() {
  const wb = new Workbook({ sheets: [{ name: 'Main' }] });
  wb.defineName('Rate', '100');
  wb.setInput(wb.activeSheetId, 0, 0, '=Rate');
  wb.clearHistory();
  return wb;
}

it('keeps an imported sheet reading the file\'s definition of a name the book already defines differently', () => {
  const wb = destination();
  const before = wb.toJSON();
  const [added] = wb.importSheets(file());
  expect(wb.getValue(added.id, 0, 0)).toBe(14);
  expect(wb.getValue(wb.sheets[0].id, 0, 0)).toBe(100);
  expect(wb.names).toEqual([{ name: 'Rate', ref: '100' }, { name: 'Rate', ref: '7', sheet: 'Prices' }]);
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.getValue(wb.sheets[1].id, 0, 0)).toBe(14);
});

it('skips an incoming definition identical to the one already here', () => {
  const wb = destination();
  wb.importSheets(file('100'));
  expect(wb.names).toEqual([{ name: 'Rate', ref: '100' }]);
  expect(wb.getValue(wb.sheets[1].id, 0, 0)).toBe(200);
});

it('leaves a colliding name out of imported sheets that never use it', () => {
  const wb = destination();
  const other = file();
  other.addSheet('Notes');
  other.setInput(other.sheets[1].id, 0, 0, 'plain text');
  const [prices, notes] = wb.importSheets(other);
  expect(wb.names).toEqual([{ name: 'Rate', ref: '100' }, { name: 'Rate', ref: '7', sheet: prices.name }]);
  expect(wb.getValue(notes.id, 0, 0)).toBe('plain text');
});

it('gives each imported sheet that uses the colliding name its own copy, renamed sheets included', () => {
  const wb = destination();
  const other = file();
  other.addSheet('Main'); // clashes with the destination's sheet name and is renamed on the way in
  other.setInput(other.sheets[1].id, 0, 0, '=Rate+1');
  const [prices, main] = wb.importSheets(other);
  expect(main.name).toBe('Main (2)');
  expect(wb.getValue(prices.id, 0, 0)).toBe(14);
  expect(wb.getValue(main.id, 0, 0)).toBe(8);
  expect(wb.names.filter((n) => n.sheet).map((n) => n.sheet).sort()).toEqual(['Main (2)', 'Prices']);
});

it('follows a name reached through another incoming name', () => {
  const wb = destination();
  const other = new Workbook({ sheets: [{ name: 'Prices' }] });
  other.defineName('Rate', '7');
  other.defineName('Twice', 'Rate*2');
  other.setInput(other.activeSheetId, 0, 0, '=Twice');
  const [added] = wb.importSheets(other);
  expect(wb.getValue(added.id, 0, 0)).toBe(14);
  expect(wb.getValue(wb.sheets[0].id, 0, 0)).toBe(100);
});

it('keeps a colliding name that points at the imported sheet following that sheet', () => {
  const wb = destination();
  const other = new Workbook({ sheets: [{ name: 'Main' }] });
  other.setInput(other.activeSheetId, 1, 0, '7');
  other.defineName('Rate', 'Main!$A$2');
  other.setInput(other.activeSheetId, 0, 0, '=Rate*2');
  const [added] = wb.importSheets(other);
  expect(added.name).toBe('Main (2)');
  expect(wb.getValue(added.id, 0, 0)).toBe(14);
  expect(wb.names.find((n) => n.sheet)).toEqual({ name: 'Rate', ref: "'Main (2)'!$A$2", sheet: 'Main (2)' });
});
