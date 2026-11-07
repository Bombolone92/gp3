import { describe, expect, it } from 'vitest';
import { filtersA } from '../src/imaging/filters/index-a';
import { filtersB } from '../src/imaging/filters/index-b';
import { menuSkeleton } from '../src/app/menus';
import {
  GALLERY_ID,
  allFilters,
  categorySlug,
  commandId,
  filterMargin,
  filterOp,
  galleryEffects,
  galleryGroups,
  normalizeFor,
  normalizeParams,
  opIdFromCommand,
  renamedFilters,
  stackMargin,
} from '../src/features/filters/catalog';
import { defaults, type Mask8, type RGBA8 } from '../src/imaging/types';
import { runOperation } from '../src/features/filters/stack';

const ctx = { foreground: [0, 0, 0] as [number, number, number], background: [255, 255, 255] as [number, number, number], seed: 7 };

function noise(w: number, h: number, seed = 1): RGBA8 {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    data[i] = i % 4 === 3 ? 255 : (s >>> 16) & 255;
  }
  return { width: w, height: h, data };
}

describe('filter catalog', () => {
  it('has unique operation IDs across both libraries', () => {
    const ids = [...filtersA, ...filtersB].map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allFilters.length).toBe(ids.length);
    expect(ids).not.toContain(GALLERY_ID);
  });
  it('maps every operation to a unique command in an existing Filter submenu', () => {
    const filter = menuSkeleton.find((m) => m.id === 'filter')!;
    const submenus = new Set(filter.items.flatMap((i) => (typeof i === 'object' ? [i.id] : [])));
    const topLevel = new Set(filter.items.filter((i): i is string => typeof i === 'string'));
    const cmds = new Set<string>();
    for (const op of allFilters) {
      const id = commandId(op.id);
      expect(cmds.has(id)).toBe(false);
      cmds.add(id);
      expect(opIdFromCommand(id)).toBe(op.id);
      // Command IDs must not shadow submenu IDs such as filter.blur.
      expect(submenus.has(id)).toBe(false);
      if (op.id === 'develop' || op.id === 'lens-correction') expect(topLevel.has(id)).toBe(true);
      else expect(submenus.has(`filter.${categorySlug(op.category)}`)).toBe(true);
    }
    expect(topLevel.has(commandId(GALLERY_ID))).toBe(true);
    expect(opIdFromCommand('filter.gallery')).toBe(GALLERY_ID);
    expect(opIdFromCommand('filter.nope')).toBeUndefined();
  });
  it('normalizes recorded parameters: clamps, rejects wrong types and fills defaults', () => {
    const op = allFilters.find((o) => o.id === 'radial-blur')!;
    const p = normalizeParams(op.params, { amount: 1e9, method: 'bogus', center: { x: 2, y: -1 }, quality: 3, extra: 1 });
    expect(p.amount).toBe(100);
    expect(p.method).toBe('spin');
    expect(p.center).toEqual({ x: 1, y: 0 });
    expect(p.quality).toBe('good');
    expect('extra' in p).toBe(false);
    const light = allFilters.find((o) => o.id === 'lighting-effects')!;
    expect(normalizeParams(light.params, { color: 'red' }).color).toBe('#ffffff');
    expect(normalizeParams(light.params, { color: '#AbCdEf' }).color).toBe('#abcdef');
    expect(normalizeParams(light.params, { intensity: Number.NaN }).intensity).toBe(100);
    const noiseOp = allFilters.find((o) => o.id === 'add-noise')!;
    expect(normalizeParams(noiseOp.params, { mono: 'yes' }).mono).toBe(false);
  });
  it('keeps only known gallery effects and normalizes their settings', () => {
    const fx = galleryEffects({ effects: [{ id: 'mosaic', params: { cellSize: 1 } }, { id: 'nope', params: {} }, { id: 'twirl', params: {}, enabled: false }] } as never);
    expect(fx.map((x) => x.id)).toEqual(['mosaic', 'twirl']);
    expect(fx[0].params.cellSize).toBe(2);
    expect(fx[1].enabled).toBe(false);
    expect(galleryEffects({} as never)).toEqual([]);
    expect(normalizeFor(GALLERY_ID, { effects: 'x' })).toEqual({ effects: [] });
    for (const g of galleryGroups) for (const id of g.ids) expect(allFilters.some((o) => o.id === id)).toBe(true);
  });
  it('adds stack margins and treats any global filter as global', () => {
    const g = { id: 'gaussian-blur', params: { radius: 4 } };
    const m = filterMargin('gaussian-blur', { radius: 4 })!;
    expect(stackMargin([g, g])).toBe(2 * m);
    expect(stackMargin([g, { id: 'twirl', params: { angle: 50 } }])).toBeUndefined();
    expect(stackMargin([g, { id: 'twirl', params: {}, enabled: false }])).toBe(m);
    expect(stackMargin([{ id: GALLERY_ID, params: { effects: [{ id: 'median', params: { radius: 2 } }] } as never }])).toBe(filterMargin('median', { radius: 2 }));
    expect(filterMargin('gaussian-blur', { radius: 10 }, 0.5)!).toBeLessThan(filterMargin('gaussian-blur', { radius: 10 })!);
  });
  // A margin smaller than a filter's real reach would make selection-limited
  // processing differ from processing the whole canvas.
  it('declares margins at least as large as each local filter reaches', async () => {
    const W = 64,
      H = 64;
    const base = noise(W, H, 3);
    const sel: Mask8 = { width: W, height: H, data: new Uint8Array(W * H) };
    const x0 = 28,
      y0 = 28;
    for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) sel.data[y * W + x] = 255;
    for (const op of allFilters) {
      const params = defaults(op);
      if (op.id === 'gaussian-blur' || op.id === 'unsharp-mask' || op.id === 'high-pass') params.radius = 3;
      const m = filterMargin(op.id, params);
      if (m === undefined) continue;
      const full = await runOperation(op.id, base, params, { ...ctx, selection: sel });
      // Process only the selection bounds grown by the margin, then compare.
      const cx = Math.max(0, x0 - m),
        cy = Math.max(0, y0 - m),
        cw = Math.min(W, x0 + 8 + m) - cx,
        ch = Math.min(H, y0 + 8 + m) - cy;
      const crop: RGBA8 = { width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) };
      const csel: Mask8 = { width: cw, height: ch, data: new Uint8Array(cw * ch) };
      for (let y = 0; y < ch; y++) {
        crop.data.set(base.data.subarray(((cy + y) * W + cx) * 4, ((cy + y) * W + cx + cw) * 4), y * cw * 4);
        csel.data.set(sel.data.subarray((cy + y) * W + cx, (cy + y) * W + cx + cw), y * cw);
      }
      const part = await runOperation(op.id, crop, params, { ...ctx, selection: csel });
      let maxDiff = 0;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++)
          for (let c = 0; c < 4; c++) {
            const a = full.data[((y0 + y) * W + x0 + x) * 4 + c],
              b = part.data[((y0 - cy + y) * cw + x0 - cx + x) * 4 + c];
            maxDiff = Math.max(maxDiff, Math.abs(a - b));
          }
      // Surface Blur's own selection crop shows the same small region dependence.
      expect(maxDiff, op.id).toBeLessThanOrEqual(op.id === 'surface-blur' ? 3 : 1);
    }
  });
});

describe('renamed filter IDs', () => {
  it('resolve to the current operation and margin', () => {
    for (const [from, to] of Object.entries(renamedFilters)) {
      expect(filterOp(from)).toBe(filterOp(to));
      expect(filterOp(to)?.id).toBe(to);
      expect(filterMargin(from, { radius: 2 })).toBe(filterMargin(to, { radius: 2 }));
    }
  });
});
