// Timing benchmarks for the retouching and selection algorithms. Skipped by
// default; run with RETOUCH_BENCH=1 npx vitest run tests/retouch-bench.test.ts
import { describe, expect, it } from 'vitest';
import { contextFill, contextFillSmall } from '../src/imaging/retouch/context-fill';
import { heal, spotHeal, cropRGBA } from '../src/imaging/retouch/heal';
import { redEye } from '../src/imaging/retouch/red-eye';
import { colorRange, magicWand } from '../src/imaging/segment/color-select';
import { QuickSelector } from '../src/imaging/segment/quick-select';
import { removeBackground, selectSky, selectSubject } from '../src/imaging/segment/subject';
import { refineEdge } from '../src/imaging/segment/refine';
import { LiveWire } from '../src/imaging/segment/live-wire';
import { expand, feather, maskToOutline, rasterizeEllipse } from '../src/imaging/segment/mask-ops';
import { disk, photoLike } from './retouch-fixtures';

const enabled = !!process.env.RETOUCH_BENCH;
const runs = Number(process.env.RETOUCH_BENCH_RUNS || 5);

function bench(name: string, fn: () => unknown, n = runs) {
  fn(); // warm up the JIT
  const ts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    fn();
    ts.push(performance.now() - t);
  }
  ts.sort((a, b) => a - b);
  process.stderr.write(`[bench] ${name}: median ${ts[n >> 1].toFixed(1)} ms, best ${ts[0].toFixed(1)} ms\n`);
}

describe.skipIf(!enabled)('benchmarks (2000x1500 unless noted)', () => {
  const W = 2000, H = 1500, img = photoLike(W, H), subj = disk(W, H, 1000, 760, 420, [205, 120, 80], [60, 95, 140], 22);
  it('retouching', () => {
    const hole = rasterizeEllipse(1000, 700, 100, 100, W, H);
    bench('contextFill 200x200 hole', () => contextFill(img, hole, { seed: 1 }), 3);
    bench('contextFill 200x200 hole, mirror+scale', () => contextFill(img, hole, { seed: 1, mirror: true, scale: true }), 3);
    const big = rasterizeEllipse(1000, 700, 200, 200, W, H);
    bench('contextFill 400x400 hole', () => contextFill(img, big, { seed: 1 }), 2);
    for (const d of [20, 60, 100]) {
      const dab = rasterizeEllipse(600, 500, d / 2, d / 2, W, H);
      bench(`contextFillSmall ${d} px dab`, () => contextFillSmall(img, dab, { seed: 1 }));
      bench(`spotHeal proximity ${d} px dab`, () => spotHeal(img, dab, 'proximity'));
      bench(`spotHeal texture ${d} px dab`, () => spotHeal(img, dab, 'texture'));
    }
    for (const d of [50, 150, 300]) {
      const patch = cropRGBA(img, { x: 100, y: 100, width: d + 2, height: d + 2 }), m = rasterizeEllipse(d / 2 + 1, d / 2 + 1, d / 2, d / 2, d + 2, d + 2);
      bench(`heal ${d} px patch (in place)`, () => heal(img, patch, m, { x: 900, y: 600 }, { inPlace: false }));
    }
    bench('redEye (point)', () => redEye(img, { x: 1000, y: 700 }));
    expect(true).toBe(true);
  }, 900000);
  it('selection', () => {
    bench('magicWand contiguous tol 32', () => magicWand(img, 1000, 750, 32));
    bench('magicWand global tol 32', () => magicWand(img, 1000, 750, 32, { contiguous: false }));
    bench('colorRange sampled', () => colorRange(img, [[120, 150, 160]], 40));
    bench('colorRange skin', () => colorRange(img, [], 40, { range: 'skin' }));
    const qs = new QuickSelector(subj);
    bench('QuickSelector setup', () => new QuickSelector(subj));
    bench('quickSelect stroke update', () => qs.update([{ points: [[900, 700], [1100, 760]], positive: true }], undefined, 40));
    const first = qs.update([{ points: [[900, 700], [1100, 760]], positive: true }], undefined, 40);
    bench('quickSelect second stroke (subtract)', () => qs.update([{ points: [[1000, 760]], positive: false }], first, 40));
    bench('selectSubject', () => selectSubject(subj), 3);
    bench('removeBackground', () => removeBackground(subj), 3);
    bench('selectSky', () => selectSky(img), 3);
    const m = selectSubject(subj);
    bench('refineEdge radius 8', () => refineEdge(subj, m, { radius: 8 }), 3);
    bench('refineEdge radius 8 + decontaminate', () => refineEdge(subj, m, { radius: 8, decontaminate: 1 }), 3);
    bench('feather 10', () => feather(m, 10));
    bench('expand 10 (EDT)', () => expand(m, 10));
    bench('maskToOutline (disk)', () => maskToOutline(m));
    bench('LiveWire constructor', () => new LiveWire(img));
    {
      const fresh = new LiveWire(img), t = performance.now();
      fresh.setSeed(1000, 750);
      fresh.pathTo(1150, 760);
      process.stderr.write(`[bench] LiveWire first pathTo 150 px incl. tile setup: ${(performance.now() - t).toFixed(1)} ms\n`);
    }
    const lw = new LiveWire(img);
    bench('LiveWire pathTo 150 px on texture (fresh seed)', () => {
      lw.setSeed(1000, 750);
      lw.pathTo(1150, 760);
    });
    bench('LiveWire pathTo 300 px on texture (fresh seed)', () => {
      lw.setSeed(1000, 750);
      lw.pathTo(1300, 800);
    });
    {
      lw.setSeed(1000, 750);
      let worst = 0, total = 0, k = 0;
      for (let d = 5; d <= 200; d += 5, k++) {
        const t = performance.now();
        lw.pathTo(1000 + d, 750 + d * 0.3);
        const e = performance.now() - t;
        worst = Math.max(worst, e);
        total += e;
      }
      process.stderr.write(`[bench] LiveWire incremental mouse moves (5 px steps to 200 px): mean ${(total / k).toFixed(2)} ms, worst ${worst.toFixed(1)} ms\n`);
    }
    expect(true).toBe(true);
  }, 900000);
});
