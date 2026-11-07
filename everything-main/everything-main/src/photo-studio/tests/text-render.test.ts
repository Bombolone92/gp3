import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rgba8 } from '../src/imaging/types';
import { BUNDLED_FONTS, bundledFace, bundledFontUrl, fontFamilies, setFontBaseUrl, weightFromStyleName } from '../src/imaging/text/fonts';
import type { Measure } from '../src/imaging/text/layout';
import { applyCharStyle, defaultCharStyle, fromPlainText, type TextLayerData } from '../src/imaging/text/model';
import { antiAliasCurve, applyAntiAlias, cropToAlpha, renderText } from '../src/imaging/text/render';

const sizeOf = (font: string) => Number(/([\d.]+)px/.exec(font)![1]);
const mono: Measure = (text, font) => ({ width: [...text.replace(/‌/g, '')].length * sizeOf(font) * 0.5, ascent: sizeOf(font) * 0.8, descent: sizeOf(font) * 0.2 });

// A minimal OffscreenCanvas whose fillText paints each glyph as a solid box
// from the baseline up to 0.7 em, so coordinate plumbing can be checked in Node.
class FakeCtx {
  font = '10px x';
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  lineJoin = 'miter';
  textBaseline = 'alphabetic';
  textAlign = 'left';
  letterSpacing = '0px';
  fontKerning = 'normal';
  private m = [1, 0, 0, 1, 0, 0];
  private stack: number[][] = [];
  data: Uint8ClampedArray;
  calls: string[] = [];
  constructor(public w: number, public h: number) { this.data = new Uint8ClampedArray(w * h * 4); }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { this.m = [a, b, c, d, e, f]; }
  save() { this.stack.push([...this.m]); }
  restore() { this.m = this.stack.pop()!; }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    const [A, B, C, D, E, F] = this.m;
    this.m = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
  }
  translate(x: number, y: number) { this.transform(1, 0, 0, 1, x, y); }
  scale(x: number, y: number) { this.transform(x, 0, 0, y, 0, 0); }
  private rgb() { const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(this.fillStyle); return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0]; }
  private box(x0: number, y0: number, x1: number, y1: number) {
    const [a, , , d, e, f] = this.m;
    const X0 = Math.round(a * x0 + e), X1 = Math.round(a * x1 + e), Y0 = Math.round(d * y0 + f), Y1 = Math.round(d * y1 + f);
    const c = this.rgb();
    for (let y = Math.max(0, Math.min(Y0, Y1)); y < Math.min(this.h, Math.max(Y0, Y1)); y++)
      for (let x = Math.max(0, Math.min(X0, X1)); x < Math.min(this.w, Math.max(X0, X1)); x++) this.data.set([c[0], c[1], c[2], 255], (y * this.w + x) * 4);
  }
  fillText(t: string, x: number, y: number) {
    this.calls.push(`fill:${t}`);
    const s = sizeOf(this.font);
    const n = [...t.replace(/‌/g, '')].length;
    this.box(x, y - 0.7 * s, x + n * s * 0.5, y);
  }
  strokeText(t: string) { this.calls.push(`stroke:${t}`); }
  fillRect(x: number, y: number, w: number, h: number) { this.calls.push('rect'); this.box(x, y, x + w, y + h); }
  measureText(t: string) { return { width: mono(t, this.font, true).width, fontBoundingBoxAscent: sizeOf(this.font) * 0.8, fontBoundingBoxDescent: sizeOf(this.font) * 0.2 }; }
  getImageData(x: number, y: number, w: number, h: number) { void x; void y; return { width: w, height: h, data: this.data.slice(0, w * h * 4) }; }
}
let lastCtx: FakeCtx;
class FakeOffscreen {
  constructor(public width: number, public height: number) {}
  getContext() { return (lastCtx = new FakeCtx(this.width, this.height)); }
}
const g = globalThis as { OffscreenCanvas?: unknown };
let saved: unknown;
beforeAll(() => { saved = g.OffscreenCanvas; g.OffscreenCanvas = FakeOffscreen; });
afterAll(() => { g.OffscreenCanvas = saved; });

const layer = (text: string, patch = {}): TextLayerData => ({
  content: fromPlainText(text, { ...defaultCharStyle(), size: 20, color: [10, 20, 30], ...patch }),
  mode: 'point', origin: { x: 100, y: 50 }, orientation: 'horizontal', antiAlias: 'smooth',
});

