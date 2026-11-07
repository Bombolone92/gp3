import { describe, it, expect } from 'vitest';
import { MUSIC, renderMusic, musicDuration, sequence, chordNotes, SCALES } from '../src/media/music.js';
import { SFX, SFX_GROUPS } from '../src/media/sfx.js';

const SR = 8000; // low rate keeps the full renders quick

describe('music beds', () => {
  it('has about ten original tracks with unique ids and distinct moods', () => {
    expect(MUSIC.length).toBeGreaterThanOrEqual(10);
    expect(new Set(MUSIC.map((m) => m.id)).size).toBe(MUSIC.length);
    expect(new Set(MUSIC.map((m) => m.mood)).size).toBeGreaterThanOrEqual(10);
    for (const m of MUSIC) {
      expect(SCALES[m.scale], m.id).toBeTruthy();
      expect(m.title).toBeTruthy();
    }
  });

  it('every track lasts 30 to 60 seconds and is a whole number of bars', () => {
    for (const m of MUSIC) {
      const d = musicDuration(m);
      expect(d, m.id).toBeGreaterThanOrEqual(30);
      expect(d, m.id).toBeLessThanOrEqual(60);
      expect(Number.isInteger(m.bars)).toBe(true);
      expect(musicDuration(m.id)).toBe(d);
    }
  });

  it('sequences notes and drum hits inside the loop', () => {
    for (const m of MUSIC) {
      const { notes, hits } = sequence(m);
      const d = musicDuration(m);
      expect(notes.length, m.id).toBeGreaterThan(20);
      for (const n of notes) {
        expect(n.t).toBeGreaterThanOrEqual(0);
        expect(n.t).toBeLessThan(d);
        expect(n.dur).toBeGreaterThan(0);
        expect(n.midi).toBeGreaterThan(20);
        expect(n.midi).toBeLessThan(110);
      }
      for (const x of hits) expect(x.t).toBeLessThan(d);
      if (m.drums) expect(hits.length, m.id).toBeGreaterThan(0);
    }
  });

  it('builds chords from the scale', () => {
    const t = { root: 60, scale: 'major' };
    expect(chordNotes(t, 0)).toEqual([60, 64, 67]);
    expect(chordNotes(t, 5)).toEqual([69, 72, 76]);
    expect(chordNotes({ ...t, sevenths: true }, 1)).toEqual([62, 65, 69, 72]);
  });

  for (const m of MUSIC) {
    it(`${m.id} renders finite, non-silent stereo of the right length`, () => {
      const r = renderMusic(m.id, SR);
      const n = Math.round(musicDuration(m) * SR);
      expect(r.left.length).toBe(n);
      expect(r.right.length).toBe(n);
      expect(r.sampleRate).toBe(SR);
      let peak = 0;
      let energy = 0;
      for (let i = 0; i < n; i++) {
        const a = r.left[i];
        const b = r.right[i];
        if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`non-finite sample at ${i}`);
        peak = Math.max(peak, Math.abs(a), Math.abs(b));
        energy += a * a + b * b;
      }
      expect(peak).toBeGreaterThan(0.85);
      expect(peak).toBeLessThanOrEqual(0.9);
      expect(Math.sqrt(energy / (2 * n))).toBeGreaterThan(0.03);
      // Sound throughout: no silent quarter.
      for (let q = 0; q < 4; q++) {
        let e = 0;
        for (let i = Math.floor((q * n) / 4); i < Math.floor(((q + 1) * n) / 4); i++) e += r.left[i] * r.left[i];
        expect(Math.sqrt(e / (n / 4)), `${m.id} quarter ${q}`).toBeGreaterThan(0.01);
      }
    });
  }

  it('renders deterministically', () => {
    const a = renderMusic('late-pages', SR);
    const b = renderMusic('late-pages', SR);
    expect(a.left).toEqual(b.left);
    expect(a.right).toEqual(b.right);
    const other = renderMusic('night-circuit', SR);
    expect(other.left.slice(0, 2000)).not.toEqual(a.left.slice(0, 2000));
  });

  it('throws for unknown tracks', () => {
    expect(() => renderMusic('nope', SR)).toThrow(/Unknown/);
  });
});

describe('more sound effects', () => {
  it('has fifty-odd effects in seven groups, each group used', () => {
    expect(SFX.length).toBeGreaterThanOrEqual(45);
    for (const g of SFX_GROUPS) expect(SFX.some((s) => s.group === g.id), g.id).toBe(true);
    for (const id of ['boing', 'teleport', 'rain', 'success', 'tape-stop']) expect(SFX.some((s) => s.id === id)).toBe(true);
  });
});
