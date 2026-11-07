import { describe, expect, it } from 'vitest';
import { builtinProfile } from '../src/color/builtin-profiles';
import { cachedTransform } from '../src/color/transform';
import { decodeLab, encodeLab } from '../src/color/color-math';
import { fieldAxes, fromRgb, positions, renderField, renderStrip, stateAt, webSafe, type LabConverter } from '../src/features/color/picker-model';
import { validateDocument } from '../src/model/serialization';
import { newDocument } from '../src/model/document';

const srgb = builtinProfile('srgb');
const lab = builtinProfile('lab-d50');
const toRgbT = cachedTransform(lab, srgb, 'relative');
const toLabT = cachedTransform(srgb, lab, 'relative');
const conv: LabConverter = {
  toRgb(values, count, out) {
    const enc = new Float32Array(count * 3);
    const t = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      encodeLab([values[i * 3], values[i * 3 + 1], values[i * 3 + 2]], 'v4', t);
      enc.set(t, i * 3);
    }
    toRgbT.apply(enc, out, count);
  },
  toLab(rgb) {
    const v = decodeLab(toLabT.one(rgb.map((c) => c / 255)), 'v4');
    return [v[0], v[1], v[2]];
  },
};

describe('color picker geometry', () => {
  it('places colors on the hue strip and saturation/brightness field', () => {
    const red = fromRgb([255, 0, 0], undefined, conv);
    const p = positions(red, 'h');
    expect(p.z).toBeCloseTo(0);
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(0);
    const back = stateAt('h', p.z, p.x, p.y, red, conv);
    expect(back.rgb).toEqual([255, 0, 0]);
    // Bottom of the field is black for any hue.
    expect(stateAt('h', 0.5, 0.7, 1, red, conv).rgb).toEqual([0, 0, 0]);
  });

  it('round-trips through every strip axis', () => {
    const start = fromRgb([40, 160, 220], undefined, conv);
    for (const axis of Object.keys(fieldAxes) as (keyof typeof fieldAxes)[]) {
      const p = positions(start, axis);
      const s = stateAt(axis, p.z, p.x, p.y, start, conv);
      for (let c = 0; c < 3; c++) expect(Math.abs(s.rgb[c] - start.rgb[c])).toBeLessThanOrEqual(axis === 'L' || axis === 'A' || axis === 'B' ? 2 : 1);
    }
  });

  it('keeps the hue when the color becomes gray or black', () => {
    const blue = fromRgb([0, 0, 255], undefined, conv);
    const black = fromRgb([0, 0, 0], blue, conv);
    expect(black.hsb.h).toBeCloseTo(240);
    const grayish = fromRgb([128, 128, 128], blue, conv);
    expect(grayish.hsb.h).toBeCloseTo(240);
  });

  it('renders the field and strip', () => {
    const red = fromRgb([255, 0, 0], undefined, conv);
    const f = renderField('h', 0, 8, 8, red, conv);
    expect(Array.from(f.subarray(7 * 4, 7 * 4 + 4))).toEqual([255, 0, 0, 255]); // top right
    expect(Array.from(f.subarray(0, 4))).toEqual([255, 255, 255, 255]); // top left
    expect(Array.from(f.subarray(7 * 8 * 4, 7 * 8 * 4 + 3))).toEqual([0, 0, 0]); // bottom left
    const strip = renderStrip('h', 7, red, conv);
    expect(Array.from(strip.subarray(0, 3))).toEqual([255, 0, 0]);
    const labField = renderField('L', 0.5, 4, 4, red, conv);
    expect(labField[3]).toBe(255);
    const lStrip = renderStrip('L', 5, red, conv);
    expect(lStrip[0]).toBeGreaterThan(lStrip[4 * 4]);
  });

  it('snaps to web-safe colors', () => {
    expect(webSafe([20, 130, 250])).toEqual([0, 153, 255]);
  });
});

describe('document color mode validation', () => {
  const base = () => ({ ...newDocument(10, 10) });
  it('accepts every mode with its data', () => {
    expect(validateDocument({ ...base(), mode: 'cmyk', modeData: { profile: 'builtin:generic-coated-cmyk' } }).mode).toBe('cmyk');
    expect(validateDocument({ ...base(), mode: 'indexed', modeData: { palette: ['#000000', '#ffffff'], transparentIndex: 1 } }).mode).toBe('indexed');
    expect(validateDocument({ ...base(), mode: 'bitmap', modeData: { bitmap: { method: 'halftone', resolution: 300, frequency: 60, angle: 45, shape: 'round' } } }).mode).toBe('bitmap');
    expect(validateDocument({ ...base(), mode: 'duotone', modeData: { inks: [{ name: 'Black', color: '#000000' }, { name: 'Red', color: '#ff0000', curve: [[0, 0], [100, 80]] }] } }).mode).toBe('duotone');
    expect(validateDocument({ ...base(), mode: 'grayscale', modeData: { profile: 'AAAA' } }).mode).toBe('grayscale');
  });
  it('rejects invalid modes and data', () => {
    expect(() => validateDocument({ ...base(), mode: 'hsl' })).toThrow(/color mode/);
    expect(() => validateDocument({ ...base(), mode: 'indexed', modeData: { palette: ['red'] } })).toThrow(/mode data/);
    expect(() => validateDocument({ ...base(), mode: 'indexed', modeData: { palette: ['#000000'], transparentIndex: 3 } })).toThrow(/mode data/);
    expect(() => validateDocument({ ...base(), modeData: { profile: 'not base64!' } })).toThrow(/mode data/);
    expect(() => validateDocument({ ...base(), modeData: { inks: [] } })).toThrow(/mode data/);
    expect(() => validateDocument({ ...base(), modeData: { inks: [{ name: 'K', color: '#000000', curve: [[0, 200]] }] } })).toThrow(/mode data/);
    expect(() => validateDocument({ ...base(), modeData: { bitmap: { method: 'magic', resolution: 72 } } })).toThrow(/mode data/);
  });
});
