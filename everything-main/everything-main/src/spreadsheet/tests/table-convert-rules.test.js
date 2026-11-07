import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

/** Table T over A1:B4 (Qty, Amt) with a rule, two validations, and a filter condition that name it. */
function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Qty', 'Amt'], [1, 10], [3, 30], [5, 50]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const table = wb.addTable(id, parseRange('A1:B4'), { name: 'T' });
  wb.addRule(id, { type: 'formula', range: parseRange('A2:A4'), value: '=[@Qty]>2', style: { bold: true } });
  wb.addValidation(id, { type: 'list', range: parseRange('D1:D1'), source: '=T[Qty]', strict: true });
  wb.addValidation(id, { type: 'formula', range: parseRange('B2:B4'), source: '[@Qty]*10=[@Amt]', strict: true });
  const other = wb.addSheet('Other').id;
  wb.setCells(other, [['Qty'], [1], [4]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.setFilterRange(other, parseRange('A1:A3'));
  wb.setFilterCriteria(other, 0, { formula: 'A2>=AVERAGE(T[Qty])' });
  wb.clearHistory();
  return { wb, id, table, other };
}

describe('converting a table to a range', () => {
  it('rewrites the formulas of rules, validations, and filter conditions that named it', () => {
    const { wb, id, table, other } = setup();
    expect(wb.conditionalStyle(id, 2, 0, 3)?.bold).toBe(true);
    expect(wb.listOptionsFor(id, wb.sheet(id).validations[0])).toEqual(['1', '3', '5']);
    expect([...wb.sheet(other).filterHidden]).toEqual([1]);
    const before = wb.toJSON();
    wb.deleteTable(id, table);
    const sheet = wb.sheet(id);
    expect(sheet.rules[0].value).toBe('=$A2>2');
    expect(sheet.validations[0].source).toBe('=$A$2:$A$4');
    expect(sheet.validations[1].source).toBe('$A2*10=$B2');
    expect(wb.sheet(other).filter.criteria[0].formula).toBe('A2>=AVERAGE(Sheet1!$A$2:$A$4)');
    // Each still behaves as before: the rule reads its own row, the list offers the column, the check reads across its row.
    expect(wb.conditionalStyle(id, 1, 0, 1)?.bold).not.toBe(true);
    expect(wb.conditionalStyle(id, 2, 0, 3)?.bold).toBe(true);
    expect(wb.conditionalStyle(id, 3, 0, 5)?.bold).toBe(true);
    expect(wb.listOptionsFor(id, sheet.validations[0])).toEqual(['1', '3', '5']);
    expect(wb.validateInput(id, 0, 3, '3').ok).toBe(true);
    expect(wb.validateInput(id, 0, 3, '4').ok).toBe(false);
    expect(wb.validateInput(id, 3, 1, '50').ok).toBe(true);
    expect(wb.validateInput(id, 3, 1, '49').ok).toBe(false);
    wb.reapplyFilter(other);
    expect([...wb.sheet(other).filterHidden]).toEqual([1]);
    expect(wb.undoLabels()).toHaveLength(1);
    wb.undo();
    expect(wb.toJSON()).toEqual(before);
    expect(wb.conditionalStyle(id, 2, 0, 3)?.bold).toBe(true);
    wb.redo();
    expect(wb.sheet(id).rules[0].value).toBe('=$A2>2');
  });

  it('keeps a this-row rule that also covers the header row relative to each row instead of writing #REF!', () => {
    const { wb, id, table } = setup();
    wb.addRule(id, { type: 'formula', range: parseRange('A1:B4'), value: '=[@Amt]>20', style: { italic: true } });
    expect(wb.conditionalStyle(id, 2, 1, 30)?.italic).toBe(true);
    wb.deleteTable(id, table);
    expect(wb.sheet(id).rules.at(-1).value).toBe('=$B1>20');
    expect(wb.conditionalStyle(id, 1, 1, 10)?.italic).not.toBe(true);
    expect(wb.conditionalStyle(id, 2, 1, 30)?.italic).toBe(true);
    expect(wb.conditionalStyle(id, 3, 1, 50)?.italic).toBe(true);
  });

  it('leaves rules that name another table alone', () => {
    const { wb, id, table } = setup();
    wb.setCells(id, [['Item'], ['a'], ['b']].flatMap((row, r) => row.map((v, c) => ({ r, c: c + 6, cell: { v } }))));
    wb.addTable(id, parseRange('G1:G3'), { name: 'Items' });
    wb.addValidation(id, { type: 'list', range: parseRange('H1:H1'), source: '=Items[Item]', strict: true });
    wb.deleteTable(id, table);
    expect(wb.sheet(id).validations.at(-1).source).toBe('=Items[Item]');
    expect(wb.listOptionsFor(id, wb.sheet(id).validations.at(-1))).toEqual(['a', 'b']);
  });
});
