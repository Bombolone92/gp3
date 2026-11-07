import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { tokenize } from '../src/core/formula/tokenizer.js';

// Out-of-range literals are rejected at parse time. A cell with such a
// formula uses the app’s syntax-error result, rather than a live Infinity.
it('rejects numeric literals outside the supported decimal scale', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=1E400');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#ERROR!' });
  expect(wb.getCell(id, 0, 0).f).toBe('1E400');
  const at = (f) => { wb.setInput(id, 5, 5, f); return wb.getValue(id, 5, 5); };
  expect(at('=ISNUMBER(A1)')).toBe(false);
  expect(at('=ISERROR(A1)')).toBe(true);
  expect(at('=IFERROR(A1,"caught")')).toBe('caught');
  expect(at('=-1E400')).toEqual({ error: '#ERROR!' });
  expect(at('=1E307')).toBe(1e307);
  expect(() => tokenize('1E400+2')).toThrow('Number out of range');
});
