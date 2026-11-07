import { describe, expect, it } from 'vitest';
import { StrokeSession, type PaintMode } from '../src/engine/paint';
import { TileStore, gridFromImage, readRGBA } from '../src/model/tiles';
import { blendPixel, type BlendMode } from '../src/imaging/blend/modes';

// A 64 x 64 layer filled with one color, painted with a hard 20 px dab.
function paint(mode: PaintMode, base: [number, number, number, number], rgb: [number, number, number], opacity = 1) {
  const store = new TileStore();
  const data = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < data.length; i += 4) data.set(base, i);
  const grid = gridFromImage(store, { width: 64, height: 64, data });
  const s = new StrokeSession(store, grid, {
    tip: { size: 20, hardness: 1, spacing: 0.1, roundness: 1, angle: 0 },
    opacity, flow: 1, target: { kind: 'color', rgb, mode }, seed: 7,
  });
  s.addPoint(32, 32, 1);
  return readRGBA(store, s.commit(), { x: 0, y: 0, width: 64, height: 64 });
}
const at = (img: { data: Uint8ClampedArray; width: number }, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe('brush blend modes', () => {
  const cases: BlendMode[] = ['multiply', 'screen', 'color-burn', 'linear-dodge', 'soft-light', 'vivid-light', 'hard-mix', 'exclusion', 'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity', 'darker-color', 'lighter-color'];
  for (const mode of cases)
    it(`${mode} matches the layer blend reference`, () => {
      const base: [number, number, number, number] = [60, 140, 200, 255];
      const rgb: [number, number, number] = [220, 90, 30];
      const out = at(paint(mode, base, rgb, 0.6), 32, 32);
      const ref = blendPixel(mode, base.map((v) => v / 255), [...rgb.map((v) => v / 255), 1], 0.6);
      for (let c = 0; c < 3; c++) expect(Math.abs(out[c] - ref[c] * 255)).toBeLessThanOrEqual(2);
      expect(out[3]).toBe(255);
    });
  it('paints normally where the layer is transparent', () => {
    const out = at(paint('multiply', [0, 0, 0, 0], [220, 90, 30]), 32, 32);
    expect(out).toEqual([220, 90, 30, 255]);
  });
  it('dissolve leaves only fully painted or untouched pixels', () => {
    const img = paint('dissolve', [0, 0, 0, 0], [255, 0, 0], 0.5);
    let painted = 0, partial = 0;
    for (let y = 25; y < 40; y++)
      for (let x = 25; x < 40; x++) {
        const a = at(img, x, y)[3];
        if (a === 255) painted++;
        else if (a !== 0) partial++;
      }
    expect(partial).toBe(0);
    expect(painted).toBeGreaterThan(40);
    expect(painted).toBeLessThan(200);
  });
  it('behind paints only under existing pixels and clear erases', () => {
    const behind = at(paint('behind', [10, 20, 30, 255], [255, 0, 0]), 32, 32);
    expect(behind).toEqual([10, 20, 30, 255]);
    const cleared = at(paint('clear', [10, 20, 30, 255], [255, 0, 0]), 32, 32);
    expect(cleared[3]).toBe(0);
  });
});
