import { it, expect } from 'vitest';
import { paragraph } from '../src/engine/model.js';
import { RUN_FORMAT } from '../src/engine/formatting.js';
import { layoutDocument, hitTest, hitTestStop, caretRect } from '../src/engine/layout.js';

const measure = text => ({ width: [...text].length * 10, ascent: 12, descent: 3 });

it('retains both visual positions of a shared mixed-direction offset', () => {
  const p = paragraph('');
  p.runs = [{ ...RUN_FORMAT, text: 'Left ' }, { ...RUN_FORMAT, text: 'אבג', rtl: true }, { ...RUN_FORMAT, text: ' Right' }];
  const layout = layoutDocument([p], measure), line = layout.lines[0];
  const boundary = line.stops.filter(s => s.offset === 5);
  expect(new Set(boundary.map(s => s.x)).size).toBe(2);
  for (const stop of boundary) {
    const hit = hitTestStop(layout, 0, stop.x, line.y + line.height / 2);
    expect(hitTest(layout, 0, stop.x, line.y + line.height / 2)).toBe(hit.offset);
    expect(caretRect(layout, hit.offset, hit.affinity).x).toBe(stop.x);
  }
});

it('preserves numeric hit testing for plain text and empty layouts', () => {
  const layout = layoutDocument([paragraph('Alpha')], measure), line = layout.lines[0];
  for (const stop of line.stops) {
    expect(hitTestStop(layout, 0, stop.x, line.y + 1).offset).toBe(stop.offset);
    expect(hitTest(layout, 0, stop.x, line.y + 1)).toBe(stop.offset);
  }
  const empty = { ...layout, lines: [] };
  expect(hitTestStop(empty, 0, 0, 0)).toEqual({ offset: 0 });
  expect(hitTest(empty, 0, 0, 0)).toBe(0);
});
