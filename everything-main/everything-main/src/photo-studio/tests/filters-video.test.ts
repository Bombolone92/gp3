import { describe, expect, it } from 'vitest';
import { broadcastSafe, compositePeak, deinterlace, signalLimits } from '../src/imaging/filters/video';
import { defaults, type RGBA8 } from '../src/imaging/types';
import { allFilters, commandId, filterOp } from '../src/features/filters/catalog';

const ctx = { foreground: [0, 0, 0] as [number, number, number], background: [255, 255, 255] as [number, number, number] };
/** One column; row y has gray value rows[y] (alpha 255 unless given). */
function column(rows: number[], alpha?: number[]): RGBA8 {
  const data = new Uint8ClampedArray(rows.length * 4 * 2);
  rows.forEach((v, y) => {
    for (let x = 0; x < 2; x++) data.set([v, v, v, alpha?.[y] ?? 255], (y * 2 + x) * 4);
  });
  return { width: 2, height: rows.length, data };
}
const grays = (img: RGBA8) => Array.from({ length: img.height }, (_, y) => img.data[y * img.width * 4]);

describe('De-Interlace', () => {
  const src = column([10, 200, 30, 220, 50, 240]);
  it('replaces odd lines by duplicating the line above', async () => {
    const out = await deinterlace.apply(src, { remove: 'odd', fill: 'duplicate' }, ctx);
    expect(grays(out)).toEqual([10, 10, 30, 30, 50, 50]);
  });
  it('replaces even lines by interpolating, copying at the edges', async () => {
    const out = await deinterlace.apply(src, { remove: 'even', fill: 'interpolate' }, ctx);
    expect(grays(out)).toEqual([200, 200, 210, 220, 230, 240]);
    const odd = await deinterlace.apply(src, { remove: 'odd', fill: 'interpolate' }, ctx);
    // The last odd line has no line below and copies the one above.
    expect(grays(odd)).toEqual([10, 20, 30, 40, 50, 50]);
  });
  it('weights by alpha so transparent lines do not darken', async () => {
    const out = await deinterlace.apply(column([100, 0, 0], [255, 0, 0]), { remove: 'odd', fill: 'interpolate' }, ctx);
    expect(Array.from(out.data.slice(8, 12))).toEqual([100, 100, 100, 128]);
  });
  it('leaves single-line images alone and is registered under Filter > Video', async () => {
    const one = column([77]);
    expect(Array.from((await deinterlace.apply(one, defaults(deinterlace), ctx)).data)).toEqual(Array.from(one.data));
    expect(filterOp('deinterlace')?.category).toBe('Video');
    expect(allFilters.filter((f) => f.category === 'Video').map((f) => commandId(f.id))).toEqual(['filter.apply.deinterlace', 'filter.apply.broadcast-safe']);
  });
});

describe('Broadcast-Safe Colors', () => {
  const swatch = (colors: number[][]): RGBA8 => ({ width: colors.length, height: 1, data: new Uint8ClampedArray(colors.flatMap((c) => [...c, 255])) });
  const colors = [
    [255, 255, 0], // yellow: far above the limit in NTSC
    [0, 255, 255], // cyan
    [255, 0, 0], // red
    [0, 0, 255], // blue: below the lower limit
    [128, 128, 128], // gray: always legal
    [200, 150, 120], // skin tone: legal
  ];
  it('computes composite peaks of known colors', () => {
    const y = compositePeak('ntsc', 255, 255, 0);
    expect(y.high).toBeGreaterThan(130);
    expect(compositePeak('ntsc', 255, 255, 255).high).toBeCloseTo(100);
    expect(compositePeak('pal', 0, 0, 0).high).toBeCloseTo(0);
    expect(signalLimits('ntsc', 110).hi).toBeCloseTo(102.5 / 92.5);
  });
  for (const standard of ['ntsc', 'pal'])
    for (const method of ['saturation', 'luminance'])
      it(`brings every color within the ${standard} limit by reducing ${method}`, async () => {
        const src = swatch(colors);
        const out = await broadcastSafe.apply(src, { standard, method, max: 110 }, ctx);
        for (let i = 0; i < colors.length; i++) {
          const [r, g, b] = out.data.slice(i * 4, i * 4 + 3);
          const peak = compositePeak(standard, r, g, b);
          expect(peak.high).toBeLessThanOrEqual(110.01);
          expect(peak.low).toBeGreaterThanOrEqual(-20.01);
        }
        // Legal colors are untouched.
        expect(Array.from(out.data.slice(16, 24))).toEqual([128, 128, 128, 255, 200, 150, 120, 255]);
        const y = (k: number) => 0.299 * out.data[k] + 0.587 * out.data[k + 1] + 0.114 * out.data[k + 2];
        // Reducing saturation keeps yellow's brightness; reducing luminance darkens it.
        if (method === 'saturation') expect(Math.abs(y(0) - (0.299 * 255 + 0.587 * 255))).toBeLessThan(2);
        else expect(y(0)).toBeLessThan(0.299 * 255 + 0.587 * 255 - 5);
      });
  it('allows more with a higher limit', async () => {
    const lo = await broadcastSafe.apply(swatch([[255, 255, 0]]), { standard: 'ntsc', method: 'saturation', max: 100 }, ctx);
    const hi = await broadcastSafe.apply(swatch([[255, 255, 0]]), { standard: 'ntsc', method: 'saturation', max: 120 }, ctx);
    expect(lo.data[2]).toBeGreaterThan(hi.data[2]);
  });
});
