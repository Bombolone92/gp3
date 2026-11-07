import { describe, it, expect } from 'vitest';
import { SFX, SFX_GROUPS, renderSfx, hitTimes } from '../src/media/sfx.js';

describe('sound effect recipes', () => {
  it('has about twenty effects with unique ids in known groups', () => {
    expect(SFX.length).toBeGreaterThanOrEqual(20);
    expect(new Set(SFX.map((s) => s.id)).size).toBe(SFX.length);
    const groups = new Set(SFX_GROUPS.map((g) => g.id));
    for (const s of SFX) {
      expect(groups.has(s.group)).toBe(true);
      expect(s.label).toBeTruthy();
      expect(s.dur).toBeGreaterThan(0);
      expect(s.dur).toBeLessThanOrEqual(3);
    }
  });

  for (const s of SFX) {
    it(`${s.id} renders a non-silent, finite buffer of the right length`, () => {
      const sr = 22050;
      const out = renderSfx(s.id, sr);
      expect(out.length).toBe(Math.round(s.dur * sr));
      let peak = 0;
      let energy = 0;
      for (const x of out) {
        expect(Number.isFinite(x)).toBe(true);
        peak = Math.max(peak, Math.abs(x));
        energy += x * x;
      }
      expect(peak).toBeGreaterThan(0.85);
      expect(peak).toBeLessThanOrEqual(0.9);
      // Not just a single spike: some real signal energy.
      expect(Math.sqrt(energy / out.length)).toBeGreaterThan(0.005);
    });
  }

  it('renders deterministically', () => {
    const a = renderSfx('applause', 8000);
    const b = renderSfx('applause', 8000);
    expect(a).toEqual(b);
  });

  it('spreads random hits over the span in order', () => {
    const hits = hitTimes({ hits: { count: 10, span: 2, seed: 4 } });
    expect(hits).toHaveLength(10);
    for (let i = 1; i < hits.length; i++) expect(hits[i].t).toBeGreaterThanOrEqual(hits[i - 1].t);
    expect(hits[0].t).toBeGreaterThanOrEqual(0);
    expect(hits.at(-1).t).toBeLessThanOrEqual(2);
    expect(hitTimes({ hits: [0, [0.5, 0.3]] })).toEqual([{ t: 0, gain: 1 }, { t: 0.5, gain: 0.3 }]);
    expect(hitTimes({})).toEqual([{ t: 0, gain: 1 }]);
  });

  it('throws for an unknown id', () => {
    expect(() => renderSfx('nope')).toThrow();
  });
});
