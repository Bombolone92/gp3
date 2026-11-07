import { it, expect } from 'vitest';
import { paragraph } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { cellIntrinsicWidths } from '../src/engine/intrinsic-widths.js';
const measure = (text, style) => ({ width: text.length * 10 - (style.kerning > 0 ? (text.match(/L /g) || []).length * 4 : 0), ascent: 10, descent: 3 });
const page = { width: 38, height: 200, margin: 10 };
const make = (runs, alignment = 'left') => paragraph('', { format: { alignment, spaceAfter: 0 }, runs: runs.map(r => ({ kerning: 1, underline: true, ...r })) });
const texts = l => l.lines.map(line => line.fragments.map(f => f.text).join(''));
it('keeps a word intact using the following space pair and preserves its end caret and underline', () => {
  const p = make([{ text: 'AL B' }]), l = layoutDocument([p], measure, page);
  expect(texts(l)).toEqual(['AL ', 'B']);
  expect(l.lines[0].stops.find(s => s.offset === 2).x).toBe(26);
  expect(l.lines[0].underlines[0].width).toBe(16);
});
it('uses the contextual content edge for center and right alignment across color-only run splits', () => {
  for (const [alignment, x] of [['center', 11], ['right', 12]]) {
    const l = layoutDocument([make([{ text: 'AL' }, { text: ' B', color: 'CC0000' }], alignment)], measure, page);
    expect(texts(l)).toEqual(['AL ', 'B']);
    expect(l.lines[0].fragments[0].x).toBe(x);
    expect(l.lines[0].stops.find(s => s.offset === 2).x).toBe(x + 16);
  }
});
it('does not borrow a pair across a paragraph, break, tab, font or kerning boundary', () => {
  for (const runs of [[{text:'AL'}], [{text:'AL\vB'}], [{text:'AL\tB'}], [{text:'AL'}, {text:' B',kerning:0}], [{text:'AL'}, {text:' B',fontAscii:'Other',fontHAnsi:'Other'}]]) {
    expect(texts(layoutDocument([make(runs)], measure, page))[0]).toBe('A');
  }
});
it('retains following-space context in the intrinsic minimum', () => {
  const cell = { margins: { left: 0, right: 0 }, content: [{ paragraph: make([{text:'AL B'}]), index:0 }] };
  expect(cellIntrinsicWidths(cell, measure, page, undefined, []).min).toBe(16);
});
it('does not re-shape every growing prefix of a long hanging-space tail', () => {
  let shapedCharacters = 0;
  const measured = (text, style) => { shapedCharacters += text.length; return measure(text, style); };
  const text = 'AL' + ' '.repeat(2000);
  const l = layoutDocument([make([{text}])], measured, page);
  expect(texts(l).join('')).toBe(text);
  expect(shapedCharacters).toBeLessThan(text.length * 20);
});
it('reuses a following-space measurement when that character is consumed', () => {
  let completeWordWithSpace = 0;
  const measured = (text, style) => { if (text === 'AL ') completeWordWithSpace++; return measure(text, style); };
  expect(texts(layoutDocument([make([{text:'AL B'}])], measured, page))).toEqual(['AL ', 'B']);
  // One scan and one final line construction; look-ahead must not add a third.
  expect(completeWordWithSpace).toBe(2);
});
