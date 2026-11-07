import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { ymdToSerial } from '../src/core/format.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import { checkValue as check2, describeValidation as describe2, chipFor, CHIP_PALETTE } from '../src/core/validation.js';

describe('text, date, and formula rules', () => {
  it('keeps dropdowns, custom validation, and conditional formatting working after a source sheet rename', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const source = wb.addSheet('Lists');
    wb.setInput(source.id, 0, 0, 'Red');
    wb.setInput(source.id, 1, 0, 'Green');
    wb.setInput(source.id, 0, 1, '10');
    wb.addValidation(id, { range: parseRange('A1:A3'), type: 'list', source: 'Lists!$A$1:$A$2' });
    wb.addValidation(id, { range: parseRange('B1:B3'), type: 'formula', source: '=B1>Lists!$B$1', strict: true });
    wb.addValidation(id, { range: parseRange('C1:C3'), type: 'list', source: 'Lists!A1,Other' });
    wb.addRule(id, { range: parseRange('B1:B3'), type: 'formula', value: '=B1>Lists!$B$1', style: { bold: true } });
    wb.addRule(id, { range: parseRange('D1'), type: 'contains', value: 'Lists!A1', style: { italic: true } });
    wb.setInput(id, 0, 1, '11');
    wb.renameSheet(source.id, "O'Brien");
    const verify = (book) => {
      const sheet = book.sheetByName('Sheet1');
      expect(book.listOptionsFor(sheet.id, sheet.validations[0])).toEqual(['Red', 'Green']);
      expect(book.validateInput(sheet.id, 0, 1, '11').ok).toBe(true);
      expect(book.validateInput(sheet.id, 0, 1, '9').ok).toBe(false);
      expect(book.conditionalStyle(sheet.id, 0, 1, 11)).toEqual({ bold: true });
      expect(sheet.validations[2].source).toBe('Lists!A1,Other');
      expect(sheet.rules[1].value).toBe('Lists!A1');
    };
    verify(wb);
    wb.undo();
    expect(wb.sheet(id).validations[0].source).toBe('Lists!$A$1:$A$2');
    verify(wb);
    wb.redo();
    verify(wb);
    verify(await workbookFromFile(await workbookToXlsx(wb), 'rules.xlsx'));
  });

  it('checks text length and dates', () => {
    const text = { type: 'text', min: 2, max: 4 };
    expect(check2(text, 'ab').ok).toBe(true);
    expect(check2(text, 'a').ok).toBe(false);
    expect(check2(text, 'abcde').message).toMatch(/at most 4/);
    expect(check2(text, 1234).ok).toBe(true); // numbers count as their text
    expect(describe2(text)).toBe('Text of 2 to 4 characters');
    const date = { type: 'date', min: ymdToSerial(2024, 1, 1), max: ymdToSerial(2024, 12, 31) };
    expect(check2(date, ymdToSerial(2024, 6, 1)).ok).toBe(true);
    expect(check2(date, ymdToSerial(2023, 6, 1)).message).toMatch(/on or after 2024-01-01/);
    expect(check2(date, 'tomorrow').message).toBe('Enter a date');
    expect(describe2(date)).toBe('Date between 2024-01-01 and 2024-12-31');
    expect(describe2({ type: 'formula', source: '=A1>0' })).toBe('Formula =A1>0');
  });

  it('evaluates custom formulas against the value being typed', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'apple');
    wb.setInput(id, 1, 0, 'pear');
    wb.addValidation(id, { range: parseRange('A1:A10'), type: 'formula', source: '=COUNTIF($A$1:$A$10,A1)=1', strict: true });
    expect(wb.validateCell(id, 0, 0).ok).toBe(true);
    expect(wb.validateInput(id, 2, 0, 'apple').ok).toBe(false); // would be a second apple
    expect(wb.validateInput(id, 2, 0, 'plum').ok).toBe(true);
    wb.setInput(id, 2, 0, 'apple');
    expect(wb.validateCell(id, 2, 0).ok).toBe(false);
    expect(wb.validateCell(id, 1, 0).ok).toBe(true);
    wb.addValidation(id, { range: parseRange('B1:B5'), type: 'formula', source: '=B1>A1', strict: true });
    wb.setInput(id, 0, 0, '10');
    expect(wb.validateInput(id, 0, 1, '11').ok).toBe(true);
    expect(wb.validateInput(id, 0, 1, '9').ok).toBe(false);
    expect(wb.validateInput(id, 0, 1, '=A1+1').ok).toBe(true); // formulas are judged by their results later
    wb.addValidation(id, { range: parseRange('C1:C5'), type: 'date', min: ymdToSerial(2024, 1, 1) });
    expect(wb.validateInput(id, 0, 2, '2024-03-01').ok).toBe(true);
    expect(wb.validateInput(id, 0, 2, '2023-03-01').ok).toBe(false);
    expect(wb.validateInput(id, 0, 2, 'soon').ok).toBe(false);
  });
});
import { splitList, isRangeSource, listOptions, checkValue, describeValidation } from '../src/core/validation.js';

