// Performance targets for filter set A. Skipped by default because timings on
// a shared machine are noisy; run with FILTERS_PERF=1 to measure.
import { describe, expect, it } from 'vitest';
import { filtersA } from '../src/imaging/filters/index-a';
import { defaults, type ParamValues, type RGBA8 } from '../src/imaging/types';

function noise(w: number, h: number): RGBA8 {
  const d = new Uint8ClampedArray(w * h * 4);
  let s = 1;
  for (let i = 0; i < d.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    d[i] = s >>> 24;
  }
  for (let j = 3; j < d.length; j += 4) d[j] = 255;
  return { width: w, height: h, data: d };
}
async function time(id: string, src: RGBA8, params: ParamValues) {
  const op = filtersA.find((f) => f.id === id)!;
  const ctx = { foreground: [0, 0, 0] as [number, number, number], background: [255, 255, 255] as [number, number, number] };
  await op.apply(noise(256, 256), { ...defaults(op), ...params }, ctx); // warm up the JIT
  const t0 = performance.now();
  await op.apply(src, { ...defaults(op), ...params }, ctx);
  const ms = performance.now() - t0;
  console.log(`${id} ${src.width}x${src.height} ${JSON.stringify(params)}: ${ms.toFixed(0)} ms`);
  return ms;
}

describe.skipIf(!process.env.FILTERS_PERF)('filter set A performance', () => {
  it('meets the blur, sharpen and median targets', async () => {
    const big = noise(4000, 3000);
    expect(await time('gaussian-blur', big, { radius: 50 })).toBeLessThan(1500);
    expect(await time('unsharp-mask', big, { radius: 50, amount: 100 })).toBeLessThan(1500);
    expect(await time('median', noise(2000, 2000), { radius: 5 })).toBeLessThan(2000);
  }, 120000);
});
