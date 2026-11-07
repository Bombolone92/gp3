import { expect, it } from 'vitest';
import { Workbook, MAX_FORMULA_LENGTH } from '../src/core/workbook.js';
import { tokenize } from '../src/core/formula/tokenizer.js';
import { freeNameTokens } from '../src/core/formula/names.js';

const sum = '1+'.repeat(3500);

it('finds workbook names in long expressions while respecting LET and LAMBDA scope', () => {
  for (const formula of [`LET(local,2,${sum}Rate+local)`, `LAMBDA([local],${sum}Rate+IF(ISOMITTED(local),0,local))()`]) {
    expect(formula.length).toBeLessThan(MAX_FORMULA_LENGTH);
    expect(freeNameTokens(formula, tokenize(formula)).map(t => t.value)).toEqual(['RATE']);
  }
});

it('renames a name used in a long formula without throwing or changing its value', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.defineName('Rate', '3');
  const formula = `LET(local,2,${sum}Rate+local)`;
  wb.setInput(id, 0, 0, `=${formula}`);
  expect(wb.getValue(id, 0, 0)).toBe(3505);
  const before = wb.toJSON();
  wb.clearHistory();
  expect(wb.renameName('Rate', null, 'Charge', '3')).toBeNull();
  expect(wb.getCell(id, 0, 0).f).toBe(formula.replace('Rate', 'Charge'));
  expect(wb.getValue(id, 0, 0)).toBe(3505);
  wb.undo(); expect(wb.toJSON()).toEqual(before);
  wb.redo(); expect(wb.getValue(id, 0, 0)).toBe(3505);
});
