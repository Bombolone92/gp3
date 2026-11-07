import { it, expect } from 'vitest';
import { createParagraphPaginator, paginateParagraphs } from '../src/engine/pagination.js';
import { layoutDocument } from '../src/engine/layout.js';
import { paragraph } from '../src/engine/model.js';

const page = { top: 10, bottom: 10, height: 100 };
const line = (index, extra = {}) => ({ start: index, end: index + 1, paragraphId: 'p', height: 10, baseline: 8, ...extra });
const block = lines => ({ lines, format: { spaceBefore: 0, spaceAfter: 0, keepLines: false, keepNext: false, widowControl: false } });

it('reserves final paragraph after-spacing inside cells while retaining body-page suppression', () => {
  const value = block([line(0), line(1, { paragraphEnd: true })]); value.format.spaceAfter = 6;
  const blocks = [value], original = structuredClone(blocks), paginate = createParagraphPaginator();
  const body = paginate(blocks, page, 10, 65);
  expect(body.lines.map(l => l.page)).toEqual([0, 0]); expect(body.endY).toBe(90);
  const cell = paginate(blocks, { ...page, tableDepth: 1 }, 10, 65);
  expect(cell.lines.map(l => l.page)).toEqual([0, 1]); expect(cell.endY).toBe(28);
  expect(cell.lines.at(-1).paragraphAfter).toBe(8);
  expect(paginate(blocks, page, 10, 65)).toEqual(body); expect(blocks).toEqual(original);
});

it('suppresses contextual after-spacing between matching cell paragraph styles before testing the page cut', () => {
  const first = block([line(0), line(1, { paragraphEnd: true })]), next = block([line(2, { paragraphId: 'next', paragraphEnd: true })]);
  first.styleId = next.styleId = 'Normal'; first.format.spaceAfter = 6; first.format.contextualSpacing = true;
  const result = paginateParagraphs([first, next], { ...page, tableDepth: 1 }, 10, 65);
  expect(result.lines.map(l => l.page)).toEqual([0, 0, 1]);
  expect(result.lines[1].paragraphAfter).toBe(0);
});

it('reflows the same measured paragraph through new physical fragments without changing its natural size', () => {
  const blocks = [block(Array.from({ length: 7 }, (_, i) => line(i)))], source = structuredClone(blocks);
  const paginate = createParagraphPaginator();
  const natural = paginate(blocks, { ...page, height: 1000 }, 10);
  expect(natural).toMatchObject({ pageCount: 1, endY: 80 });
  const split = paginate(blocks, { ...page, cellFragments: [{ top: 10, bottom: 40 }, { top: 20, bottom: 60 }] }, 10);
  expect(split.lines.map(l => [l.page, l.y])).toEqual([[0, 10], [0, 20], [0, 30], [1, 20], [1, 30], [1, 40], [1, 50]]);
  expect(paginate(blocks, { ...page, height: 1000 }, 10)).toEqual(natural);
  expect(blocks).toEqual(source);
});

it('keeps authored-break spacing distinct when compatibility changes for reused measured blocks', () => {
  const value = block([line(0, { end: 0, hardBreak: 'page' }), line(1)]);
  value.leadingFlowBreaks = 1; value.format.spaceBefore = 12;
  const blocks = [value], paginate = createParagraphPaginator();
  for (const suppressed of [false, true, false, true]) {
    const result = paginate(blocks, { ...page, suppressSpBfAfterPgBrk: suppressed }, 10);
    expect(result.lines.at(-1)).toMatchObject({ page: 1, y: suppressed ? 10 : 26 });
  }
});

it('keeps standalone pagination calls fresh after their measured input changes', () => {
  const blocks = [block([line(0)])];
  expect(paginateParagraphs(blocks, page, 10).endY).toBe(20);
  blocks[0].lines[0].height = 25;
  blocks[0].format.spaceBefore = 6;
  expect(paginateParagraphs(blocks, page, 10).endY).toBe(43);
});

const measure = text => ({ width: [...text].length * 8, ascent: 12, descent: 4 });
const families = p => layoutDocument([p], measure).lines.flatMap(line => line.fragments.map(fragment => [fragment.text, fragment.fontFamily]));

it('selects the font for each grapheme while reusing the surrounding run format', () => {
  const p = paragraph('', { runs: [
    { text: 'A中B', fontAscii: 'Arial', fontEastAsia: 'SimSun' },
    { text: 'É中', fontHAnsi: 'Georgia', fontEastAsia: 'MS Gothic' },
  ] });
  expect(families(p)).toEqual([['A', 'Arial'], ['中', 'SimSun'], ['B', 'Arial'], ['É', 'Georgia'], ['中', 'MS Gothic']]);
});

it('retains the base character format across run boundaries and refreshes it after editing', () => {
  const p = paragraph('', { runs: [
    { text: 'A', fontAscii: 'Arial' },
    { text: '\u0301中B', fontAscii: 'Courier New', fontEastAsia: 'MS Gothic' },
  ] });
  expect(families(p)).toEqual([['A\u0301', 'Arial'], ['中', 'MS Gothic'], ['B', 'Courier New']]);
  p.runs[0].fontAscii = 'Georgia'; p.runs[1].fontEastAsia = 'SimSun';
  expect(families(p)).toEqual([['A\u0301', 'Georgia'], ['中', 'SimSun'], ['B', 'Courier New']]);
});
