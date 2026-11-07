import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function setup(formula = '=SEQUENCE(3)') {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, formula);
  return { wb, id, at: (r) => wb.conditionalStyle(id, r, 0, wb.getValue(id, r, 0)) };
}

describe('conditional formatting over spilled results', () => {
  it('scales colors, data bars, and icons using every displayed value', () => {
    const { wb, id, at } = setup();
    const range = { r1: 0, c1: 0, r2: 2, c2: 0 };
    wb.addRule(id, { range, type: 'scale', from: '#000000', to: '#ffffff' });
    wb.addRule(id, { range, type: 'databar' });
    wb.addRule(id, { range, type: 'icons', set: 'arrows' });
    expect(at(0)).toMatchObject({ bg: '#000000', bar: 1 / 3, icon: '▼' });
    expect(at(1)).toMatchObject({ bg: '#7f7f7f', bar: 2 / 3, icon: '▶' });
    expect(at(2)).toMatchObject({ bg: '#ffffff', bar: 1, icon: '▲' });
  });

  it('ranks results when the formatting range excludes the array anchor', () => {
    const { wb, id, at } = setup('=SEQUENCE(4)');
    const range = { r1: 1, c1: 0, r2: 3, c2: 0 };
    wb.addRule(id, { range, type: 'top', value: 1, style: { bold: true } });
    wb.addRule(id, { range, type: 'bottom', value: 1, style: { color: '#ff0000' } });
    expect(at(1)).toEqual({ color: '#ff0000' });
    expect(at(2)).toBeNull();
    expect(at(3)).toEqual({ bold: true });
  });

  it('counts styled spill cells once and updates duplicate rules after edits and undo', () => {
    const { wb, id, at } = setup('={"Apple";"apple";"Pear"}');
    const range = { r1: 0, c1: 0, r2: 2, c2: 0 };
    wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { italic: true });
    wb.addRule(id, { range, type: 'dup', style: { bold: true } });
    wb.addRule(id, { range, type: 'unique', style: { color: '#008800' } });
    expect(at(0)).toEqual({ bold: true });
    expect(at(1)).toEqual({ bold: true });
    expect(at(2)).toEqual({ color: '#008800' });
    wb.setInput(id, 0, 0, '={"Apple";"Plum";"Pear"}');
    expect(at(0)).toEqual({ color: '#008800' });
    wb.undo();
    expect(at(0)).toEqual({ bold: true });
  });
});
