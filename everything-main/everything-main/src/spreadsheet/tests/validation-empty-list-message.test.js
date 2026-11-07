import { describe, expect, it } from 'vitest';
import { checkValue } from '../src/core/validation.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// A strict dropdown whose source no longer resolves — a deleted sheet, a renamed table column — offered
// "Pick one of: " with nothing after it while refusing every entry, so the cells were unusable with no clue
// where to look. A list with nothing in it now says so and names its source.
describe('a dropdown with no values to offer', () => {
  it('names the source instead of offering an empty list', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.addValidation(id, { type: 'list', source: 'Missing!A1:A5', strict: true, range: parseRange('C1:C5') });
    wb.addValidation(id, { type: 'list', source: 'T[Gone]', strict: true, range: parseRange('D1:D5') });
    expect(wb.validateInput(id, 0, 2, 'x')).toMatchObject({ ok: false, message: 'This dropdown has no values to pick: its source Missing!A1:A5 is empty or no longer exists' });
    expect(wb.validateInput(id, 0, 3, 'x')).toMatchObject({ ok: false, message: 'This dropdown has no values to pick: its source T[Gone] is empty or no longer exists' });
  });

  it('says where to add values when the list is a literal one that is empty', () => {
    expect(checkValue({ type: 'list', source: '' }, 'x')).toEqual({ ok: false, message: 'This dropdown has no values to pick. Add some under Data validation in the cell menu' });
    expect(checkValue({ type: 'list', source: [] }, 'x')).toEqual({ ok: false, message: 'This dropdown has no values to pick. Add some under Data validation in the cell menu' });
  });

  it('keeps the rule\'s own message, and a blank cell\'s answer, as they were', () => {
    expect(checkValue({ type: 'list', source: '', message: 'Ask Ann' }, 'x')).toEqual({ ok: false, message: 'Ask Ann' });
    expect(checkValue({ type: 'list', source: '' }, '')).toEqual({ ok: true });
    expect(checkValue({ type: 'list', source: '', allowBlank: false }, null)).toEqual({ ok: false, message: 'This cell cannot be empty' });
  });

  it('still lists the options once the source resolves again', () => {
    const wb = new Workbook({ sheets: [{ name: 'Sheet1' }, { name: 'Lists' }] });
    const [main, lists] = wb.sheets;
    wb.addValidation(main.id, { type: 'list', source: 'Lists!A1:A3', strict: true, range: parseRange('C1:C5') });
    expect(wb.validateInput(main.id, 0, 2, 'Yes').message).toBe('This dropdown has no values to pick: its source Lists!A1:A3 is empty or no longer exists');
    ['Yes', 'No'].forEach((v, r) => wb.setInput(lists.id, r, 0, v));
    expect(wb.validateInput(main.id, 0, 2, 'Yes')).toMatchObject({ ok: true });
    expect(wb.validateInput(main.id, 0, 2, 'Maybe').message).toBe('Pick one of: Yes, No');
  });
});
