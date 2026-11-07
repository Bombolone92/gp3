import { describe, expect, it } from 'vitest';
import { ADJUSTMENT_KINDS, applyAdjustment, DEFAULT_SHADOWS_HIGHLIGHTS, replaceColor, shadowsHighlights } from '../src/imaging/adjust';
import { rgba8 } from '../src/imaging/types';
import { rng, sampleAdjustment } from './adjust-fixtures';

// Timing on a 12-megapixel photo-like image. Opt-in (ADJUST_PERF=1) because
// shared CI machines make wall-clock limits flaky; the budget is ~600 ms.
const enabled = !!process.env.ADJUST_PERF;

function photoLike(w: number, h: number) {
  const img = rgba8(w, h);
  const r = rng(5);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4,
        n = (r() - 0.5) * 6;
      img.data[i] = (255 * x) / w + n;
      img.data[i + 1] = (255 * y) / h + n;
      img.data[i + 2] = 128 + 100 * Math.sin(x / 150) * Math.cos(y / 170) + n;
      img.data[i + 3] = 255;
    }
  return img;
}

describe.skipIf(!enabled)('adjustment performance (4000x3000)', () => {
  const img = enabled ? photoLike(4000, 3000) : rgba8(1, 1);
  for (const kind of ADJUSTMENT_KINDS)
    it(kind, () => {
      const adj = sampleAdjustment(kind);
      applyAdjustment(img, adj);
      const t = performance.now();
      applyAdjustment(img, adj);
      const ms = performance.now() - t;
      console.log(`${kind}: ${ms.toFixed(0)} ms`);
      expect(ms).toBeLessThan(Number(process.env.ADJUST_PERF_BUDGET ?? 1500));
    }, 30000);

  it('shadows/highlights and replace color', () => {
    let t = performance.now();
    shadowsHighlights(img, { ...DEFAULT_SHADOWS_HIGHLIGHTS, highlightsAmount: 30, highlightsRadius: 60 });
    const sh = performance.now() - t;
    t = performance.now();
    replaceColor(img, { color: [120, 90, 128], fuzziness: 60, hue: 30, saturation: 10, lightness: 0 });
    const rc = performance.now() - t;
    console.log(`shadows-highlights: ${sh.toFixed(0)} ms, replace-color: ${rc.toFixed(0)} ms`);
    expect(sh + rc).toBeLessThan(Number(process.env.ADJUST_PERF_BUDGET ?? 1500) * 4);
  }, 60000);
});
