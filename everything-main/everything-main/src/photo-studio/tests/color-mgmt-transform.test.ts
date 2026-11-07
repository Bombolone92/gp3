import { describe, expect, it } from 'vitest';
import { builtinProfile } from '../src/color/builtin-profiles';
import { decodeLab } from '../src/color/color-math';
import { deltaE2000 } from '../src/color/delta-e';
import { createProofTransform, gamutWarning } from '../src/color/proof';
import {
  bakeLut3D,
  bakeShaperTables,
  cmykToRGBA8,
  createTransform,
  sampleLut3D,
  transformRGBA8,
  transformToCMYK,
  type ColorTransform,
} from '../src/color/transform';
import type { RGBA8 } from '../src/imaging/types';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randomImage = (w: number, h: number, seed = 1): RGBA8 => {
  const r = rng(seed);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(r() * 256);
  return { width: w, height: h, data };
};

const srgb = builtinProfile('srgb');
const lab = builtinProfile('lab-d50');
const coated = builtinProfile('generic-coated-cmyk');
const toLab = createTransform(srgb, lab);
const labOf = (rgb: ArrayLike<number>) => decodeLab(toLab.one(rgb), 'v4');

describe('3D LUT baking', { timeout: 120000 }, () => {
  it('bakes a 33^3 LUT that matches the direct transform (mean ΔE00 < 0.5)', () => {
    const cases: [string, ColorTransform][] = [
      ['proof', createProofTransform(srgb, coated, srgb).transform],
      ['p3', createTransform(srgb, builtinProfile('display-p3'))],
      ['romm', createTransform(builtinProfile('romm-rgb'), srgb, 'perceptual')],
    ];
    for (const [name, t] of cases) {
      const lut = bakeLut3D(t);
      expect(lut.data.length).toBe(33 ** 3 * 4);
      const r = rng(5);
      const errs: number[] = [];
      const out = [0, 0, 0, 0];
      const outLab = name === 'p3' ? createTransform(builtinProfile('display-p3'), lab) : toLab;
      for (let i = 0; i < 2000; i++) {
        const rgb = [r(), r(), r()];
        sampleLut3D(lut, rgb[0], rgb[1], rgb[2], out);
        const direct = t.one(rgb);
        errs.push(deltaE2000(decodeLab(outLab.one(direct), 'v4'), decodeLab(outLab.one(out.slice(0, 3)), 'v4')));
      }
      const mean = errs.reduce((a, b) => a + b) / errs.length;
      console.log(`${name}: LUT vs direct mean ΔE00 ${mean.toFixed(3)} max ${Math.max(...errs).toFixed(3)}`);
      expect(mean).toBeLessThan(0.5);
      // Grid nodes are exact.
      sampleLut3D(lut, 0.5, 0.25, 0.75, out);
      t.one([0.5, 0.25, 0.75]).forEach((v, c) => expect(out[c]).toBeCloseTo(v, 5));
    }
  });

  it('bakes 33^3 quickly and converts 12 megapixels through a LUT', () => {
    const t = createTransform(srgb, coated, 'relative', { bpc: true });
    bakeLut3D(t); // warm up
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      bakeLut3D(createTransform(srgb, coated, 'relative', { bpc: true }));
      best = Math.min(best, performance.now() - t0);
    }
    console.log(`33^3 bake sRGB->CMYK: ${best.toFixed(1)} ms`);
    expect(best).toBeLessThan(1000);
    const proof = createProofTransform(srgb, coated, srgb).lut;
    const img = randomImage(4000, 3000, 2);
    transformRGBA8(randomImage(64, 64), proof);
    const t0 = performance.now();
    const out = transformRGBA8(img, proof);
    const ms = performance.now() - t0;
    console.log(`transformRGBA8 4000x3000 via LUT: ${ms.toFixed(0)} ms`);
    expect(out.data.length).toBe(img.data.length);
    // About 0.6 s on an idle machine; generous bound for loaded CI hosts.
    expect(ms).toBeLessThan(15000);
    const t1 = performance.now();
    transformRGBA8(img, createTransform(srgb, builtinProfile('display-p3')));
    console.log(`transformRGBA8 4000x3000 via shaper tables: ${(performance.now() - t1).toFixed(0)} ms`);
  });
});

