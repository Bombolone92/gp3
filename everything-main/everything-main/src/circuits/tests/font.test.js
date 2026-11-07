import { describe, it, expect } from 'vitest';
import { layoutText, textStrokes, textWidth, textHeight, strokeWidthFor, GLYPH_CHARS, plainText } from '../src/render/font.js';

const bounds = (strokes) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (let i = 0; i < s.length; i += 2) {
    minX = Math.min(minX, s[i]); maxX = Math.max(maxX, s[i]);
    minY = Math.min(minY, s[i + 1]); maxY = Math.max(maxY, s[i + 1]);
  }
  return { minX, minY, maxX, maxY };
};

describe('stroke font', () => {
  it('has a glyph for every printable ASCII character', () => {
    for (let c = 32; c < 127; c++) expect(GLYPH_CHARS).toContain(String.fromCharCode(c));
    for (const ch of ['µ', 'Ω', '°', '±', 'Ω', 'μ']) expect(GLYPH_CHARS).toContain(ch);
  });

  it('draws visible strokes for every non-space glyph', () => {
    for (let c = 33; c < 127; c++) {
      const ch = String.fromCharCode(c);
      if (ch === '~') continue; // overbar marker; '~~' prints a tilde
      const { strokes } = layoutText(ch, 1);
      expect(strokes.length, ch).toBeGreaterThan(0);
      for (const s of strokes) {
        expect(s.length % 2).toBe(0);
        expect(s.every(Number.isFinite)).toBe(true);
      }
    }
    expect(layoutText('~~', 1).strokes.length).toBeGreaterThan(0);
  });

  it('scales with size: cap height equals size', () => {
    const b = bounds(layoutText('H', 10).strokes);
    expect(b.minY).toBeCloseTo(0);
    expect(b.maxY).toBeCloseTo(10);
    expect(textHeight('H', 10)).toBeCloseTo(10);
  });

  it('widens monotonically as characters are added', () => {
    let prev = 0;
    for (const s of ['A', 'AB', 'ABC', 'ABC1', 'ABC12 x']) {
      const w = textWidth(s, 5);
      expect(w).toBeGreaterThan(prev);
      prev = w;
    }
    expect(textWidth('', 5)).toBe(0);
  });

  it('aligns around the anchor', () => {
    const w = textWidth('R12', 2);
    const left = bounds(layoutText('R12', 2, { h: 'left', v: 'bottom' }).strokes);
    const center = bounds(layoutText('R12', 2, { h: 'center', v: 'middle' }).strokes);
    const right = bounds(layoutText('R12', 2, { h: 'right', v: 'top' }).strokes);
    expect(left.minX).toBeCloseTo(0, 5);
    expect(center.minX).toBeCloseTo(-w / 2, 5);
    expect(center.maxY).toBeCloseTo(1, 5);
    expect(right.maxX).toBeCloseTo(0, 5);
    expect(right.maxY).toBeCloseTo(0, 5);
  });

  it('lays out multiple lines downward', () => {
    const one = layoutText('A', 1, { h: 'left', v: 'top' });
    const two = layoutText('A\nB', 1, { h: 'left', v: 'top' });
    expect(two.height).toBeCloseTo(2.6);
    expect(bounds(two.strokes).minY).toBeLessThan(bounds(one.strokes).minY - 1);
  });

  it('draws an overbar between tilde markers', () => {
    const plain = layoutText('RESET', 1).strokes.length;
    const barred = layoutText('~RESET~', 1);
    expect(barred.strokes.length).toBe(plain + 1);
    expect(bounds(barred.strokes).maxY).toBeGreaterThan(1.1);
    expect(textWidth('~RESET~', 1)).toBeCloseTo(textWidth('RESET', 1));
    expect(plainText('~CS~ and ~~')).toBe('CS and ~');
  });

  it('mirrors and rotates about the anchor', () => {
    const normal = bounds(textStrokes('AB', 100, 50, 10));
    const mirrored = bounds(textStrokes('AB', 100, 50, 10, 0, undefined, true));
    expect(normal.minX).toBeCloseTo(100);
    expect(mirrored.maxX).toBeCloseTo(100);
    expect(mirrored.minX).toBeCloseTo(100 - (normal.maxX - normal.minX));
    const rotated = bounds(textStrokes('AB', 0, 0, 10, 90));
    expect(rotated.maxX).toBeCloseTo(0);
    expect(rotated.maxY).toBeCloseTo(normal.maxX - 100);
  });

  it('suggests a proportional stroke width', () => {
    expect(strokeWidthFor(10)).toBeCloseTo(1.2);
  });
});
