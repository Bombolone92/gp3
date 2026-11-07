// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

describe('FILTERXML', () => {
  it('spills the nodes an XPath picks out of XML text, typed', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, '<items><item><name>Pen</name><qty>3</qty></item><item><name>Ink</name><qty>12</qty></item></items>');
    wb.setInput(id, 0, 2, '=FILTERXML(A1, "//item/name")');
    wb.setInput(id, 0, 3, '=SUM(FILTERXML(A1, "//item/qty"))');
    wb.setInput(id, 0, 4, '=FILTERXML(A1, "count(//item)")');
    wb.setInput(id, 0, 5, '=FILTERXML(A1, "//nothing")');
    wb.setInput(id, 0, 6, '=FILTERXML(A1, "//[bad")');
    expect(wb.getValue(id, 0, 2)).toBe('Pen');
    expect(wb.getValue(id, 1, 2)).toBe('Ink');
    expect(wb.getValue(id, 0, 3)).toBe(15);
    expect(wb.getValue(id, 0, 4)).toBe(2);
    expect(wb.getValue(id, 0, 5)).toEqual({ error: '#N/A' });
    expect(wb.getValue(id, 0, 6)).toEqual({ error: '#VALUE!' });
  });
});
