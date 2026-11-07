import { describe, expect, it } from 'vitest';
import { CMYK_INKS, GRAY_INK, RGB_INKS, inkComposite, splitCmyk, splitGray, splitRgb } from '../src/color/multichannel';
import { defaultHdrPreview, hdrPreviewUniforms, isIdentityHdrPreview, toneMapPreview, validateHdrPreview } from '../src/model/hdr-preview';
import type { RGBA8 } from '../src/imaging/types';

const image = (px: number[][]): RGBA8 => ({ width: px.length, height: 1, data: Uint8ClampedArray.from(px.flatMap((p) => [...p, 255])) });

describe('multichannel inks', () => {
  it('RGB splits into cyan, magenta and yellow and overprints back exactly', () => {
    const img = image([[255, 255, 255], [0, 0, 0], [12, 200, 99], [255, 0, 128]]);
    const planes = splitRgb(img);
    expect([...planes[0]]).toEqual([255, 0, 12, 255]);
    const back = inkComposite(planes, RGB_INKS, 4, 1);
    expect([...back.data]).toEqual([...img.data]);
  });
  it('hidden channels leave the composite', () => {
    const planes = splitRgb(image([[0, 0, 0]]));
    const back = inkComposite([planes[0], null, null], RGB_INKS, 1, 1);
    expect([...back.data]).toEqual([0, 255, 255, 255]);
  });
  it('CMYK ink amounts become inverted channels', () => {
    const planes = splitCmyk([1, 0, 0.5, 0.2], 1);
    expect(planes.map((p) => p[0])).toEqual([0, 255, 128, 204]);
    // Full black ink alone prints black.
    expect([...inkComposite(splitCmyk([0, 0, 0, 1], 1), CMYK_INKS, 1, 1).data]).toEqual([0, 0, 0, 255]);
  });
  it('gray becomes one black ink and duotone inks follow their curves', () => {
    const img = image([[128, 128, 128], [255, 255, 255]]);
    const [black] = splitGray(img);
    expect([...black]).toEqual([128, 255]);
    expect([...inkComposite([black], [GRAY_INK], 2, 1).data]).toEqual([128, 128, 128, 255, 255, 255, 255, 255]);
    // A curve printing no ink at any tone leaves paper.
    const [none] = splitGray(img, [[[0, 0], [100, 0]]]);
    expect([...none]).toEqual([255, 255]);
    // A straight curve matches the gray value.
    const [straight] = splitGray(img, [[[0, 0], [100, 100]]]);
    expect(Math.abs(straight[0] - 128)).toBeLessThanOrEqual(1);
  });
});

describe('32-bit preview tone mapping', () => {
  it('defaults to identity', () => {
    expect(isIdentityHdrPreview(defaultHdrPreview())).toBe(true);
    expect(hdrPreviewUniforms(undefined)[0]).toBe(0);
    expect(toneMapPreview(undefined, [2, 0.5, 0])).toEqual([2, 0.5, 0]);
  });
  it('exposure and gamma scale linear values', () => {
    const p = { ...defaultHdrPreview(), exposure: 1, gamma: 2 };
    const [r, g] = toneMapPreview(p, [0.125, 0.5, 0]);
    expect(r).toBeCloseTo(0.5, 6);
    expect(g).toBeCloseTo(1, 6);
  });
  it('highlight compression maps the white point to 1', () => {
    const p = { ...defaultHdrPreview(), method: 'highlight-compression' as const, white: 4 };
    const [r, g, b] = toneMapPreview(p, [4, 4, 4]);
    expect(r).toBeCloseTo(1, 6);
    expect(g).toBeCloseTo(1, 6);
    expect(b).toBeCloseTo(1, 6);
    const c = toneMapPreview(p, [2, 1, 0.5]);
    expect(c[0]).toBeLessThan(1);
    expect(c[0]).toBeGreaterThan(c[1]);
    expect(c[1]).toBeGreaterThan(c[2]);
  });
  it('filmic curve stays within display range and is monotonic', () => {
    const p = { ...defaultHdrPreview(), method: 'filmic' as const };
    let last = -1;
    for (const v of [0, 0.1, 0.5, 1, 4, 100]) {
      const [x] = toneMapPreview(p, [v, v, v]);
      expect(x).toBeGreaterThanOrEqual(last);
      expect(x).toBeLessThanOrEqual(1);
      last = x;
    }
  });
  it('validates saved options', () => {
    expect(validateHdrPreview({ method: 'filmic', exposure: 50, gamma: 1, white: 4 }).exposure).toBe(20);
    expect(() => validateHdrPreview({ method: 'other', exposure: 0, gamma: 1, white: 4 })).toThrow();
  });
});
