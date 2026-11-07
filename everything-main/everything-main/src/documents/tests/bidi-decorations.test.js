import { it, expect } from 'vitest';
import { paragraph } from '../src/engine/model.js';
import { RUN_FORMAT } from '../src/engine/formatting.js';
import { layoutDocument } from '../src/engine/layout.js';

const measure = (text, style) => ({ width: text === 'ل' ? 20 : text === 'لا' ? 10 : text.length * 10,
  ascent: 12, descent: 3, underlineOffset: 1, underlineThickness: 1, strikeOffset: -4, strikeThickness: 1,
  ...(style.caretOffsets ? { caretAdvances: style.caretOffsets.map(index => index * 5) } : {}) });

it.each([
  ['underlines', { underline: true, underlineStyle: 'single' }],
  ['backgrounds', { highlight: 'yellow' }],
  ['strikes', { strikethrough: 'single' }],
])('uses final ligature advances for %s instead of isolated prefix widths', (key, decoration) => {
  const p = paragraph('');
  p.runs = [{ ...RUN_FORMAT, text: 'ل', rtl: true, ...decoration }, { ...RUN_FORMAT, text: 'ا', rtl: true }];
  const snapshot = structuredClone(p), line = layoutDocument([p], measure).lines[0], fragment = line.fragments[0];
  expect(line[key]).toHaveLength(1);
  expect(line[key][0]).toMatchObject({ x: fragment.x + 5, width: 5 });
  expect(p).toEqual(snapshot);
});

it('splits a logical decoration across separate visual fragments without including intervening text', () => {
  const p = paragraph('');
  p.runs = [{ ...RUN_FORMAT, text: 'א', rtl: true, highlight: 'yellow' }, { ...RUN_FORMAT, text: 'B', rtl: true, highlight: 'yellow' }, { ...RUN_FORMAT, text: 'ג', rtl: true }];
  const line = layoutDocument([p], (text) => ({ width: text.length * 10, ascent: 12, descent: 3 })).lines[0];
  expect(line.backgrounds.reduce((sum, b) => sum + b.width, 0)).toBe(20);
  const unmarked = line.fragments.find(f => f.text === 'ג');
  expect(line.backgrounds.every(b => b.x + b.width <= unmarked.x || b.x >= unmarked.x + unmarked.width)).toBe(true);
});
