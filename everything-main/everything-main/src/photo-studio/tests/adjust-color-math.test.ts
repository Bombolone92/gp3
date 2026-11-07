import { describe, expect, it } from 'vitest';
import {
  hsbToRgb,
  hslToRgb,
  labToRgb,
  linearToSrgb,
  linearToSrgbFast,
  luma8,
  rgbToHsb,
  rgbToHsl,
  rgbToLab,
  srgbToLinear,
  srgbToLinearFast,
  hexToRgb8,
  rgb8ToHex,
} from '../src/imaging/adjust';
import { rng } from './adjust-fixtures';

describe('color math', () => {
  it('sRGB transfer round-trips and matches reference points', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 6);
    expect(linearToSrgb(0.18)).toBeCloseTo(0.461356, 6);
    for (let i = 0; i <= 255; i++) expect(linearToSrgb(srgbToLinear(i / 255))).toBeCloseTo(i / 255, 10);
  });

  it('fast transfer tables stay within 0.01 code values', () => {
    let worst = 0;
    for (let i = 0; i <= 100000; i++) {
      const v = i / 100000;
      worst = Math.max(worst, Math.abs(srgbToLinearFast(v) - srgbToLinear(v)), Math.abs(linearToSrgbFast(v) - linearToSrgb(v)));
    }
    expect(worst * 255).toBeLessThan(0.01);
    expect(linearToSrgbFast(-1)).toBe(0);
    expect(srgbToLinearFast(2)).toBe(1);
  });

  it('HSL and HSB round-trip random colors and know the primaries', () => {
    const r = rng(3);
    for (let i = 0; i < 2000; i++) {
      const c = [r(), r(), r()];
      const hsl = rgbToHsl(c[0], c[1], c[2]);
      const back = hslToRgb(hsl[0], hsl[1], hsl[2]);
      const hsb = rgbToHsb(c[0], c[1], c[2]);
      const back2 = hsbToRgb(hsb[0], hsb[1], hsb[2]);
      for (let k = 0; k < 3; k++) {
        expect(back[k]).toBeCloseTo(c[k], 9);
        expect(back2[k]).toBeCloseTo(c[k], 9);
      }
    }
    expect([...rgbToHsl(0, 1, 0)]).toEqual([120, 1, 0.5]);
    expect([...rgbToHsb(0, 0, 1)]).toEqual([240, 1, 1]);
    expect([...hslToRgb(-60, 1, 0.5)].map((v) => +v.toFixed(9))).toEqual([1, 0, 1]);
    expect([...hslToRgb(420, 1, 0.5)].map((v) => +v.toFixed(9))).toEqual([1, 1, 0]);
  });

  it('Lab matches published D65 values and round-trips', () => {
    const white = rgbToLab(1, 1, 1);
    expect(white[0]).toBeCloseTo(100, 4);
    expect(Math.abs(white[1])).toBeLessThan(1e-3);
    expect(Math.abs(white[2])).toBeLessThan(1e-3);
    const red = rgbToLab(1, 0, 0);
    expect(red[0]).toBeCloseTo(53.24, 1);
    expect(red[1]).toBeCloseTo(80.09, 1);
    expect(red[2]).toBeCloseTo(67.2, 1);
    const r = rng(9);
    for (let i = 0; i < 500; i++) {
      const c = [r(), r(), r()];
      const lab = rgbToLab(c[0], c[1], c[2]);
      const back = labToRgb(lab[0], lab[1], lab[2]);
      for (let k = 0; k < 3; k++) expect(back[k]).toBeCloseTo(c[k], 7);
    }
  });

  it('fixed-point luma matches the float weights', () => {
    for (let i = 0; i < 4096; i++) {
      const R = (i * 37) & 255,
        G = (i * 91) & 255,
        B = (i * 13) & 255;
      expect(Math.abs(luma8(R, G, B) - (0.2126 * R + 0.7152 * G + 0.0722 * B))).toBeLessThanOrEqual(0.51);
    }
    expect(luma8(255, 255, 255)).toBe(255);
  });

  it('parses and formats hex colors', () => {
    expect(hexToRgb8('#ff8000')).toEqual([255, 128, 0]);
    expect(hexToRgb8('bogus')).toEqual([0, 0, 0]);
    expect(rgb8ToHex([255, 128, 0])).toBe('#ff8000');
  });
});
