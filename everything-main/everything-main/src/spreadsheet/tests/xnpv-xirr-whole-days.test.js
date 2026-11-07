import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// XNPV and XIRR discounted by the raw date serials, so a time of day in a date cell (a NOW() stamp, an
// imported date-time) shifted the answer. The dates are now truncated to whole days.
const FLOWS = '{-10000,2750,4250,3250,2750}';
const DATES = '{DATE(2008,1,1),DATE(2008,3,1),DATE(2008,10,30),DATE(2009,2,15),DATE(2009,4,1)}';
const STAMPED = '{DATE(2008,1,1)+0.5,DATE(2008,3,1)+0.9,DATE(2008,10,30)+0.25,DATE(2009,2,15)+0.75,DATE(2009,4,1)+0.1}';

it('XNPV truncates the dates to whole days', () => {
  expect(calc(`XNPV(0.09,${FLOWS},${DATES})`)).toBeCloseTo(2086.647602, 5); // the documented example
  expect(calc(`XNPV(0.09,${FLOWS},${STAMPED})`)).toBe(calc(`XNPV(0.09,${FLOWS},${DATES})`));
  expect(calc('XNPV(0.09,{-10000,2750},{DATE(2008,1,1)+0.5,DATE(2008,3,1)+0.9})')).toBeCloseTo(-7288.682402605367, 9);
});

it('XIRR truncates the dates to whole days', () => {
  expect(calc(`XIRR(${FLOWS},${DATES})`)).toBeCloseTo(0.373362535, 8); // the documented example
  expect(calc(`XIRR(${FLOWS},${STAMPED})`)).toBeCloseTo(calc(`XIRR(${FLOWS},${DATES})`), 12);
});

it('judges a date before the first by the day, not the time of day', () => {
  expect(calc('XNPV(0.1,{-100,110},{DATE(2020,1,1)+0.9,DATE(2020,1,1)+0.1})')).toBeCloseTo(10, 9);
  expect(calc('XIRR({-100,50,60},{DATE(2020,1,1)+0.9,DATE(2020,1,1)+0.1,DATE(2020,12,31)})')).toBeCloseTo(0.2, 8);
  expect(calc('XNPV(0.1,{-100,110},{DATE(2020,1,2)+0.1,DATE(2020,1,1)+0.9})')).toEqual({ error: '#NUM!' });
});
