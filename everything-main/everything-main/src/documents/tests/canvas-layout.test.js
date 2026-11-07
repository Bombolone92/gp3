import { describe, it, expect } from 'vitest';
import { paragraph, TextDocument } from '../src/engine/model.js';
import { PAGE, layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';

const measure = (text, style) => ({ width: [...text].length * (style.bold ? 10 : 8) * style.fontSize / 12, ascent: 19 * style.fontSize / 12, descent: 7 * style.fontSize / 12, underlineOffset: 2, underlineThickness: 1 });
describe('canvas layout and document positions', () => {
  it('lays out two paragraphs with different source ranges and hits the drawn caret', () => {
    const layout = layoutDocument([paragraph('First'), paragraph('Second')], measure);
    expect(layout.lines.map(l => [l.start, l.end])).toEqual([[0, 5], [6, 12]]);
    const caret = caretRect(layout, 9);
    expect(hitTest(layout, caret.page, caret.x, caret.y + 10)).toBe(9);
    expect(selectionRects(layout, 2, 9)).toHaveLength(2);
  });
  it('repaginates forward and backward as text is inserted and removed', () => {
    const doc = new TextDocument([paragraph('word '.repeat(1500))]);
    const before = layoutDocument(doc.paragraphs, measure);
    expect(before.pageCount).toBeGreaterThan(1);
    for (const line of before.lines) {
      expect(line.y).toBeGreaterThanOrEqual(PAGE.margin);
      expect(line.y + PAGE.lineHeight).toBeLessThanOrEqual(PAGE.height - PAGE.margin);
    }
    doc.select(0, doc.text.length); doc.replace('Short');
    expect(layoutDocument(doc.paragraphs, measure).pageCount).toBe(1);
    doc.undo(); expect(layoutDocument(doc.paragraphs, measure).pageCount).toBe(before.pageCount);
  });
  it('puts the caret on the following line at a soft wrap and paints selection on both pages', () => {
    const layout = layoutDocument([paragraph('word '.repeat(1500))], measure);
    const firstOnSecond = layout.lines.find(l => l.page === 1);
    expect(caretRect(layout, firstOnSecond.start).page).toBe(1);
    const rects = selectionRects(layout, firstOnSecond.start - 10, firstOnSecond.start + 10);
    expect(new Set(rects.map(r => r.page))).toEqual(new Set([0, 1]));
  });
  it('never puts a caret inside a grapheme spanning formatting runs', () => {
    const p = paragraph('', { runs: [{ text: 'e', bold: false }, { text: '\u0301x', bold: true }] });
    const line = layoutDocument([p], measure).lines[0];
    expect(line.stops.map(s => s.offset)).toEqual([0, 2, 3]);
  });
  it('can keep End and pointer placement on the trailing edge of a wrapped line', () => {
    const layout = layoutDocument([paragraph('word '.repeat(100))], measure);
    const first = layout.lines[0];
    expect(caretRect(layout, first.end, 'backward').y).toBe(first.y);
    expect(caretRect(layout, first.end, 'forward').y).toBe(layout.lines[1].y);
  });
});

describe('formatted paragraph geometry', () => {
  it('moves drawing, hit targets, selection and empty-paragraph carets together for alignment', () => {
    for (const [alignment, expectedX] of [['left', 96], ['center', 388], ['right', 680]]) {
      const layout = layoutDocument([paragraph('Hello', { format: { alignment } })], measure);
      const line = layout.lines[0];
      expect(line.fragments[0].x).toBe(expectedX);
      expect(caretRect(layout, 0).x).toBe(expectedX);
      expect(hitTest(layout, 0, expectedX + 16, line.y + 8)).toBe(2);
      expect(selectionRects(layout, 1, 4)[0]).toMatchObject({ x: expectedX + 8, width: 24 });
    }
    const empty = layoutDocument([paragraph('', { format: { alignment: 'right' } })], measure);
    expect(caretRect(empty, 0).x).toBe(PAGE.width - PAGE.margin);
  });
  it('uses line multiples and collapses adjacent before/after spacing rather than adding it', () => {
    const layout = layoutDocument([
      paragraph('First', { format: { lineSpacing: 2, spaceBefore: 6, spaceAfter: 18 } }),
      paragraph('Second', { format: { spaceBefore: 12, spaceAfter: 0 } }),
    ], measure);
    expect(layout.lines[0]).toMatchObject({ y: 104, height: 52 });
    expect(layout.lines[1]).toMatchObject({ y: 180, height: 26 });
    expect(caretRect(layout, 2).height).toBe(26);
    expect(selectionRects(layout, 0, 8).map(r => r.height)).toEqual([52, 26]);
    // A point inside the tall first line stays in that line, even near its bottom edge.
    expect(hitTest(layout, 0, 96, 155)).toBe(0);
  });
  it('supports imported exact and minimum point-based line heights', () => {
    const layout = layoutDocument([
      paragraph('Exact', { format: { lineRule: 'exact', lineSpacing: 30 } }),
      paragraph('Minimum', { format: { lineRule: 'atLeast', lineSpacing: 12 } }),
    ], measure);
    expect(layout.lines.map(l => l.height)).toEqual([40, 26]);
  });
  it('repaginates spacing changes and restores identical page geometry with undo', () => {
    const doc = new TextDocument([paragraph('Start'), paragraph('word '.repeat(800))]);
    const before = layoutDocument(doc.paragraphs, measure);
    expect(before.pageCount).toBe(2);
    doc.select(0, doc.text.length); doc.setParagraphFormat({ lineSpacing: 2, spaceBefore: 12, spaceAfter: 18 });
    const after = layoutDocument(doc.paragraphs, measure);
    expect(after.pageCount).toBeGreaterThan(2);
    // Native bottom-line controls allow trailing automatic leading past the
    // margin. This fixture's metric stub has a 26 px natural extent and a
    // 52 px double-spaced advance; only the natural extent must fit.
    for (const line of after.lines) {
      expect(line.height).toBe(52);
      expect(line.y + 26).toBeLessThanOrEqual(PAGE.height - PAGE.margin);
    }
    expect(after.lines.some(line => line.y + line.height > PAGE.height - PAGE.margin)).toBe(true);
    const boundary = after.lines.find(l => l.page === 1);
    expect(caretRect(after, boundary.start).page).toBe(1);
    expect(caretRect(after, boundary.start, 'backward').page).toBe(0);
    expect(new Set(selectionRects(after, boundary.start - 3, boundary.start + 3).map(r => r.page))).toEqual(new Set([0, 1]));
    doc.undo(); expect(layoutDocument(doc.paragraphs, measure)).toEqual(before);
  });
  it('does not create an empty page for trailing paragraph spacing', () => {
    const layout = layoutDocument([paragraph('Last', { format: { spaceAfter: 600 } })], measure);
    expect(layout.pageCount).toBe(1);
  });
});

describe('mixed-size text geometry', () => {
  it('aligns differently sized runs on one baseline and gives each run the correct caret height', () => {
    const p = paragraph('', { runs: [{ text: 'Small ', fontSize: 12 }, { text: 'Large', fontSize: 24, italic: true, underline: true }] });
    const layout = layoutDocument([p], measure), line = layout.lines[0];
    expect(line.height).toBe(52);
    expect(line.baseline).toBe(line.y + 38);
    expect(caretRect(layout, 2)).toMatchObject({ y: line.baseline - 19, height: 26 });
    expect(caretRect(layout, 8)).toMatchObject({ y: line.baseline - 38, height: 52 });
    expect(hitTest(layout, 0, caretRect(layout, 8).x, line.y + 5)).toBe(8);
    expect(line.underlines[0]).toMatchObject({ x: 144, width: 80 });
  });
  it('uses exact-height baselines for text; atLeast grows to fit', () => {
    const runs = [{ text: 'Tall', fontSize: 24 }];
    const exact = layoutDocument([paragraph('', { runs, format: { lineRule: 'exact', lineSpacing: 12 } })], measure);
    expect(exact.lines[0]).toMatchObject({ height: 16, clip: true, baseline: PAGE.margin + 12.8 });
    expect(caretRect(exact, 2)).toMatchObject({ y: PAGE.margin, height: 16 });
    const minimum = layoutDocument([paragraph('', { runs, format: { lineRule: 'atLeast', lineSpacing: 12 } })], measure);
    expect(minimum.lines[0]).toMatchObject({ height: 52, clip: false });
  });
  it('keeps typography shaping groups intact across underline boundaries', () => {
    const p = paragraph('', { runs: [{ text: 'f', fontSize: 24 }, { text: 'i', fontSize: 24, underline: true }] });
    const line = layoutDocument([p], measure).lines[0];
    expect(line.fragments).toHaveLength(1);
    expect(line.fragments[0].text).toBe('fi');
    expect(line.underlines[0]).toMatchObject({ x: 112, width: 16 });
  });
  it('changes wrapping and pagination when font size grows and restores geometry on undo', () => {
    const doc = new TextDocument([paragraph('word '.repeat(500))]);
    const old = layoutDocument(doc.paragraphs, measure);
    doc.select(0, doc.text.length); doc.setRunFormat({ fontSize: 24 });
    const next = layoutDocument(doc.paragraphs, measure);
    expect(next.pageCount).toBeGreaterThan(old.pageCount);
    expect(next.lines[0].end).toBeLessThan(old.lines[0].end);
    doc.undo(); expect(layoutDocument(doc.paragraphs, measure)).toEqual(old);
  });
});