describe('validation rules', () => {
  it.each([Infinity, -Infinity, NaN, 'Infinity', '-Infinity', '1e999'])('rejects non-finite numeric input %s', (value) => {
    expect(checkValue({ type: 'number' }, value).ok).toBe(false);
  });

  it('parses literal lists and recognizes range sources', () => {
    expect(splitList(' Yes, No ,Maybe,,')).toEqual(['Yes', 'No', 'Maybe']);
    expect(isRangeSource('Lists!$A$1:$A$9')).toBe(true);
    expect(isRangeSource("'My Lists'!A1:A3")).toBe(true);
    expect(isRangeSource('A1:A3')).toBe(true);
    expect(isRangeSource('Yes, No')).toBe(false);
    expect(isRangeSource('A1')).toBe(false);
  });

  it('resolves options from a range, deduplicated and blank-free', () => {
    const rule = { type: 'list', source: 'Lists!A1:A5' };
    const resolve = () => ['Red', 'Green', null, 'Red', 3, true];
    expect(listOptions(rule, resolve)).toEqual(['Red', 'Green', '3', 'TRUE']);
    expect(listOptions({ type: 'list', source: 'a,b' })).toEqual(['a', 'b']);
    expect(listOptions({ type: 'number' })).toEqual([]);
  });

  it.each(['range', 'array'])('retains distinct types with identical dropdown labels from a %s', (sourceType) => {
    const values = [5, '5', true, 'TRUE', false, 'FALSE', 5, '5'];
    const rule = { type: 'list', source: sourceType === 'range' ? 'A1:A8' : values };
    expect(listOptions(rule, () => values, { typed: true })).toEqual(values.slice(0, 6));
    expect(listOptions(rule, () => values)).toEqual(['5', 'TRUE', 'FALSE']);
  });

  it('reads list options from a worksheet whose name contains an apostrophe', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const source = wb.addSheet("O'Brien");
    wb.setInput(source.id, 0, 0, 'Red');
    wb.setInput(source.id, 1, 0, 'Green');
    const rule = { type: 'list', source: "'O''Brien'!$A$1:$A$2" };
    expect(isRangeSource(rule.source)).toBe(true);
    expect(wb.listOptionsFor(id, rule)).toEqual(['Red', 'Green']);
  });

  it('checks list values case-insensitively and numerically', () => {
    const rule = { type: 'list', source: 'Yes, No, 10' };
    expect(checkValue(rule, 'yes').ok).toBe(true);
    expect(checkValue(rule, 10).ok).toBe(true);
    expect(checkValue(rule, 'Maybe')).toEqual({ ok: false, message: 'Pick one of: Yes, No, 10' });
    expect(checkValue({ ...rule, message: 'Choose an answer' }, 'x').message).toBe('Choose an answer');
    expect(checkValue(rule, null).ok).toBe(true);
    expect(checkValue({ ...rule, allowBlank: false }, '').ok).toBe(false);
    expect(checkValue(rule, { error: '#N/A' }).ok).toBe(true);
  });

  it('checks number ranges and checkboxes', () => {
    expect(checkValue({ type: 'number', min: 1, max: 5 }, 3).ok).toBe(true);
    expect(checkValue({ type: 'number', min: 1, max: 5 }, 6).message).toMatch(/at most 5/);
    expect(checkValue({ type: 'number', min: 1 }, 0).message).toMatch(/at least 1/);
    expect(checkValue({ type: 'number' }, 'abc').message).toBe('Enter a number');
    expect(checkValue({ type: 'number', max: 10 }, '7').ok).toBe(true);
    expect(checkValue({ type: 'checkbox' }, true).ok).toBe(true);
    expect(checkValue({ type: 'checkbox' }, 'yes').ok).toBe(false);
  });

  it('describes rules', () => {
    expect(describeValidation({ type: 'list', source: 'a, b' })).toBe('List: a, b');
    expect(describeValidation({ type: 'list', source: 'L!A1:A3' })).toBe('List from L!A1:A3');
    expect(describeValidation({ type: 'number', min: 1, max: 2 })).toBe('Number between 1 and 2');
    expect(describeValidation({ type: 'number', max: 2 })).toBe('Number at most 2');
    expect(describeValidation({ type: 'number' })).toBe('Any number');
    expect(describeValidation({ type: 'checkbox' })).toBe('Checkbox');
  });
});

