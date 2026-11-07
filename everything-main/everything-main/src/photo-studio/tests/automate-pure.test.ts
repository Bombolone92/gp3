import { describe, expect, it } from 'vitest';
import { extractPhoto, findPhotos, minAreaRect, convexHull } from '../src/imaging/photos/split';
import { trap } from '../src/imaging/print/trap';
import { fitBox, fitWithin, sheetCells, sheetPages } from '../src/imaging/print/layout';
import { pdfTextString, writePdf } from '../src/imaging/codecs/pdf';
import { SKY_PRESETS, adjustSky, foregroundLightMask, placeSky, renderSky, skyHorizon, skyLight, skyMaskEdge } from '../src/imaging/sky/sky';
import { mask8, rgba8 } from '../src/imaging/types';
import { scene } from './stitch-fixtures';

/** White scan with photos rotated by the given angles. */
function scan(photos: { cx: number; cy: number; w: number; h: number; deg: number }[]) {
  const W = 600,
    H = 420;
  const img = rgba8(W, H, [250, 250, 248, 255]);
  const tex = scene(200, 200, 12);
  for (const p of photos) {
    const a = (p.deg * Math.PI) / 180,
      cos = Math.cos(a),
      sin = Math.sin(a);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - p.cx,
          dy = y + 0.5 - p.cy;
        const u = dx * cos + dy * sin,
          v = -dx * sin + dy * cos;
        if (Math.abs(u) > p.w / 2 || Math.abs(v) > p.h / 2) continue;
        const tx = Math.floor(((u + p.w / 2) / p.w) * 199),
          ty = Math.floor(((v + p.h / 2) / p.h) * 199);
        const o = (y * W + x) * 4,
          s = (ty * 200 + tx) * 4;
        img.data.set([tex.data[s] * 0.8, tex.data[s + 1] * 0.8, tex.data[s + 2] * 0.8, 255], o);
      }
  }
  return img;
}

describe('Crop and Straighten Photos', () => {
  it('finds rotated photos with their size and angle', () => {
    const img = scan([
      { cx: 150, cy: 140, w: 200, h: 140, deg: 8 },
      { cx: 430, cy: 280, w: 180, h: 220, deg: -5 },
    ]);
    const found = findPhotos(img);
    expect(found.length).toBe(2);
    expect(found[0].angle).toBeCloseTo(8, 0);
    expect(Math.abs(found[0].width - 200)).toBeLessThan(6);
    expect(Math.abs(found[0].height - 140)).toBeLessThan(6);
    expect(found[1].angle).toBeCloseTo(-5, 0);
    expect(Math.abs(found[1].width - 180)).toBeLessThan(6);
    const cut = extractPhoto(img, found[0]);
    expect(cut.width).toBe(found[0].width);
    // The upright crop contains photo pixels, not background, at its center.
    const o = ((cut.height >> 1) * cut.width + (cut.width >> 1)) * 4;
    expect(cut.data[o] + cut.data[o + 1] + cut.data[o + 2]).toBeLessThan(700);
  });

  it('computes minimum-area rectangles', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 0, y: 4 },
      { x: 5, y: 2 },
    ];
    const r = minAreaRect(convexHull(pts));
    expect(r.width * r.height).toBeCloseTo(40, 6);
    expect(r.angle).toBeCloseTo(0, 6);
  });
});

describe('Trap', () => {
  it('spreads the lighter color into the darker side only', () => {
    const img = rgba8(20, 4);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 20; x++) img.data.set(x < 10 ? [255, 230, 0, 255] : [0, 60, 160, 255], (y * 20 + x) * 4);
    const out = trap(img, 2);
    const at = (x: number) => Array.from(out.data.slice((20 + x) * 4, (20 + x) * 4 + 4));
    expect(at(9)).toEqual([255, 230, 0, 255]);
    expect(at(10)).toEqual([0, 60, 0, 255]);
    expect(at(11)).toEqual([0, 60, 0, 255]);
    expect(at(12)).toEqual([0, 60, 160, 255]);
  });
});

