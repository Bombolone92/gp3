import { expect, it } from 'vitest';
import { parseFormula } from '../src/core/formula/parser.js';
import { astToText, evaluateParts } from '../src/core/formula/print.js';
import { Workbook } from '../src/core/workbook.js';

// A sheet-scoped name printed as its bare name, so Sheet1!X+Sheet2!X read X+X.
it('prints a sheet-scoped name with its sheet and round-trips', () => {
  // Names print in upper case, as the parser reads them; the sheet must survive the trip.
  for (const text of ['Sheet2!X', "'My Sheet'!TOTAL+1", 'Sheet1!X+Sheet2!X', "'Q''1'!FN(3)"]) {
    const printed = astToText(parseFormula(text));
    expect(printed).toBe(text);
    expect(astToText(parseFormula(printed))).toBe(text);
  }
});

it('shows both scoped names in the evaluation steps', () => {
  const wb = new Workbook();
  wb.addSheet('Sheet2');
  expect(wb.defineName('X', '5', 'Sheet1')).toBeNull();
  expect(wb.defineName('X', '7', 'Sheet2')).toBeNull();
  wb.setInput(wb.sheets[0].id, 0, 0, '=Sheet1!X+Sheet2!X');
  expect(wb.getValue(wb.sheets[0].id, 0, 0)).toBe(12);
  const result = evaluateParts('Sheet1!X+Sheet2!X', wb.contextFor(wb.sheets[0].id, 0, 0));
  const parts = Array.isArray(result) ? result : result.parts;
  expect(parts.map((p) => p.text)).toEqual(expect.arrayContaining(['Sheet1!X', 'Sheet2!X', 'Sheet1!X+Sheet2!X']));
  expect(parts.find((p) => p.text === 'Sheet2!X').value).toBe(7);
});
