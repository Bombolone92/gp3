import { expect, it } from 'vitest';
import { explainError } from '../src/core/errhelp.js';
import { Workbook } from '../src/core/workbook.js';

// A reference to a deleted sheet is written #REF!A1, as Excel writes it, and the help read that as
// a sheet named "#REF!".
it('says a #REF!A1 reference points at a deleted sheet, not at a sheet named "#REF!"', () => {
  const lookup = { hasSheet: (name) => name === 'Sheet1' };
  expect(explainError('#REF!', '#REF!A1', lookup)).toBe('#REF!: #REF!A1 refers to a sheet that was deleted.');
  expect(explainError('#REF!', 'SUM(Sheet1!A1,#REF!B2:C3)', lookup)).toBe('#REF!: #REF!B2:C3 refers to a sheet that was deleted.');
  // A sheet that is merely unknown keeps its own wording.
  expect(explainError('#REF!', 'Gone!A1', lookup)).toBe('#REF!: There is no sheet named "Gone". It may have been renamed or deleted.');
});

it('explains such a reference in a workbook, where it evaluates to #REF!', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=#REF!A1*2');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
  expect(explainError('#REF!', wb.getCell(id, 0, 0).f, { hasSheet: (name) => !!wb.sheetByName(name) })).toBe('#REF!: #REF!A1 refers to a sheet that was deleted.');
});
