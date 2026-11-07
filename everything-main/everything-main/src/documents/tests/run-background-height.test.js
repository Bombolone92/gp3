import { it, expect } from 'vitest';
import { runBackgroundRect } from '../src/engine/backgrounds.js';

const span = { x: 40, width: 25, ascent: 8, descent: 2 };
it('uses shared line metrics without expanding into automatic or minimum leading', () => {
  const line = { y: 30, height: 60, baseline: 55, ascent: 20, descent: 5 };
  expect(runBackgroundRect(line, span)).toEqual({ x: 40, y: 35, width: 25, height: 25 });
});
it('fills exact line boxes while excluding square-wrap clearance', () => {
  const line = { y: 30, height: 60, baseline: 55, ascent: 20, descent: 5, clip: true };
  expect(runBackgroundRect(line, span)).toEqual({ x: 40, y: 30, width: 25, height: 60 });
  expect(runBackgroundRect({ ...line, wrapBefore: 15 }, span)).toEqual({ x: 40, y: 45, width: 25, height: 45 });
});
