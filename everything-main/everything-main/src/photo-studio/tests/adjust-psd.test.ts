import { describe, expect, it } from 'vitest';
import { readPsd, writePsd, type Layer as PsdLayer } from 'ag-psd';
import { exportPsdAdjustment, importPsdAdjustment, exportGridMask } from '../src/model/psd-adjustments';
import { specAdjustment } from '../src/features/adjust/spec';
import { savePsd } from '../src/model/psd';
import { newDocument, layer, type AdjustmentSpec, type Layer } from '../src/model/document';
import { ADJUSTMENT_KINDS, isSpatialKind, BUILTIN_LOOKS, applyAdjustment, serializeCubeLut, bakeCubeLut, type Adjustment } from '../src/imaging/adjust';
import { sampleAdjustment, randomImage } from './adjust-fixtures';

const spec = (a: Adjustment): AdjustmentSpec => ({ kind: a.kind, params: a.params as unknown as Record<string, unknown> });

// Through ag-psd's binary writer and reader, like a real file.
function throughFile(adjustment: PsdLayer['adjustment'], extra: Partial<PsdLayer> = {}): PsdLayer {
  const w = 4,
    h = 4;
  const buffer = writePsd(
    { width: w, height: h, imageData: { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) }, children: [{ name: 'Adj', adjustment, ...extra }] },
    { noBackground: true },
  );
  return readPsd(new Uint8Array(buffer), { skipCompositeImageData: true, skipThumbnail: true, useImageData: true }).children![0];
}

// Rendering equivalence is what matters: compare exact CPU results.
function sameLook(a: Adjustment, b: Adjustment, tol = 1) {
  const img = randomImage(24, 16, 3);
  const x = applyAdjustment(img, a),
    y = applyAdjustment(img, b);
  let max = 0;
  for (let i = 0; i < x.data.length; i++) max = Math.max(max, Math.abs(x.data[i] - y.data[i]));
  expect(max, a.kind).toBeLessThanOrEqual(tol);
}

