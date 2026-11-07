import { describe, expect, it } from 'vitest';
import { formatValue, formatGeneral, editText } from '../src/core/format.js';
import { formatWithCode } from '../src/core/numfmt.js';

describe('negative serials in the date and time presets', () => {
  it('show ##### like a custom date code does', () => {
    expect(formatValue(-1, { fmt: 'date' })).toBe('#####');
    expect(formatValue(-0.5, { fmt: 'time' })).toBe('#####');
    expect(formatValue(-1, { fmt: 'datetime' })).toMatch(/^#####/);
    expect(formatWithCode(-1, 'yyyy-mm-dd')).toBe('#####');
    expect(formatValue(45000, { fmt: 'date' })).toBe('2023-03-15');
    expect(formatValue(0.5, { fmt: 'time' })).toBe('12:00');
  });
});

describe('General with an exponent', () => {
  it('uses fixed text when it fits and pads scientific exponents', () => {
    expect(formatGeneral(1e-7)).toBe('0.0000001');
    expect(formatGeneral(1.5e-8)).toBe('0.000000015');
    expect(formatGeneral(1e21)).toBe('1E+21');
    expect(formatGeneral(2.5e300)).toBe('2.5E+300');
    expect(formatGeneral(5e-324)).toBe('4.9407E-324');
    expect(formatGeneral(123456789012345680000)).toBe('1.23457E+20');
  });
});

describe('editing a cell with a custom percent code', () => {
  it('shows the percentage', () => {
    expect(editText({ v: 0.5, s: { fmt: 'custom', code: '0.00%;[Red]-0.00%' } })).toBe('50%');
    expect(editText({ v: -0.25, s: { fmt: 'custom', code: '0.00%;[Red]-0.00%' } })).toBe('-25%');
    expect(editText({ v: 0.125, s: { fmt: 'custom', code: '0.0%' } })).toBe('12.5%');
    // A percent sign inside quotes is only text.
    expect(editText({ v: 0.5, s: { fmt: 'custom', code: '0.00" %"' } })).toBe('0.5');
    expect(editText({ v: 0.5, s: { fmt: 'percent' } })).toBe('50%');
  });
});

describe('a date code with quoted separators', () => {
  it('is the date preset it means, so the category survives an .ods round trip', async () => {
    const { numFmtToStyle } = await import('../src/core/format.js');
    expect(numFmtToStyle('yyyy"-"mm"-"dd')).toEqual({ fmt: 'date' });
    expect(numFmtToStyle('hh":"mm')).toEqual({ fmt: 'time' });
    expect(numFmtToStyle('yyyy"-"mm"-"dd" "hh":"mm')).toEqual({ fmt: 'datetime' });
    expect(numFmtToStyle('yyyy-mm-dd')).toEqual({ fmt: 'date' });
    expect(numFmtToStyle('"$"#,##0.00')).toMatchObject({ fmt: 'currency' });
    const { Workbook } = await import('../src/core/workbook.js');
    const { workbookToOds, workbookFromFile } = await import('../src/core/io.js');
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, [{ r: 0, c: 0, cell: { v: 45000, s: { fmt: 'date' } } }, { r: 1, c: 0, cell: { v: 0.5, s: { fmt: 'time' } } }]);
    const back = await workbookFromFile(await (await workbookToOds(wb, { settings: false })).arrayBuffer(), 'dates.ods');
    expect(back.getCell(back.activeSheetId, 0, 0).s.fmt).toBe('date');
    expect(back.getCell(back.activeSheetId, 1, 0).s.fmt).toBe('time');
  });
});
