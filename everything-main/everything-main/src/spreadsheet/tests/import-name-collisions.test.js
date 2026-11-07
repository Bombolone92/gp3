import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { quoteSheet } from '../src/core/refs.js';

describe('import name collisions', () => {
  it('does not cascade sheet-reference renames through another incoming sheet name', () => {
    const target = new Workbook({ sheets: [{ name: 'Data' }] });
    target.setInput(target.activeSheetId, 0, 0, '100');
    const source = new Workbook({ sheets: [{ name: 'Data' }, { name: 'Data (2)' }] });
    const [first, second] = source.sheets;
    source.setInput(first.id, 0, 0, '10');
    source.setInput(second.id, 0, 0, '20');
    source.setInput(first.id, 0, 1, "=Data!A1+'Data (2)'!A1");
    source.defineName('FirstValue', 'Data!$A$1');
    source.addValidation(first.id, { range: parseRange('C1:C2'), type: 'list', source: 'Data!A1:A2' });
    const [a, b] = target.importSheets(source);
    expect(target.getValue(a.id, 0, 1)).toBe(30);
    expect(target.names.find((n) => n.name === 'FirstValue').ref).toBe(`${quoteSheet(a.name)}!$A$1`);
    expect(target.listOptionsFor(a.id, a.validations[0])).toEqual(['10']);
    expect(target.getValue(target.sheets[0].id, 0, 0)).toBe(100);
    expect(source.getValue(first.id, 0, 1)).toBe(30);
    target.undo();
    expect(target.sheets).toHaveLength(1);
    target.redo();
    expect(target.getValue(a.id, 0, 1)).toBe(30);
    expect(target.getValue(b.id, 0, 0)).toBe(20);
  });

  it('keeps similarly named imported tables distinct in formulas and calculated columns', () => {
    const target = new Workbook();
    target.setInput(target.activeSheetId, 0, 0, 'Value');
    target.setInput(target.activeSheetId, 1, 0, '100');
    target.addTable(target.activeSheetId, parseRange('A1:A2'), { name: 'Sales' });
    const source = new Workbook({ sheets: [{ name: 'Incoming' }] });
    const id = source.activeSheetId;
    for (const [c, value] of [[0, 10], [3, 20]]) {
      source.setInput(id, 0, c, 'Value');
      source.setInput(id, 1, c, String(value));
      if (c === 0) source.setInput(id, 0, 1, 'Total');
      source.addTable(id, { r1: 0, r2: 1, c1: c, c2: c === 0 ? 1 : c }, { name: c === 0 ? 'Sales' : 'Sales2' });
    }
    source.setInput(id, 0, 5, '=SUM(Sales[Value])+SUM(Sales2[Value])');
    source.setInput(id, 1, 1, '=SUM(Sales[Value])+SUM(Sales2[Value])');
    expect(source.getValue(id, 0, 5)).toBe(30);
    const [added] = target.importSheets(source);
    expect(target.getValue(added.id, 0, 5)).toBe(30);
    expect(new Set(target.sheets.flatMap((sheet) => sheet.tables.map((table) => table.name.toLowerCase()))).size).toBe(3);
    expect(source.getValue(id, 0, 5)).toBe(30);
    const row = target.addTableRow(added.id, added.tables[0].id);
    target.setInput(added.id, row, 0, '1');
    expect(target.getValue(added.id, row, 1)).toBe(31);
  });
});