describe('sheet layout', () => {
  it('lays images out in cells with captions across pages', () => {
    const layout = { pageWidth: 600, pageHeight: 800, columns: 2, rows: 3, margin: 20, spacing: 10, caption: 20 };
    const cells = sheetCells(layout, Array.from({ length: 7 }, () => ({ width: 400, height: 300 })));
    expect(sheetPages(layout, 7)).toBe(2);
    expect(cells[6].page).toBe(1);
    expect(cells[1].cell.x).toBeCloseTo(20 + 275 + 10, 6);
    for (const c of cells) {
      expect(c.image.width / c.image.height).toBeCloseTo(4 / 3, 6);
      expect(c.image.y + c.image.height).toBeLessThanOrEqual(c.caption!.y + 1e-6);
    }
    expect(fitBox(100, 50, { x: 0, y: 0, width: 50, height: 50 })).toEqual({ x: 0, y: 12.5, width: 50, height: 25 });
    expect(fitWithin(4000, 3000, 1920, 1920, false)).toEqual([1920, 1440]);
    expect(fitWithin(400, 300, 1920, 1920, false)).toEqual([400, 300]);
    expect(fitWithin(400, 300, 1920, 1920, true)).toEqual([1920, 1440]);
  });
});

describe('PDF writer', () => {
  it('writes a structurally valid document with a correct cross-reference table', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const bytes = writePdf([
      { width: 612, height: 792, background: [0, 0, 0], images: [{ x: 10, y: 10, width: 100, height: 80, image: { kind: 'jpeg', bytes: jpeg, width: 4, height: 3 } }], texts: [{ x: 300, y: 700, size: 12, text: 'Café (1)', align: 'center' }] },
      { width: 300, height: 300, images: [{ x: 0, y: 0, width: 300, height: 300, image: { kind: 'samples', bytes: new Uint8Array(12), width: 2, height: 2 } }] },
    ], { title: 'Test' });
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    entries.forEach((off, i) => expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(text).toContain('/Count 2');
    expect(text).toContain('/Filter /DCTDecode');
    expect(pdfTextString('a(b)\\')).toBe('(a\\(b\\)\\\\)');
    expect(pdfTextString('é')).toBe('(\\351)');
  });
});

describe('sky replacement', () => {
  it('renders deterministic skies and places them over the canvas', () => {
    const a = renderSky(SKY_PRESETS[1], 160, 90, 3),
      b = renderSky(SKY_PRESETS[1], 160, 90, 3);
    expect(a.data).toEqual(b.data);
    // The zenith is darker than the horizon for a clear sky.
    const clear = renderSky(SKY_PRESETS[0], 40, 40);
    expect(clear.data[2 * 4 + 2] + clear.data[2 * 4]).toBeLessThan(clear.data[(39 * 40 + 2) * 4] + clear.data[(39 * 40 + 2) * 4 + 2]);
    const placed = placeSky(a, 200, 150, { scale: 1, flip: true, offsetX: 0, offsetY: 0 }, 80);
    expect(placed.width).toBe(200);
    expect(placed.data[3]).toBe(255);
    const warm = adjustSky(a, 0, 100);
    expect(warm.data[0]).toBeGreaterThanOrEqual(a.data[0]);
    expect(warm.data[2]).toBeLessThanOrEqual(a.data[2]);
  });

  it('shifts and fades the sky mask edge and finds the horizon', () => {
    const m = mask8(40, 40);
    for (let i = 0; i < 40 * 20; i++) m.data[i] = 255;
    expect(skyHorizon(m)).toBe(20);
    const grown = skyMaskEdge(m, 3, 0);
    expect(grown.data[22 * 40 + 5]).toBe(255);
    const faded = skyMaskEdge(m, 0, 6);
    expect(faded.data[20 * 40 + 5]).toBeGreaterThan(0);
    expect(faded.data[20 * 40 + 5]).toBeLessThan(255);
    const sky = rgba8(40, 40, [200, 100, 50, 255]);
    expect(skyLight(sky, m, 20).map(Math.round)).toEqual([200, 100, 50]);
    const fg = foregroundLightMask(m, 20);
    expect(fg.data[5]).toBe(0);
    expect(fg.data[21 * 40]).toBeGreaterThan(fg.data[39 * 40]);
  });
});
