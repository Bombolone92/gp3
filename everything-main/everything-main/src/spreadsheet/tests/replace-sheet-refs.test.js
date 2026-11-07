import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

describe('references when an import replaces a sheet', () => {
  it('rebinds the incoming sheet references to its retained destination name', () => {
    const target = new Workbook({ sheets: [{ name: 'Main' }, { name: 'Data' }] });
    const [main, existing] = target.sheets;
    target.setInput(main.id, 0, 0, 'Original');
    target.setInput(existing.id, 0, 0, '100');
    target.setInput(existing.id, 0, 1, '=Data!A1');
    const source = new Workbook({ sheets: [{ name: 'Data' }] });
    const id = source.activeSheetId;
    source.setInput(id, 0, 0, '4');
    source.setInput(id, 0, 1, '=Data!A1*2');
    source.addValidation(id, { range: parseRange('D1:D2'), type: 'list', source: 'Data!A1:A2' });
    source.addRule(id, { range: parseRange('E1:E2'), type: 'formula', value: '=Data!$A$1<10', style: { bold: true } });
    target.replaceSheetWith(main.id, source, id);
    expect(target.getValue(main.id, 0, 1)).toBe(8);
    expect(target.listOptionsFor(main.id, target.sheet(main.id).validations[0])).toEqual(['4']);
    expect(target.conditionalStyle(main.id, 0, 4, null)).toEqual({ bold: true });
    expect(target.getValue(existing.id, 0, 1)).toBe(100);
    expect(source.getCell(id, 0, 1).f).toBe('Data!A1*2');
    target.undo();
    expect(target.getValue(main.id, 0, 0)).toBe('Original');
    target.redo();
    expect(target.getValue(main.id, 0, 1)).toBe(8);
  });
});
