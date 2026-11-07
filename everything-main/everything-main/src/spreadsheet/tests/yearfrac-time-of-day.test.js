import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// YEARFRAC truncates both dates to whole days on every basis (all arguments
// are truncated to integers), so a date carrying a time of day, such as NOW(), counts its days
// alone. Bases 1, 2 and 3 divided the untruncated difference, and basis 1 could then take the
// year length of a span that, in whole days, ends on the anniversary.
describe('YEARFRAC with a time of day on the dates', () => {
  it('counts whole days on the actual bases', () => {
    expect(calc('YEARFRAC(DATE(2024,1,1),DATE(2025,1,1)+0.5,1)')).toBe(1);
    expect(calc('YEARFRAC(DATE(2024,1,1)+0.9,DATE(2025,1,1)+0.1,1)')).toBe(1);
    expect(calc('YEARFRAC(DATE(2024,1,1)+0.5,DATE(2024,7,1)+0.9,1)')).toBe(182 / 366);
    expect(calc('YEARFRAC(DATE(2024,1,1)+0.5,DATE(2024,7,1)+0.9,2)')).toBe(182 / 360);
    expect(calc('YEARFRAC(DATE(2024,1,1)+0.5,DATE(2024,7,1)+0.9,3)')).toBe(182 / 365);
    expect(calc('YEARFRAC(DATE(2024,7,1)+0.9,DATE(2024,1,1)+0.5,3)')).toBe(182 / 365); // in either order
    expect(calc('YEARFRAC(45000.2,45000.9,1)')).toBe(0); // one day, two times
  });

  it('keeps truncating on the 30/360 bases', () => {
    expect(calc('YEARFRAC(DATE(2024,1,1)+0.25,DATE(2024,7,1)+0.75,0)')).toBe(0.5);
    expect(calc('YEARFRAC(DATE(2024,1,1)+0.25,DATE(2024,7,1)+0.75,4)')).toBe(0.5);
  });

  it('answers as before for whole dates', () => {
    expect(calc('YEARFRAC(DATE(2024,1,1),DATE(2024,7,1),1)')).toBe(182 / 366);
    expect(calc('YEARFRAC(DATE(2023,1,1),DATE(2025,7,1),1)')).toBeCloseTo(912 / (1096 / 3), 12);
    expect(calc('YEARFRAC(DATE(2024,1,1),DATE(2024,12,31),3)')).toBe(365 / 365);
  });
});
