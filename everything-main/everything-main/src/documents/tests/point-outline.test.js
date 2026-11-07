import { describe, it, expect } from 'vitest';
import { pointOutlinePosition } from '../src/engine/point-outline.js';

describe('open point outline geometry', () => {
  const position = points => pointOutlinePosition({ width: 100, height: 200, points }, 400, 600);
  it.each([
    [['M', 20, 30], ['L', 20, 30]],
    [['M', 20, 30], ['Q', 20, 30, 20, 30]],
    [['M', 20, 30], ['C', 20, 30, 20, 30, 20, 30]],
  ])('scales a coincident line or curve %j', (...points) => {
    expect(position(points)).toEqual([80, 90]);
  });
  it('does not turn a returning curve into a point', () => {
    expect(position([['M', 20, 30], ['C', 0, 0, 100, 200, 20, 30]])).toBeNull();
  });
  it('does not paint move-only, closed, elliptical, or displaced paths', () => {
    for (const points of [[], [['M', 20, 30]], [['M', 20, 30], ['L', 20, 30], ['Z']], [['E'], ['Z']], [['M', 20, 30], ['L', 20, 30.00001]]]) {
      expect(position(points)).toBeNull();
    }
  });
  it('retains absolute coordinates when custom viewports are omitted', () => {
    expect(pointOutlinePosition({ width: 0, height: 0, points: [['M', 4, 7], ['L', 4, 7]] }, 0, 0)).toEqual([4, 7]);
  });
});
