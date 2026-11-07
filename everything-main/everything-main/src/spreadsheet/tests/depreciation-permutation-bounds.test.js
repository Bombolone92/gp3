import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

// PERMUT multiplied out one factor per permutation and DDB, DB and VDB walked one
// step per period, so a mistyped life or count ran for ever in a single cell. The
// formula is saved with the sheet, so the file could not be opened again either.
// FACT, FACTDOUBLE, COMBIN, MUNIT and CUMIPMT were already bounded; these four are now.
describe('functions that used to count out every permutation or period', () => {
  it('answers a count or a life beyond any real schedule at once', { timeout: 30000 }, () => {
    const started = Date.now();
    expect(calc('PERMUT(1E15,1E15)')).toEqual(E('#NUM!'));
    expect(calc('DDB(2400,300,1E15,1E15)')).toEqual(E('#NUM!'));
    expect(calc('DB(1000,100,1E12,1E12)')).toEqual(E('#NUM!'));
    expect(calc('VDB(2400,300,1E12,0,1E12)')).toEqual(E('#NUM!'));
    expect(calc('PERMUT(1E9,1E9)')).toEqual(E('#NUM!'));
    expect(calc('VDB(2400,300,1E12,1E11,2E11)')).toEqual(E('#NUM!'));
    // Every one of these ran for minutes or longer before; a quiet run is now ~10 ms.
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('keeps the schedules people really write', () => {
    expect(calc('PERMUT(5,2)')).toBe(20);
    expect(calc('PERMUT(100,3)')).toBe(970200);
    expect(calc('PERMUT(170,170)')).toBeCloseTo(7.257415615307999e306, -294);
    expect(calc('PERMUT(1000,1000)')).toEqual(E('#NUM!'));
    expect(calc('DDB(2400,300,10,1)')).toBeCloseTo(480, 9);
    expect(calc('DDB(2400,300,10,2)')).toBeCloseTo(384, 9);
    expect(calc('DDB(2400,300,10,10)')).toBeCloseTo(22.1225472, 9);
    expect(calc('DB(1000000,100000,6,1,7)')).toBeCloseTo(186083.333333, 6);
    expect(calc('DB(1000000,100000,6,7,7)')).toBeCloseTo(15845.098474, 6);
    expect(calc('VDB(2400,300,10,0,1)')).toBeCloseTo(480, 9);
    expect(calc('VDB(2400,300,10,0,0.875,1.5)')).toBeCloseTo(315, 9);
    expect(calc('VDB(2400,300,10,1,2)')).toBeCloseTo(384, 9);
    expect(calc('VDB(2400,300,10,0,10)')).toBeCloseTo(2100, 9);
    // A million periods still answers, so the cap is out beyond any real life.
    expect(calc('DDB(2400,300,1E6,1E6)')).toBeGreaterThan(0);
    expect(calc('VDB(2400,300,1E6,999999,1E6)')).toBeGreaterThan(0);
  });

  it('still takes the whole schedule when only part of it is asked for', () => {
    // VDB sums the periods it was asked about, so stopping the walk at the end
    // of the window must not change what a part of the life comes to.
    expect(calc('VDB(2400,300,10,3,6)') + calc('VDB(2400,300,10,0,3)') + calc('VDB(2400,300,10,6,10)'))
      .toBeCloseTo(calc('VDB(2400,300,10,0,10)'), 9);
    expect(calc('VDB(2400,300,10,2.5,4.5)')).toBeCloseTo(
      calc('VDB(2400,300,10,0,4.5)') - calc('VDB(2400,300,10,0,2.5)'), 9,
    );
    expect(calc('VDB(2400,300,10,4,4)')).toBe(0);
    expect(calc('VDB(1000,100,5,2.5,4.5,2,TRUE)')).toBeCloseTo(
      calc('VDB(1000,100,5,0,4.5,2,TRUE)') - calc('VDB(1000,100,5,0,2.5,2,TRUE)'), 9,
    );
  });
});
