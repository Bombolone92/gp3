import { describe, expect, it } from 'vitest';
import { Workbook, cellFromInput } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// Typing 5% into a cell the toolbar had set to Percent (which leaves the decimals at the default two) rewrote
// the cell's decimals to the none typed, so a later 12.5% showed 13%; a Number cell typed 1,000 then 1,234.5
// showed 1,235, and the format depended on the order of entry. The decimals, seconds or fraction code a
// typed value carries refine only a format the entry itself implied; a format the user set is never
// altered when a value is typed.
describe('a value typed into a cell already formatted by the user', () => {
  const book = (style) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.applyStyle(id, parseRange('A1'), style);
    const type = (text) => { wb.setInput(id, 0, 0, text); return [wb.getCell(id, 0, 0).s, wb.getDisplay(id, 0, 0)]; };
    return type;
  };

  it('keeps the default decimals of a Percent preset, so 12.5% after 5% still shows its half', () => {
    const type = book({ fmt: 'percent' });
    expect(type('5%')).toEqual([{ fmt: 'percent' }, '5.00%']);
    expect(type('12.5%')).toEqual([{ fmt: 'percent' }, '12.50%']);
    expect(type('0.125')).toEqual([{ fmt: 'percent' }, '12.50%']);
  });

  it('keeps the default decimals of a Number preset whatever the order of entry', () => {
    const type = book({ fmt: 'number' });
    expect(type('1,000')).toEqual([{ fmt: 'number' }, '1,000.00']);
    expect(type('1,234.5')).toEqual([{ fmt: 'number' }, '1,234.50']);
    expect(type('1234.5')).toEqual([{ fmt: 'number' }, '1,234.50']);
    const reversed = book({ fmt: 'number' });
    expect(reversed('1,234.5')).toEqual([{ fmt: 'number' }, '1,234.50']);
    expect(reversed('1,000')).toEqual([{ fmt: 'number' }, '1,000.00']);
  });

  it('keeps a Time or Date and time preset without seconds', () => {
    expect(book({ fmt: 'time' })('9:05:20')).toEqual([{ fmt: 'time' }, '09:05']);
    expect(book({ fmt: 'datetime' })('2024-01-15 13:45:20')).toEqual([{ fmt: 'datetime' }, '2024-01-15 13:45']);
  });

  it('keeps the decimals and seconds the user chose explicitly', () => {
    expect(book({ fmt: 'percent', dec: 1 })('5%')).toEqual([{ fmt: 'percent', dec: 1 }, '5.0%']);
    expect(book({ fmt: 'number', dec: 0 })('1,234.5')).toEqual([{ fmt: 'number', dec: 0 }, '1,235']);
    expect(book({ fmt: 'time', sec: true })('9:05')).toEqual([{ fmt: 'time', sec: true }, '09:05:00']);
  });

  it('still stamps the typed decimals, seconds and fraction code onto a General cell', () => {
    expect(cellFromInput('5%', undefined).s).toEqual({ fmt: 'percent', dec: 0 });
    expect(cellFromInput('5.25%', { bold: true }).s).toEqual({ bold: true, fmt: 'percent', dec: 2 });
    expect(cellFromInput('1,234.5', { fmt: 'general' }).s).toEqual({ fmt: 'number', dec: 2 });
    expect(cellFromInput('9:05:30', undefined).s).toEqual({ fmt: 'time', sec: true });
    expect(cellFromInput('1 1/2', undefined).s).toEqual({ fmt: 'custom', code: '# ?/?' });
    // Once an entry has implied a format, the cell has one, and a later entry leaves it.
    const type = book({});
    expect(type('5%')).toEqual([{ fmt: 'percent', dec: 0 }, '5%']);
    expect(type('12.5%')).toEqual([{ fmt: 'percent', dec: 0 }, '13%']);
  });
});
