import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function calc(formula) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, `=${formula}`);
  return wb.getValue(id, 0, 0);
}

const NUM = { error: '#NUM!' };

// HOUR, MINUTE and SECOND take a date serial: negative ones and ones past 31 December 9999 are #NUM!.
describe('HOUR, MINUTE and SECOND outside the calendar', () => {
  it('are #NUM! for a negative serial', () => {
    expect(calc('HOUR(-0.5)')).toEqual(NUM);
    expect(calc('MINUTE(-1)')).toEqual(NUM);
    expect(calc('SECOND(-0.25)')).toEqual(NUM);
  });

  it('are #NUM! past the last day of the calendar', () => {
    expect(calc('HOUR(3000000)')).toEqual(NUM);
    expect(calc('MINUTE(2958466)')).toEqual(NUM);
    expect(calc('SECOND(2958466.5)')).toEqual(NUM);
  });

  it('still read the time of day inside the calendar', () => {
    expect(calc('HOUR(0.5)')).toBe(12);
    expect(calc('HOUR(0)')).toBe(0);
    expect(calc('HOUR(2958465.75)')).toBe(18);
    expect(calc('MINUTE("13:45")')).toBe(45);
    expect(calc('SECOND(TIME(1,2,3))')).toBe(3);
  });
});