describe('PSD adjustment layers', () => {
  it('round-trip every kind through the PSD codec', () => {
    for (const kind of ADJUSTMENT_KINDS) {
      let adj = sampleAdjustment(kind);
      if (kind === 'color-lookup') adj = { kind, params: { source: { type: 'builtin', id: BUILTIN_LOOKS[1].id }, amount: 100 } };
      const out = exportPsdAdjustment(spec(adj));
      // Spatial kinds have no PSD record (they export as pixels).
      if (isSpatialKind(kind)) {
        expect(out, kind).toBeUndefined();
        continue;
      }
      expect(out, kind).toBeDefined();
      const back = importPsdAdjustment(throughFile(out));
      // Combined kinds travel as baked color tables.
      if (kind === 'light-tone' || kind === 'color-vibrance') {
        expect(back?.kind, kind).toBe('color-lookup');
        sameLook(adj, specAdjustment(back)!, 3);
        continue;
      }
      expect(back?.kind, kind).toBe(kind);
      // Built-in looks come back as an embedded 33-point table; others are exact
      // up to the integer fields PSD stores.
      sameLook(adj, specAdjustment(back)!, kind === 'color-lookup' ? 3 : kind === 'exposure' ? 1 : 2);
    }
  });
  it('keep hue/saturation colorize settings and custom ranges', () => {
    const a = specAdjustment({ kind: 'hue-saturation', params: { colorize: true, colorizeHue: 200, colorizeSaturation: 40, master: { hue: 0, saturation: 0, lightness: -20 } } })!;
    const back = specAdjustment(importPsdAdjustment(throughFile(exportPsdAdjustment(spec(a)))))!;
    expect(back.params).toMatchObject({ colorize: true, colorizeHue: 200, colorizeSaturation: 40, master: { lightness: -20 } });
    const b = specAdjustment({ kind: 'hue-saturation', params: {} })! as Extract<Adjustment, { kind: 'hue-saturation' }>;
    b.params.ranges.blues = { hue: 30, saturation: 10, lightness: 0, range: [200, 220, 240, 270] };
    const back2 = specAdjustment(importPsdAdjustment(throughFile(exportPsdAdjustment(spec(b))))) as typeof b;
    expect(back2.params.ranges.blues).toEqual(b.params.ranges.blues);
    expect(back2.params.colorize).toBe(false);
  });
  it('map PSD adjustment records written by other tools', () => {
    const levels = importPsdAdjustment({ adjustment: { type: 'levels', rgb: { shadowInput: 10, highlightInput: 240, shadowOutput: 5, highlightOutput: 250, midtoneInput: 1.2 } } })!;
    expect((levels.params as { rgb: unknown }).rgb).toEqual({ inBlack: 10, inWhite: 240, gamma: 1.2, outBlack: 5, outWhite: 250 });
    const bw = importPsdAdjustment({ adjustment: { type: 'black & white', reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, useTint: true, tintColor: { r: 225, g: 211, b: 179 } } })!;
    expect(bw.params).toMatchObject({ reds: 40, magentas: 80, tint: true });
    expect((bw.params as { tintHue: number }).tintHue).toBeGreaterThan(35);
    const pf = importPsdAdjustment({ adjustment: { type: 'photo filter', color: { l: 0.5, a: 0.1, b: 0.4 }, density: 30, preserveLuminosity: true } })!;
    const color = (pf.params as { color: number[] }).color;
    expect(color[0]).toBeGreaterThan(color[2]); // warm Lab color
    const curves = importPsdAdjustment({ adjustment: { type: 'curves', rgb: [{ input: 0, output: 20 }, { input: 128, output: 150 }, { input: 255, output: 255 }] } })!;
    expect((curves.params as { rgb: { points: number[][] } }).rgb.points).toEqual([[0, 20], [128, 150], [255, 255]]);
  });
  it('fall back for unsupported variants and 32-bit documents', () => {
    expect(importPsdAdjustment({ adjustment: { type: 'gradient map', gradientType: 'noise' } })).toBeUndefined();
    expect(importPsdAdjustment({ adjustment: { type: 'color lookup', lookupType: 'abstractProfile', profile: new Uint8Array(4) } })).toBeUndefined();
    expect(importPsdAdjustment({ adjustment: { type: 'color lookup', lutFormat: 'cube', lut3DFileData: new TextEncoder().encode('garbage') } })).toBeUndefined();
    expect(importPsdAdjustment({ adjustment: { type: 'invert' } }, 32)).toBeUndefined();
    expect(importPsdAdjustment({ adjustment: { type: 'invert' } }, 16)?.kind).toBe('invert');
    expect(importPsdAdjustment({ name: 'x' })).toBeUndefined();
  });
  it('keep embedded .cube tables verbatim', () => {
    const text = serializeCubeLut(bakeCubeLut((r, g, b, o) => ((o[0] = g), (o[1] = b), (o[2] = r)), 5, 'Rotate'));
    const out = exportPsdAdjustment({ kind: 'color-lookup', params: { source: { type: 'cube', name: 'Rotate', text }, amount: 100 } })!;
    const back = importPsdAdjustment(throughFile(out))!;
    expect((back.params as { source: { text: string; name: string } }).source).toEqual({ type: 'cube', name: 'Rotate', text });
  });
  it('export painted masks as PSD masks', async () => {
    const doc = { width: 6, height: 4 };
    const l = layer('adjustment', 'Levels 1', 6, 4);
    l.maskGrid = { channels: 1, x: 0, y: 0, tiles: {}, bounds: null };
    // A render stub: coverage 255 in columns 2..3, rows 1..2.
    const render = async (layers: Layer[]) => {
      expect(layers[0].maskGrid).toBe(l.maskGrid);
      const data = new Uint8ClampedArray(6 * 4 * 4);
      for (let y = 1; y <= 2; y++) for (let x = 2; x <= 3; x++) data[(y * 6 + x) * 4 + 3] = 255;
      return { width: 6, height: 4, data };
    };
    const m = (await exportGridMask(l, doc, render))!;
    expect([m.left, m.top, m.right, m.bottom, m.defaultColor]).toEqual([2, 1, 4, 3, 0]);
    expect(m.imageData!.data[0]).toBe(255);
    l.maskGrid = { ...l.maskGrid, fill: 255 };
    const all = (await exportGridMask(l, doc, async () => ({ width: 6, height: 4, data: new Uint8ClampedArray(96).fill(255) })))!;
    expect([all.right, all.defaultColor, all.imageData]).toEqual([0, 255, undefined]);
  });
  it('savePsd writes adjustment layers as real adjustment records', async () => {
    const doc = newDocument(4, 3);
    const base = layer('image', 'Background', 4, 3);
    base.asset = 'bg';
    const adj = layer('adjustment', 'Curves 1', 4, 3);
    adj.adjustment = spec(sampleAdjustment('curves'));
    adj.clipped = true;
    adj.opacity = 0.5;
    doc.layers = [base, adj];
    const blob = await savePsd(doc, async () => new Uint8Array(4 * 3 * 4).fill(200), async () => ({ width: 4, height: 3, data: new Uint8Array(48).fill(100) }));
    const psd = readPsd(new Uint8Array(await blob.arrayBuffer()), { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true });
    const out = psd.children![1];
    expect(out.name).toBe('Curves 1');
    expect(out.adjustment?.type).toBe('curves');
    expect(out.clipping).toBe(true);
    expect(out.opacity).toBeCloseTo(0.5, 2);
    expect(importPsdAdjustment(out)?.kind).toBe('curves');
  });
});