describe('whole-image conversion', { timeout: 120000 }, () => {
  it('uses exact shaper tables between matrix/TRC profiles', () => {
    const t = createTransform(srgb, builtinProfile('display-p3'));
    const tables = bakeShaperTables(t)!;
    expect(tables.inCurves).toHaveLength(3);
    expect(bakeShaperTables(createTransform(srgb, coated))).toBeNull();
    const img = randomImage(64, 64, 9);
    img.data[3] = 0;
    const out = transformRGBA8(img, t);
    let worst = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const exact = t.one([img.data[i] / 255, img.data[i + 1] / 255, img.data[i + 2] / 255]);
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(out.data[i + c] - exact[c] * 255));
      expect(out.data[i + 3]).toBe(img.data[i + 3]);
    }
    expect(worst).toBeLessThanOrEqual(1);
    // LUT conversions report progress per block of rows.
    const fractions: number[] = [];
    transformRGBA8(randomImage(8, 200), createProofTransform(srgb, coated, srgb).lut, { report: (f) => fractions.push(f) });
    expect(fractions.length).toBe(3);
    // Identity transform leaves pixels unchanged.
    const same = transformRGBA8(img, createTransform(srgb, srgb));
    expect(Array.from(same.data)).toEqual(Array.from(img.data));
  });

  it('separates RGBA8 into CMYK planes and back', () => {
    const t = createTransform(srgb, coated, 'relative', { bpc: true });
    const img = randomImage(32, 32, 4);
    const planes = transformToCMYK(img, t);
    // Separations interpolate in ink space; what matters is the printed color.
    const cmykLab = createTransform(coated, lab, 'relative');
    let worst = 0,
      planeErr = 0;
    for (let p = 0; p < 32 * 32; p++) {
      const exact = t.one([img.data[p * 4] / 255, img.data[p * 4 + 1] / 255, img.data[p * 4 + 2] / 255]);
      const got = [planes.c[p], planes.m[p], planes.y[p], planes.k[p]].map((v) => v / 255);
      got.forEach((v, c) => (planeErr += Math.abs(v - exact[c]) * 255));
      worst = Math.max(worst, deltaE2000(decodeLab(cmykLab.one(exact), 'v4'), decodeLab(cmykLab.one(got), 'v4')));
      expect(planes.alpha[p]).toBe(img.data[p * 4 + 3]);
      expect(planes.c[p] + planes.m[p] + planes.y[p] + planes.k[p]).toBeLessThanOrEqual(3 * 255 + 2);
    }
    expect(planeErr / (32 * 32 * 4)).toBeLessThan(2);
    expect(worst).toBeLessThan(2.5);
    const back = cmykToRGBA8(planes, createTransform(coated, srgb, 'relative', { bpc: true }));
    const direct = createTransform(coated, srgb, 'relative', { bpc: true });
    for (let p = 0; p < 32 * 32; p += 7) {
      const exact = direct.one([planes.c[p], planes.m[p], planes.y[p], planes.k[p]].map((v) => v / 255));
      const got = [0, 1, 2].map((c) => back.data[p * 4 + c] / 255);
      expect(deltaE2000(labOf(exact), labOf(got))).toBeLessThan(1.5);
    }
  });
});

describe('soft proofing and gamut warning', { timeout: 120000 }, () => {
  it('simulates paper white and black ink on the display', () => {
    const plain = createProofTransform(srgb, coated, srgb);
    const paper = createProofTransform(srgb, coated, srgb, { simulatePaper: true });
    const ink = createProofTransform(srgb, coated, srgb, { simulateBlackInk: true });
    const white = [1, 1, 1],
      black = [0, 0, 0];
    plain.transform.one(white).forEach((v) => expect(v).toBeCloseTo(1, 2));
    const paperWhite = labOf(paper.transform.one(white));
    expect(paperWhite[0]).toBeLessThan(97);
    expect(paperWhite[2]).toBeLessThan(-1);
    expect(labOf(plain.transform.one(black))[0]).toBeLessThan(2);
    expect(labOf(ink.transform.one(black))[0]).toBeGreaterThan(8);
    // Ink simulation keeps the paper white.
    ink.transform.one(white).forEach((v) => expect(v).toBeCloseTo(1, 2));
    // The proof LUT is what the compositor samples.
    const out = [0, 0, 0, 0];
    sampleLut3D(paper.lut, 1, 1, 1, out);
    expect(out[0]).toBeCloseTo(paper.transform.one(white)[0], 4);
  });

  it('flags out-of-gamut pixels but not printable or transparent ones', () => {
    const img: RGBA8 = {
      width: 4,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 255, 255, 128, 128, 128, 255, 0, 0, 255, 0, 0, 255, 0, 255]),
    };
    const mask = gamutWarning(img, srgb, coated);
    expect(Array.from(mask.data)).toEqual([255, 0, 0, 255]);
    // A loose threshold accepts everything.
    expect(Array.from(gamutWarning(img, srgb, coated, 200).data)).toEqual([0, 0, 0, 0]);
  });
});
