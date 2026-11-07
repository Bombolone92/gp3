import { describe, expect, it } from 'vitest';
import { bidiClass, bidiLevels, hasRtl, lineLevels, mirror, paragraphLevel, shapeDigits, visualOrder, visualRuns } from '../src/imaging/text/bidi';

const lv = (text: string, dir: 'ltr' | 'rtl' | 'auto' = 'auto') => [...bidiLevels(text, dir)].join('');
// Visual string of a line: runs in visual order, odd runs reversed.
const visual = (text: string, dir: 'ltr' | 'rtl' | 'auto' = 'auto') => {
  const levels = bidiLevels(text, dir);
  return visualOrder(levels, 0, text.length).map((i) => text[i]).join('');
};

describe('bidi classes', () => {
  it('classifies the main scripts and punctuation', () => {
    const c = (s: string) => bidiClass(s.codePointAt(0)!);
    expect(['a', 'א', 'ب', '1', '٣', '۳', '+', '$', ',', ' ', '\t', '\n', '!', '́', '‍', '‏'].map(c)).toEqual(['L', 'R', 'AL', 'EN', 'AN', 'EN', 'ES', 'ET', 'CS', 'WS', 'S', 'B', 'ON', 'NSM', 'BN', 'R']);
    expect(bidiClass(0x10900)).toBe('R');
    expect(bidiClass(0x1f600)).toBe('ON');
  });
  it('finds the paragraph level', () => {
    expect(paragraphLevel('123 abc')).toBe(0);
    expect(paragraphLevel('  שלום world')).toBe(1);
    expect(paragraphLevel('مرحبا')).toBe(1);
    expect(paragraphLevel('abc', 'rtl')).toBe(1);
    expect(paragraphLevel('אבג', 'ltr')).toBe(0);
    expect(paragraphLevel('...')).toBe(0);
  });
});

describe('bidi levels', () => {
  it('keeps plain left-to-right text at level 0', () => {
    expect(lv('hello, world 42')).toBe('000000000000000');
  });
  it('raises Hebrew inside English', () => {
    // "abc אבג def": the spaces between different directions take the embedding level.
    expect(lv('abc אבג def')).toBe('00001110000');
    expect(visual('abc אבג def')).toBe('abc גבא def');
  });
  it('lays out a right-to-left paragraph with embedded English', () => {
    const t = 'שלום world!';
    expect(lv(t)).toBe('11111222221');
    expect(visual(t)).toBe('!world םולש');
  });
  it('keeps numbers left-to-right inside right-to-left text', () => {
    const t = 'אבג 123 דה';
    expect(lv(t)).toBe('1111222111'.slice(0, t.length));
    expect(visual(t)).toBe('הד 123 גבא');
  });
  it('turns European digits after Arabic letters into Arabic numbers (W2)', () => {
    const levels = bidiLevels('ب 12', 'auto');
    expect([...levels]).toEqual([1, 1, 2, 2]);
  });
  it('joins numbers across separators and terminators (W4, W5)', () => {
    // In a right-to-left paragraph "1,000$" stays one left-to-right number.
    const t = 'א 1,000$';
    expect(lv(t)).toBe('11222222');
    expect(visual(t)).toBe('1,000$ א');
    expect(lv('א 1+2')).toBe('11222');
  });
  it('attaches combining marks to their base', () => {
    expect(lv('שָׁלוֹם')).toBe('1111111');
    expect(lv('abć')).toBe('0000');
  });
  it('resolves neutrals between same-direction text to that direction (N1)', () => {
    expect(lv('abc אב - גד xyz')).toBe('000011111110000');
  });
  it('resets trailing whitespace and tabs (L1)', () => {
    const t = 'אב  ';
    expect(lv(t, 'ltr')).toBe('1100');
    expect(lv('א\tב', 'ltr')).toBe('101');
  });
  it('handles each paragraph separately', () => {
    expect(lv('abc\nאבג')).toBe('0000111');
  });
  it('ignores formatting characters', () => {
    expect(lv('a​b')).toBe('000');
    expect(lv('א‍ב')).toBe('111');
  });
});

describe('line reordering', () => {
  it('returns level runs in visual order', () => {
    const t = 'abc אבג 12 def';
    const levels = bidiLevels(t, 'ltr');
    const runs = visualRuns(levels, 0, t.length);
    // The space after the Hebrew word sits between R and a number (R), so it is level 1.
    expect(runs.map((r) => [t.slice(r.start, r.end), r.level])).toEqual([
      ['abc ', 0],
      ['12', 2],
      ['אבג ', 1],
      [' def', 0],
    ]);
  });
  it('reverses the order of runs in a right-to-left line', () => {
    const t = 'שלום abc דה';
    const levels = bidiLevels(t, 'auto');
    const runs = visualRuns(levels, 0, t.length);
    expect(runs.map((r) => [t.slice(r.start, r.end), r.level])).toEqual([
      [' דה', 1],
      ['abc', 2],
      ['שלום ', 1],
    ]);
  });
  it('applies L1 at the end of a wrapped line', () => {
    const t = 'abc אבג def';
    const levels = bidiLevels(t, 'ltr');
    // Line break after "אבג ": the trailing space returns to the base level.
    expect([...lineLevels(levels, t, 0, 8, 0)]).toEqual([0, 0, 0, 0, 1, 1, 1, 0]);
    const runs = visualRuns(levels, 0, 8, t, 0);
    expect(runs.map((r) => t.slice(r.start, r.end))).toEqual(['abc ', 'אבג', ' ']);
  });
  it('orders nested levels (L2)', () => {
    expect(visualOrder([0, 1, 1, 2, 2, 1, 0], 0, 7)).toEqual([0, 5, 3, 4, 2, 1, 6]);
  });
});

describe('helpers', () => {
  it('mirrors brackets', () => {
    expect(['(', ')', '[', '«', '<', 'a'].map(mirror)).toEqual([')', '(', ']', '»', '>', 'a']);
  });
  it('shapes digits', () => {
    expect(shapeDigits('a1 23', 'arabic')).toBe('a١ ٢٣');
    expect(shapeDigits('2024', 'persian')).toBe('۲۰۲۴');
    expect(shapeDigits('42', 'none')).toBe('42');
  });
  it('detects right-to-left text', () => {
    expect(hasRtl('hello')).toBe(false);
    expect(hasRtl('hi שלום')).toBe(true);
  });
});
