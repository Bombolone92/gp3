import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

describe('renaming a defined name around LET and LAMBDA variables', () => {
  it('leaves variables spelled like the name alone', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    expect(wb.defineName('K', '5')).toBeNull();
    wb.setInput(id, 0, 0, '=LET(K,10,K+1)'); // a variable shadows the name
    wb.setInput(id, 1, 0, '=LAMBDA(K, K*2)(3)');
    wb.setInput(id, 2, 0, '=LET(Rate,10,K+Rate)'); // the name itself
    wb.setInput(id, 3, 0, '=K*2');
    expect(wb.getValue(id, 0, 0)).toBe(11);
    expect(wb.getValue(id, 2, 0)).toBe(15);
    expect(wb.renameName('K', null, 'Base', '5')).toBeNull();
    expect(wb.getCell(id, 0, 0).f).toBe('LET(K,10,K+1)');
    expect(wb.getCell(id, 1, 0).f).toBe('LAMBDA(K, K*2)(3)');
    expect(wb.getCell(id, 2, 0).f).toBe('LET(Rate,10,Base+Rate)');
    expect(wb.getCell(id, 3, 0).f).toBe('Base*2');
    expect(wb.getValue(id, 0, 0)).toBe(11);
    expect(wb.getValue(id, 1, 0)).toBe(6);
    expect(wb.getValue(id, 2, 0)).toBe(15);
    expect(wb.getValue(id, 3, 0)).toBe(10);
  });

  it('refuses a new spelling that a formula binds as a variable where the name is used', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    expect(wb.defineName('K', '5')).toBeNull();
    wb.setInput(id, 0, 0, '=LET(Rate,10,K+Rate)');
    expect(wb.renameName('K', null, 'Rate', '5')).toBe('A formula uses Rate as a LET or LAMBDA variable where K appears');
    expect(wb.names.map((n) => n.name)).toEqual(['K']);
    expect(wb.getCell(id, 0, 0).f).toBe('LET(Rate,10,K+Rate)');
    expect(wb.getValue(id, 0, 0)).toBe(15);
    expect(wb.canUndo()).toBe(true); // only the edits made before
    expect(wb.undoLabel()).toBe('Edit cell');
  });

  it('renames a named LAMBDA that is called, and a name qualified by its sheet', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const sheetName = wb.sheet(id).name;
    expect(wb.defineName('Twice', 'LAMBDA(x, x*2)')).toBeNull();
    wb.setInput(id, 0, 0, '=Twice(4)');
    wb.setInput(id, 1, 0, `=${sheetName}!Twice(5)`);
    expect(wb.renameName('Twice', null, 'Double', 'LAMBDA(x, x*2)')).toBeNull();
    expect(wb.getCell(id, 0, 0).f).toBe('Double(4)');
    expect(wb.getCell(id, 1, 0).f).toBe(`${sheetName}!Double(5)`);
    expect(wb.getValue(id, 0, 0)).toBe(8);
    expect(wb.getValue(id, 1, 0)).toBe(10);
  });
});
