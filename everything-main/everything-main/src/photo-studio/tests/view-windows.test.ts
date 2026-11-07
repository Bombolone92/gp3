import { describe, expect, it } from 'vitest';
import {
  applyAffine,
  centerPoint,
  dragRotation,
  fillZoom,
  fitZoom,
  invertAffine,
  normalizeRotation,
  panToCenter,
  pixelsPerInch,
  printSizeZoom,
  rotateAround,
  screenExtent,
  stageTransform,
  viewMatrix,
  zoomAround,
  type ViewState,
} from '../src/app/view-transform';
import { cascade, cellCount, cellRect, clampFloat, distribute, grid, layoutCells, layoutKinds } from '../src/app/view-layout';
import { wrapPositions } from '../src/engine/paint';

const doc = { width: 400, height: 200 };
const viewport = { width: 1000, height: 800 };
const base: ViewState = { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0, flip: false };
const close = (a: number[], b: number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('view transform', () => {
  it('centers the document in the viewport', () => {
    const m = viewMatrix(base, doc, viewport);
    close(applyAffine(m, 0, 0), [300, 300]);
    close(applyAffine(m, 200, 100), [500, 400]);
  });
  it('rotates about the document center', () => {
    const m = viewMatrix({ ...base, rotation: 90 }, doc, viewport);
    // A clockwise quarter turn on screen: the top-left corner moves to the top-right.
    close(applyAffine(m, 0, 0), [600, 200]);
    close(applyAffine(m, 200, 100), [500, 400]);
  });
  it('round-trips points with rotation, flip, aspect and pan', () => {
    const v: ViewState = { zoom: 2.5, pan: { x: -37, y: 12 }, rotation: 33, flip: true, aspect: 1.5 };
    const m = viewMatrix(v, doc, viewport),
      inv = invertAffine(m);
    for (const p of [[0, 0], [17.5, 190], [400, 3]] as [number, number][]) close(applyAffine(inv, ...applyAffine(m, ...p)), p);
  });
  it('mirrors horizontally around the center when flipped', () => {
    const m = viewMatrix({ ...base, flip: true }, doc, viewport);
    close(applyAffine(m, 0, 0), [700, 300]);
    close(applyAffine(m, 400, 0), [300, 300]);
  });
  it('stretches pixels horizontally for a pixel aspect ratio', () => {
    const m = viewMatrix({ ...base, aspect: 2 }, doc, viewport);
    close(applyAffine(m, 0, 0), [100, 300]);
    close(applyAffine(m, 400, 200), [900, 500]);
  });
  it('matches the CSS stage transform order', () => {
    expect(stageTransform({ ...base, zoom: 2, rotation: 15, pan: { x: 3, y: -4 } })).toBe('translate(calc(-50% + 3px),calc(-50% + -4px)) rotate(15deg) scale(2)');
    expect(stageTransform({ ...base, flip: true, aspect: 0.5 })).toBe('translate(calc(-50% + 0px),calc(-50% + 0px)) scale(-0.5,1)');
  });
  it('normalizes angles', () => {
    expect(normalizeRotation(190)).toBe(-170);
    expect(normalizeRotation(-180)).toBe(180);
    expect(normalizeRotation(720)).toBe(0);
    expect(normalizeRotation(-45)).toBe(-45);
  });
  it('keeps the pivot fixed while rotating', () => {
    const v = { ...base, pan: { x: 40, y: -25 } };
    const pivot: [number, number] = [700, 260];
    const before = applyAffine(invertAffine(viewMatrix(v, doc, viewport)), ...pivot);
    const r = rotateAround(v, 70, viewport, ...pivot);
    const after = applyAffine(invertAffine(viewMatrix({ ...v, ...r }, doc, viewport)), ...pivot);
    close(after, before);
    expect(r.rotation).toBe(70);
  });
  it('keeps the point under the cursor fixed while zooming', () => {
    const v = { ...base, rotation: 30, pan: { x: 10, y: 5 } };
    const before = applyAffine(invertAffine(viewMatrix(v, doc, viewport)), 640, 120);
    const z = zoomAround(v, 3, viewport, 640, 120);
    const after = applyAffine(invertAffine(viewMatrix({ ...v, ...z }, doc, viewport)), 640, 120);
    close(after, before);
    expect(zoomAround(v, 1e6, viewport).zoom).toBe(64);
  });
  it('measures drag rotation and snaps to steps', () => {
    expect(dragRotation(0, [10, 0], [0, 10], [0, 0])).toBeCloseTo(90);
    expect(dragRotation(10, [10, 0], [10, 1.9], [0, 0], 15)).toBe(15);
    expect(dragRotation(170, [10, 0], [0, 10], [0, 0])).toBeCloseTo(-100);
  });
  it('fits and fills rotated documents', () => {
    expect(fitZoom(base, doc, viewport, 0, 10)).toBeCloseTo(2.5);
    const e = screenExtent({ rotation: 90 }, doc);
    close([e.width, e.height], [200, 400]);
    expect(fitZoom({ rotation: 90 }, doc, viewport, 0, 10)).toBeCloseTo(2);
    expect(fitZoom(base, doc, viewport)).toBe(1);
    expect(fillZoom({ rotation: 0 }, doc, viewport)).toBeCloseTo(4);
  });
  it('centers a document point and reads it back', () => {
    const v = { ...base, zoom: 3, rotation: -20, aspect: 1.2 };
    const pan = panToCenter(v, doc, 120, 45);
    close(centerPoint({ ...v, pan }, doc), [120, 45]);
  });
  it('computes print size zoom from resolution', () => {
    expect(printSizeZoom(300, 96)).toBeCloseTo(0.32);
    expect(pixelsPerInch(undefined)).toBe(72);
    expect(pixelsPerInch({ horizontalResolution: 100, horizontalResolutionUnit: 'PPCM' })).toBeCloseTo(254);
    expect(printSizeZoom(1, 1e6)).toBe(64);
  });
});

describe('window layouts', () => {
  const cover = (cells: { x: number; y: number; width: number; height: number }[]) => cells.reduce((a, c) => a + c.width * c.height, 0);
  it('covers the area exactly for every layout and view count', () => {
    for (const kind of layoutKinds)
      for (let n = 1; n <= 9; n++) {
        const cells = layoutCells(kind, n);
        expect(cells.length).toBe(cellCount(kind, n));
        expect(cover(cells)).toBeCloseTo(1);
        for (const c of cells) expect(c.x + c.width).toBeLessThanOrEqual(1 + 1e-9);
      }
  });
  it('builds n-up layouts', () => {
    expect(layoutCells('2-up-vertical', 5)).toEqual([{ x: 0, y: 0, width: 0.5, height: 1 }, { x: 0.5, y: 0, width: 0.5, height: 1 }]);
    expect(layoutCells('2-up-horizontal', 2)[1]).toEqual({ x: 0, y: 0.5, width: 1, height: 0.5 });
    expect(layoutCells('3-up-stacked', 3)[0]).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
    expect(layoutCells('4-up', 4).map((c) => [c.x, c.y])).toEqual([[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]);
    expect(layoutCells('6-up', 6).length).toBe(6);
    expect(layoutCells('tabs', 4).length).toBe(1);
    // Fewer views than cells: the layout shrinks rather than leaving holes.
    expect(layoutCells('4-up', 3).length).toBe(3);
  });
  it('stretches a short last grid row', () => {
    const cells = grid(5, 3);
    expect(cells.slice(3).map((c) => c.width)).toEqual([0.5, 0.5]);
  });
  it('distributes extra views as tabs of the last cell', () => {
    expect(distribute(['a', 'b', 'c', 'd', 'e'], 4)).toEqual([['a'], ['b'], ['c'], ['d', 'e']]);
    expect(distribute(['a'], 4)).toEqual([['a']]);
    expect(distribute([], 2)).toEqual([[]]);
  });
  it('rounds cells to whole pixels without gaps', () => {
    const a = cellRect({ x: 0, y: 0, width: 1 / 3, height: 1 }, { width: 1000, height: 600 });
    const b = cellRect({ x: 1 / 3, y: 0, width: 1 / 3, height: 1 }, { width: 1000, height: 600 });
    expect(a.x + a.width).toBe(b.x);
  });
  it('cascades and clamps floating windows', () => {
    const area = { width: 1000, height: 700 };
    const a = cascade(0, area),
      b = cascade(1, area);
    expect(b.x - a.x).toBe(26);
    expect(a.width).toBe(600);
    const c = clampFloat({ x: 5000, y: -40, width: 10, height: 10 }, area);
    expect(c).toEqual({ x: 940, y: 0, width: 180, height: 120 });
  });
});

describe('pattern wrapping', () => {
  it('repeats dabs across tile edges', () => {
    expect(wrapPositions(50, 50, 10, 200, 100)).toEqual([[50, 50]]);
    const edge = wrapPositions(195, 50, 10, 200, 100);
    expect(edge).toEqual([[-5, 50], [195, 50]]);
    // Outside the tile, positions are folded back in.
    expect(wrapPositions(410, 150, 4, 200, 100)).toEqual([[10, 50]]);
    expect(wrapPositions(2, 98, 5, 200, 100).length).toBe(4);
  });
});
