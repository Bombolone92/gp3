import {  spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { FUNCTIONS } from '../src/core/formula/functions.js';
import {ymdToSerial } from '../src/core/format.js';

it.each([
  'NETWORKDAYS(1e16,1e16)',
  'NETWORKDAYS.INTL(1e16,1e16)',
  'WORKDAY(1,1e16)',
  'WORKDAY.INTL(1,1e16)',
  'WORKDAY(1e16,1)',
  'WORKDAY.INTL(1e16,1)',
  'WORKDAY(1,1e12)',
  'WORKDAY.INTL(1,-1e12)',
])('rejects unrepresentable dates in %s without hanging evaluation', (formula) => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { Workbook } from './src/core/workbook.js';
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, ${JSON.stringify(`=${formula}`)});
    process.stdout.write(JSON.stringify(wb.getValue(wb.activeSheetId, 0, 0)));
  `], { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 2000, encoding: 'utf8' });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ error: '#NUM!' });
});

it.each(['WORKDAY', 'WORKDAY.INTL'])('%s stops when weekends push a result beyond the calendar', (name) => {
  const last = 2958465; // 31 December 9999, a Friday and the calendar's last day
  expect(FUNCTIONS[name].fn([last, 1])).toEqual({ error: '#NUM!' });
  expect(FUNCTIONS[name].fn([last, 0])).toBe(last);
  expect(FUNCTIONS[name].fn([1, NaN])).toEqual({ error: '#NUM!' });
});

it('keeps weekends, holidays, reverse counting, fractional inputs, and zero offsets', () => {
  const friday = ymdToSerial(2026, 9, 11);
  const monday = friday + 3;
  const holiday = { range: true, values: [[monday]] };
  expect(FUNCTIONS.WORKDAY.fn([friday, 1])).toBe(monday);
  expect(FUNCTIONS.WORKDAY.fn([friday + 0.5, 1.9, holiday])).toBe(monday + 1);
  expect(FUNCTIONS.WORKDAY.fn([monday, -1])).toBe(friday);
  expect(FUNCTIONS.WORKDAY.fn([-1, 0])).toEqual({ error: '#NUM!' }); // before day 0 of the calendar
  expect(FUNCTIONS.NETWORKDAYS.fn([friday, monday])).toBe(2);
  expect(FUNCTIONS.NETWORKDAYS.fn([monday, friday, holiday])).toBe(-1);
  expect(FUNCTIONS['WORKDAY.INTL'].fn([friday, 1, '0000000'])).toBe(friday + 1);
  expect(FUNCTIONS['WORKDAY.INTL'].fn([friday, 1, '1111111'])).toEqual({ error: '#VALUE!' });
  expect(FUNCTIONS['NETWORKDAYS.INTL'].fn([friday, monday, '0000000'])).toBe(4);
  expect(FUNCTIONS['NETWORKDAYS.INTL'].fn([monday, friday, 1, holiday])).toBe(-1);
});
