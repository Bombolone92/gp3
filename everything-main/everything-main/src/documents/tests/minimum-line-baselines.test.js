import { it, expect } from 'vitest';
import { paragraph } from '../src/engine/model.js';
import { layoutDocument, hitTest } from '../src/engine/layout.js';

const measure = (text, style) => ({ width: text.length * 6, ascent: style.fontSize, descent: style.fontSize / 4 });
const make = (lineRule, lineSpacing, runs = [{ text: 'First\vSecond', fontSize: 12 }]) => paragraph('', {
  runs, markFormat: { fontSize: 12 }, format: { lineRule, lineSpacing, spaceBefore: 0, spaceAfter: 0 },
});

it('places spare minimum-line height above the text on every line', () => {
  const layout = layoutDocument([make('atLeast', 24)], measure);
  expect(layout.lines.map(l => [l.y, l.height, l.baseline])).toEqual([[96, 32, 125], [128, 32, 157]]);
  for (const line of layout.lines) expect(hitTest(layout, line.page, line.stops[0].x + .1, line.y + line.height / 2)).toBe(line.start);
});

it('expands a small minimum for mixed text sizes without clipping or centering', () => {
  const layout = layoutDocument([make('atLeast', 6, [{ text: 'Small', fontSize: 12 }, { text: 'Tall', fontSize: 24 }])], measure);
  expect(layout.lines[0]).toMatchObject({ y: 96, height: 30, baseline: 120, clip: false });
});

it('retains automatic and exact baseline rules', () => {
  expect(layoutDocument([make('auto', 1)], measure).lines[0]).toMatchObject({ height: 15, baseline: 108 });
  expect(layoutDocument([make('exact', 24)], measure).lines[0]).toMatchObject({ height: 32, baseline: 121.6 });
});
