import { it, expect } from 'vitest';
import { paragraph, TextDocument } from '../src/engine/model.js';
import { measurePageStory } from '../src/engine/page-story-measure.js';
import { pageStoryPositions, pageStorySelectionLayout } from '../src/engine/page-story-positions.js';
import { caretRect, hitTestStop, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

const measure = text => ({ width: text.length * 7, ascent: 12, descent: 4 });
const path = 'word/footer.xml';
function setup(number, generalFormat, suffix = ' after', geometry = {}) {
  const p = paragraph('Before '), format = p.runs[0];
  p.runs.push({ ...format, text: '\ufffc', field: { type: 'PAGE', generalFormat, cachedText: '99' } }, { ...format, text: suffix });
  const d = new TextDocument([p, paragraph('Second paragraph')]);
  const result = measurePageStory({ paragraphs: d.paragraphs, tables: d.tables }, { ...pageGeometry(d.pageSettings), ...geometry }, measure, d.numbering, { pageNumber: number, pageCount: 100, sectionPageCount: 100 });
  const { placed, positions } = result;
  const stories = { lines: placed.lines.map(line => ({ ...line, pageStory: path })), cells: [], floatingObjects: [], positions: [{ path, page: 0, positions }] };
  return { d, placed, stories, selection: pageStorySelectionLayout(placed, stories, path, 0) };
}

it.each([[9, undefined, '9'], [10, undefined, '10'], [88, 'upperRoman', 'LXXXVIII'], [28, 'upperLetter', 'BB']])('maps page %s (%s) to one editable position', (number, mode, printed) => {
  const { d, placed, selection } = setup(number, mode);
  expect(placed.lines[0].fragments.map(f => f.text).join('')).toBe('Before ' + printed + ' after');
  expect(selection.lines[0].end).toBe('Before \ufffc after'.length);
  expect(selection.lines[1].start).toBe('Before \ufffc after\n'.length);
  const before = caretRect(selection, 7), after = caretRect(selection, 8);
  expect(after.x - before.x).toBe(printed.length * 7);
  expect(hitTestStop(selection, 0, before.x + 1, before.y + 1).offset).toBe(7);
  expect(hitTestStop(selection, 0, after.x - 1, after.y + 1).offset).toBe(8);
  expect(selectionRects(selection, 7, 8)[0].width).toBe(printed.length * 7);
  d.select(hitTestStop(selection, 0, after.x, after.y + 1).offset); d.replace('INSERT');
  expect(d.text).toBe('Before \ufffcINSERT after\nSecond paragraph');
  d.undo(); expect(d.text).toBe('Before \ufffc after\nSecond paragraph');
});

it('does not mutate the display geometry or allow another story/page to supply selection offsets', () => {
  const { placed, stories } = setup(88, 'upperRoman'), before = structuredClone(stories);
  const selected = pageStorySelectionLayout(placed, stories, path, 0);
  expect(stories).toEqual(before);
  for (let i = 0; i < placed.lines.length; i++) {
    expect(selected.lines[i].fragments.map(f => [f.text, f.x, f.width])).toEqual(placed.lines[i].fragments.map(f => [f.text, f.x, f.width]));
  }
  expect(() => pageStorySelectionLayout(placed, stories, path, 1)).toThrow('not laid out');
  expect(() => pageStorySelectionLayout(placed, stories, 'word/header.xml', 0)).toThrow('not laid out');
});

it('uses UTF-16 source offsets after a field followed by a joined emoji', () => {
  const { selection, d } = setup(100, undefined, '👩‍💻 end');
  const line = selection.lines[0];
  expect(line.end).toBe(d.paragraphs[0].runs.map(r => r.text).join('').length);
  expect(line.stops.some(s => s.offset === 13)).toBe(true);
  for (const offset of [9, 10, 11, 12]) expect(line.stops.some(s => s.offset === offset)).toBe(false);
});

it('selects every printed piece of a wrapped field as the same atomic token', () => {
  const { selection, placed } = setup(88, 'upperRoman', ' after', { width: 35, left: 0, right: 0 });
  expect(placed.lines.length).toBeGreaterThan(2);
  const rects = selectionRects(selection, 7, 8);
  expect(rects.length).toBeGreaterThan(1);
  expect(rects.reduce((sum, r) => sum + r.width, 0)).toBe(8 * 7);
  for (const line of selection.lines) for (const stop of line.stops) expect(Number.isInteger(stop.offset)).toBe(true);
});

it('keeps both keyboard boundaries of empty field results at the same visual position', () => {
  const source = [paragraph('')], displayed = [paragraph('AB')];
  const format = displayed[0].runs[0];
  source[0].runs = [{ ...format, text: 'A' }, { ...format, text: '\ufffc', field: {} }, { ...format, text: '\ufffc', field: {} }, { ...format, text: 'B' }];
  displayed[0].runs = source[0].runs.map(r => ({ ...r, text: r.field ? '' : r.text }));
  const positions = pageStoryPositions(source, displayed);
  const body = { page: { width: 100 }, lines: [] };
  const lines = [{ page: 0, pageStory: path, start: 0, end: 2, paragraphEnd: true, x: 0, y: 0, height: 16, baseline: 12, ascent: 12, descent: 4,
    fragments: [{ text: 'AB', start: 0, end: 2, x: 0, width: 14, ascent: 12, descent: 4 }], stops: [{ offset: 0, x: 0 }, { offset: 1, x: 7 }, { offset: 2, x: 14 }] }];
  const selected = pageStorySelectionLayout(body, { lines, positions: [{ path, page: 0, positions }] }, path, 0);
  expect(selected.lines[0].stops.map(s => s.offset)).toEqual([0, 1, 2, 3, 4]);
  for (const offset of [1, 2, 3]) expect(caretRect(selected, offset).x).toBe(7);
});