describe('renderText', () => {
  it('places pixels at document coordinates and crops to the ink', () => {
    const r = renderText(layer('ab'), { measure: mono });
    // Glyph boxes: x 100..120, y 36..50 in document space.
    expect(r.x).toBeCloseTo(100, 6);
    expect(r.y).toBeCloseTo(36, 6);
    expect([r.image.width, r.image.height]).toEqual([20, 14]);
    expect(Array.from(r.image.data.slice(0, 4))).toEqual([10, 20, 30, 255]);
  });
  it('honours the preview scale', () => {
    const r = renderText(layer('ab'), { measure: mono, scale: 0.5 });
    expect(r.x).toBeCloseTo(100, 6);
    expect([r.image.width, r.image.height]).toEqual([10, 7]);
    expect(r.scale).toBe(0.5);
  });
  it('draws faux bold strokes and decorations', () => {
    const r = renderText(layer('ab', { fauxBold: true, underline: true }), { measure: mono });
    expect(lastCtx.calls).toContain('stroke:ab');
    expect(lastCtx.calls).toContain('rect');
    // The underline sits below the baseline, extending the image downward.
    expect(r.y + r.image.height).toBeGreaterThan(50);
  });
  it('draws clusters apart when ligatures are off', () => {
    renderText(layer('fi'), { measure: mono });
    expect(lastCtx.calls).toContain('fill:fi');
    renderText({ ...layer('fi'), content: applyCharStyle(fromPlainText('fi', defaultCharStyle()), 0, 2, { ligatures: false }) }, { measure: mono });
    expect(lastCtx.calls).toContain('fill:f‌i');
  });
  it('returns an empty image for empty text', () => {
    const r = renderText(layer(''), { measure: mono });
    expect(r.image.width * r.image.height).toBe(0);
  });
  it('applies warps around the text bounds', () => {
    const flat = renderText(layer('abcdefgh'), { measure: mono });
    const bent = renderText({ ...layer('abcdefgh'), warp: { style: 'arc', bend: 60, horizontal: 0, vertical: 0, axis: 'horizontal' } }, { measure: mono });
    expect(bent.image.height).toBeGreaterThan(flat.image.height + 5);
  });
});

describe('anti-aliasing curves', () => {
  it('none thresholds, smooth is the identity, sharp is steeper than crisp', () => {
    const none = antiAliasCurve('none');
    expect([none[0], none[127], none[128], none[255]]).toEqual([0, 0, 255, 255]);
    const img = rgba8(1, 1, [0, 0, 0, 77]);
    applyAntiAlias(img, 'smooth');
    expect(img.data[3]).toBe(77);
    const sharp = antiAliasCurve('sharp'), crisp = antiAliasCurve('crisp'), strong = antiAliasCurve('strong');
    expect(sharp[60]).toBeLessThan(crisp[60]);
    expect(sharp[200]).toBeGreaterThan(crisp[200]);
    expect(strong[100]).toBeGreaterThan(100);
    for (const lut of [sharp, crisp, strong]) {
      expect(lut[0]).toBe(0);
      expect(lut[255]).toBe(255);
      for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    }
  });
  it('crops to the alpha bounds', () => {
    const img = rgba8(5, 4);
    img.data[(2 * 5 + 1) * 4 + 3] = 9;
    img.data[(3 * 5 + 3) * 4 + 3] = 9;
    const c = cropToAlpha(img)!;
    expect([c.x, c.y, c.image.width, c.image.height]).toEqual([1, 2, 3, 2]);
    expect(cropToAlpha(rgba8(3, 3))).toBeUndefined();
  });
});

describe('bundled fonts', () => {
  const dir = join(__dirname, '..', 'public', 'fonts');
  it('ships every listed face as WOFF2 and WOFF with its OFL license', () => {
    let total = 0;
    for (const f of BUNDLED_FONTS) {
      const license = readFileSync(join(dir, f.dir, 'OFL.txt'), 'utf8');
      expect(license).toContain('SIL Open Font License, Version 1.1');
      expect(license.split('\n')[0]).not.toMatch(/Reserved Font Name/);
      for (const face of f.faces)
        for (const ext of ['woff2', 'woff']) {
          const p = join(dir, f.dir, `${face.file}.${ext}`);
          const head = readFileSync(p).subarray(0, 4).toString('latin1');
          expect(head).toBe(ext === 'woff2' ? 'wOF2' : 'wOFF');
          total += statSync(p).size;
        }
    }
    expect(total).toBeLessThan(2 * 1024 * 1024);
    // Nothing unlisted ships in public/fonts.
    for (const d of readdirSync(dir)) expect(BUNDLED_FONTS.some((f) => f.dir === d)).toBe(true);
  });
  it('builds URLs and picks faces', () => {
    setFontBaseUrl('https://example.test/app');
    const hit = bundledFace('caveat', true)!;
    expect(hit.face.italic).toBe(false); // no italic: falls back to upright (synthesized)
    expect(bundledFontUrl(hit.font, hit.face)).toBe('https://example.test/app/fonts/caveat/Caveat-Variable.woff2');
    expect(bundledFace('Inter', true)!.face.file).toBe('Inter-Italic-Variable');
  });
  it('maps style names to weights and lists bundled families first', async () => {
    expect(weightFromStyleName('SemiBold Italic')).toBe(600);
    expect(weightFromStyleName('Extra Light')).toBe(200);
    expect(weightFromStyleName('Bold')).toBe(700);
    expect(weightFromStyleName('Regular')).toBe(400);
    const fams = await fontFamilies();
    expect(fams.slice(0, 5).map((f) => f.family)).toEqual(BUNDLED_FONTS.map((f) => f.family));
    expect(fams[0]).toMatchObject({ weightRange: [100, 900], italic: true, source: 'bundled' });
    expect(fams.find((f) => f.family === 'Bebas Neue')!.weights).toEqual([400]);
  });
});
