import { expect, it } from 'vitest';
import { offsetPictureContours } from '../src/engine/picture-outline-offset.js';

it('matches the outside picture centerlines measured in the independent native reference PDF', () => {
  expect(offsetPictureContours([[[60,90],[204,90],[204,162],[60,162]]],1.5)[0])
    .toEqual([[58.5,88.5],[205.5,88.5],[205.5,163.5],[58.5,163.5]]);
  const triangle = offsetPictureContours([[[320,90],[464,90],[320,162]]],1.5)[0];
  const native = [[318.5,88.5],[470.35,88.5],[318.5,164.43]];
  triangle.forEach((p,i) => p.forEach((v,j) => expect(Math.abs(v-native[i][j])).toBeLessThan(.006)));
});

it('shrinks holes, expands disjoint contours, and preserves geometry after reflection', () => {
  const outer = [[0,0],[100,0],[100,100],[0,100]], hole = [[25,25],[25,75],[75,75],[75,25]];
  const contours = [outer,hole,outer.map(([x,y])=>[x+200,y])];
  const result = offsetPictureContours(contours,2);
  expect(result[1]).toEqual([[27,27],[27,73],[73,73],[73,27]]);
  expect(result[2]).toEqual([[198,-2],[302,-2],[302,102],[198,102]]);
  const reflected = offsetPictureContours(contours.map(ps=>ps.map(([x,y])=>[-x,y])),2);
  expect(reflected).toEqual(result.map(ps=>ps.map(([x,y])=>[-x,y])));
});

it('does not generate non-finite coordinates for repeated or collinear vertices', () => {
  const result = offsetPictureContours([[[0,0],[0,0],[50,0],[100,0],[100,100],[0,100]]],2);
  expect(result.flat(2).every(Number.isFinite)).toBe(true);
  expect(result[0]).toContainEqual([50,-2]);
});
