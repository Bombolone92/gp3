// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openImportPlacementDialog, placeImport } from '../src/ui/importdialog.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

// Appending a sheet's rows or placing them at a cell pasted its cells alone while the dialog
// promised "values, formulas, and formatting": the merged title row, the notes, the dropdowns
// and the conditional formats stayed behind. They travel with the block now, shifted with it,
// in the same undo step; appended rows also keep their heights and hidden state.

function source() {
  const other = new Workbook({ sheets: [{ name: 'Data' }] });
  const id = other.activeSheetId;
  // The block starts at B2, so leading blank lines are left behind and everything shifts.
  other.setInput(id, 1, 1, 'Title');
  other.mergeCells(id, parseRange('B2:D2'));
  other.setInput(id, 2, 1, '5');
  other.setNote(id, 2, 1, 'a note');
  other.setInput(id, 2, 2, 'x');
  other.addValidation(id, { range: parseRange('C3:C4'), type: 'list', source: ['x', 'y'] });
  other.addValidation(id, { range: parseRange('B4'), type: 'formula', source: '=B4>B3', strict: true });
  other.setInput(id, 3, 1, '7');
  other.setInput(id, 3, 3, '9');
  other.addRule(id, { range: parseRange('D4'), type: 'gt', value: 5, style: { bg: '#ffeeaa' } });
  other.addRule(id, { range: parseRange('B3:B4'), type: 'formula', value: '=B3>$D$4', style: { bold: true } });
  other.mergeCells(id, parseRange('E9:F9')); // outside the block: stays behind
  other.setRowHeight(id, 2, 48);
  other.setHidden(id, 'row', [3], true);
  return { other, id };
}

it.each([['append', 1, 0], ['cell', 4, 2]])('carries merges, notes, validations and rules with the block in %s mode', (mode, r0, c0) => {
  const { other, id: src } = source();
  const before = other.toJSON();
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Existing');
  wb.setNote(id, r0, c0 + 1, 'old note under the block');
  wb.setNote(id, 0, 5, 'kept');
  const original = wb.toJSON();
  wb.clearHistory();
  expect(placeImport(wb, id, other, { mode, otherSheetId: src, at: { r: 4, c: 2 } })).toBeTruthy();
  const sheet = wb.sheet(id);
  const dr = r0 - 1, dc = c0 - 1;
  expect(sheet.merges).toEqual([{ r1: 1 + dr, c1: 1 + dc, r2: 1 + dr, c2: 3 + dc }]);
  expect(Object.fromEntries(sheet.notes)).toEqual({ [`${2 + dr},${1 + dc}`]: 'a note', '0,5': 'kept' });
  expect(sheet.validations.map(({ id: _, ...v }) => v)).toEqual([
    { range: { r1: 2 + dr, c1: 2 + dc, r2: 3 + dr, c2: 2 + dc }, type: 'list', source: ['x', 'y'] },
    { range: { r1: 3 + dr, c1: 1 + dc, r2: 3 + dr, c2: 1 + dc }, type: 'formula', source: `=${cellAt(3 + dr, 1 + dc)}>${cellAt(2 + dr, 1 + dc)}`, strict: true },
  ]);
  expect(sheet.rules.map(({ id: _, ...rule }) => rule)).toEqual([
    { range: { r1: 3 + dr, c1: 3 + dc, r2: 3 + dr, c2: 3 + dc }, type: 'gt', value: 5, style: { bg: '#ffeeaa' } },
    { range: { r1: 2 + dr, c1: 1 + dc, r2: 3 + dr, c2: 1 + dc }, type: 'formula', value: `=${cellAt(2 + dr, 1 + dc)}>$D$4`, style: { bold: true } },
  ]);
  expect(wb.conditionalStyle(id, 3 + dr, 3 + dc, 9)).toMatchObject({ bg: '#ffeeaa' });
  expect(wb.listOptionsFor(id, sheet.validations[0])).toEqual(['x', 'y']);
  expect(new Set(sheet.validations.map((v) => v.id)).size).toBe(2);
  expect(new Set(sheet.rules.map((v) => v.id)).size).toBe(2);
  if (mode === 'append') {
    expect(Object.fromEntries(sheet.rowHeights)).toEqual({ [2 + dr]: 48 });
    expect([...sheet.hiddenRows]).toEqual([3 + dr]);
  } else {
    expect(sheet.rowHeights.size).toBe(0);
    expect(sheet.hiddenRows.size).toBe(0);
  }
  expect(other.toJSON()).toEqual(before);
  // One undo step takes everything back; redo brings it all again.
  wb.undo();
  expect(wb.toJSON()).toEqual(original);
  expect(wb.canUndo()).toBe(false);
  wb.redo();
  expect(sheet.merges).toHaveLength(1);
  expect(wb.sheet(id).notes.get(`${2 + dr},${1 + dc}`)).toBe('a note');
  expect(wb.sheet(id).rules).toHaveLength(2);
});

function cellAt(r, c) {
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}

it('leaves a merge out where it would land on a table, and keeps the rest', () => {
  const { other, id: src } = source();
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 3, 4, 'Col');
  wb.addTable(id, parseRange('E4:E6'), { name: 'Here' });
  // The block's merged title lands on D4:F4, over the table's header cell E4.
  expect(placeImport(wb, id, other, { mode: 'cell', otherSheetId: src, at: { r: 3, c: 3 } })).toBeTruthy();
  expect(wb.sheet(id).merges).toEqual([]);
  expect(wb.sheet(id).rules).toHaveLength(2);
  expect(wb.getValue(id, 3, 3)).toBe('Title');
});

describe('the placement dialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it('says exactly what a pasted block carries', () => {
    const { other } = source();
    const wb = new Workbook(), id = wb.activeSheetId;
    const modal = openImportPlacementDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid: { focus() {} } }, other, 'data.xlsx');
    const hint = () => modal.panel.querySelector('.field-hint').textContent;
    modal.panel.querySelector('input[value="append"]').click();
    expect(hint()).toBe('Data: 4 rows × 4 columns (A1:D4), values, formulas and formatting, with merges, notes, validation rules and conditional formats, and row heights; formulas using the file\'s names or tables arrive as values.');
    modal.panel.querySelector('input[value="cell"]').click();
    expect(hint()).toBe('Data: 4 rows × 4 columns (A1:D4), values, formulas and formatting, with merges, notes, validation rules and conditional formats; formulas using the file\'s names or tables arrive as values.');
    modal.panel.querySelector('input[value="replace"]').click();
    expect(hint()).toBe('Data: 4 rows × 4 columns (A1:D4), values, formulas, and formatting.');
  });
});