describe('dropdown chips', () => {
  it('colors each option from the palette in turn, or as chosen', () => {
    const rule = { type: 'list', source: 'To do, Doing, Done', chips: true, colors: { Done: '#E2F6EA' } };
    const options = ['To do', 'Doing', 'Done'];
    expect(chipFor(rule, 'To do', options)).toEqual({ bg: CHIP_PALETTE[0][0], color: '#1a1a1a' });
    expect(chipFor(rule, 'doing', options).bg).toBe(CHIP_PALETTE[1][0]);
    expect(chipFor(rule, 'Done', options).bg).toBe('#e2f6ea');
    expect(chipFor(rule, 'Other', options).bg).toBe(CHIP_PALETTE[0][0]); // an unknown value still gets a chip
    expect(chipFor(rule, '', options)).toBeNull();
    expect(chipFor({ ...rule, chips: false }, 'Done', options)).toBeNull();
    expect(describe2(rule)).toBe('List: To do, Doing, Done (colored chips)');
  });

  it('is read from the cell by the workbook', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.addValidation(id, { range: parseRange('A1:A5'), type: 'list', source: 'Low, High', chips: true });
    wb.setInput(id, 0, 0, 'High');
    wb.setInput(id, 1, 0, 'Low');
    expect(wb.chipAt(id, 0, 0).bg).toBe(CHIP_PALETTE[1][0]);
    expect(wb.chipAt(id, 1, 0).bg).toBe(CHIP_PALETTE[0][0]);
    expect(wb.chipAt(id, 2, 0)).toBeNull(); // empty
    expect(wb.chipAt(id, 0, 3)).toBeNull(); // no rule
    const copy = new Workbook(wb.toJSON());
    expect(copy.sheets[0].validations[0].chips).toBe(true);
  });
});

it('keeps literal list arrays distinct from references and preserves value types', () => {
  const source = ['Acme, Inc.', 'Line\nBreak', ' East ', 'A1:A3', 1.25, false];
  const rule = { type: 'list', source };
  expect(isRangeSource(['A1:A3'])).toBe(false);
  expect(listOptions(rule)).toEqual(['Acme, Inc.', 'Line\nBreak', ' East ', 'A1:A3', '1.25', 'FALSE']);
  expect(listOptions(rule, undefined, { typed: true })).toEqual(source);
  for (const value of source) expect(checkValue(rule, value).ok).toBe(true);
  expect(checkValue(rule, 'Acme  Inc.').ok).toBe(false);
  expect(checkValue(rule, 'Line').ok).toBe(false);
  expect(checkValue(rule, 'East').ok).toBe(false);
});
