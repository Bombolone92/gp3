import { describe, expect, it } from 'vitest';
import { ADJUSTMENT_KINDS, applyAdjustment, type Adjustment } from '../src/imaging/adjust';
import { mask8 } from '../src/imaging/types';
import { randomImage, sampleAdjustment } from './adjust-fixtures';

describe('selection masking', () => {
  const img = randomImage(16, 8, 21, true);
  const sel = mask8(16, 8);
  // Columns: 0-3 unselected, 4-7 half, 8-15 fully selected.
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) sel.data[y * 16 + x] = x < 4 ? 0 : x < 8 ? 128 : 255;

  for (const kind of [...ADJUSTMENT_KINDS])
    it(`${kind} respects coverage`, () => {
      const adj: Adjustment = sampleAdjustment(kind);
      const full = applyAdjustment(img, adj);
      const masked = applyAdjustment(img, adj, sel);
      for (let p = 0; p < 16 * 8; p++) {
        const i = p * 4,
          m = sel.data[p];
        expect(masked.data[i + 3]).toBe(img.data[i + 3]);
        for (let c = 0; c < 3; c++) {
          const s = img.data[i + c],
            f = full.data[i + c],
            v = masked.data[i + c];
          if (m === 0) expect(v).toBe(s);
          else if (m === 255) expect(v).toBe(f);
          else expect(Math.abs(v - (s + ((f - s) * m) / 255))).toBeLessThanOrEqual(0.51);
        }
      }
    });

  it('rejects a selection of the wrong size', () => {
    expect(() => applyAdjustment(img, { kind: 'invert', params: {} }, mask8(3, 3, 255))).toThrow(/size/);
  });

  it('honors cancellation', () => {
    expect(() => applyAdjustment(randomImage(64, 64, 1), { kind: 'invert', params: {} }, undefined, { cancelled: () => true })).toThrow(/cancelled/);
  });
});
