import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { squareIntervals } from '../src/engine/square-wrap.js';
import { TextDocument } from '../src/engine/model.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const measure = text => ({ width: text.length * 8, ascent: 12, descent: 4 });
const render = d => layoutDocument(d.paragraphs, measure, pageGeometry(d.pageSettings), d.numbering, d.tables, d.pageStories);
const open = () => DocxPackage.open(readFileSync('public/fixtures/square-wrap-flow.docx'));

it('flows beside numeric square anchors across paragraphs and restores full width below them', async () => {
  const pkg = await open(), layout = render(pkg);
  expect(layout.pageCount).toBe(4);
  const frame = layout.floatingObjects.find(f => f.page === 3);
  const next = layout.lines.filter(l => l.page === 3 && l.y > frame.y && l.y < frame.y + frame.height);
  expect(next.length).toBeGreaterThan(0);
  for (const line of next) expect(line.stops[0].x).toBeCloseTo(frame.x + frame.width + 12);
  const below = layout.lines.find(l => l.page === 3 && l.y >= frame.y + frame.height);
  expect(below.stops[0].x).toBe(48);
});

it('keeps two text intervals on one baseline and selects each interval without filling the obstacle', async () => {
  const layout = render(await open()), line = layout.lines.find(l => l.page === 2 && l.wrapSegments);
  expect(line.wrapSegments).toHaveLength(2);
  const [left, right] = line.wrapSegments, boundary = right.start;
  expect(caretRect(layout, boundary).x).toBe(right.stops[0].x);
  expect(caretRect(layout, boundary, 'backward').x).toBe(left.stops.at(-1).x);
  expect(hitTest(layout, line.page, right.stops[1].x, line.y + 2)).toBe(right.stops[1].offset);
  const rects = selectionRects(layout, left.start + 1, right.end);
  expect(rects).toHaveLength(2);
  expect(rects[0].x + rects[0].width).toBeLessThan(right.stops[0].x);
  expect(rects[1].x).toBe(right.stops[0].x);
});

it('repaginates changed text and restores identical wrapping on undo', async () => {
  const pkg = await open(), d = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const before = render(d);
  d.select(0); d.replace('Added words '.repeat(25));
  const changed = render(d);
  expect(changed.lines.length).toBeGreaterThan(before.lines.length);
  d.undo(); expect(render(d)).toEqual(before);
});

it('moves a fully obstructed line below the picture without moving its paragraph anchor', async () => {
  const pkg = await open();
  const p = pkg.paragraphs.find(p => p.runs.some(r => r.image));
  const image = p.runs.find(r => r.image).image;
  image.width = 288 * 12700;
  const layout = render(pkg), frame = layout.floatingObjects[0];
  const first = layout.lines.find(l => l.paragraphId === p.id);
  expect(frame.y).toBe(72);
  expect(first.wrapBefore).toBe(frame.height);
  expect(first.baseline).toBeGreaterThan(frame.y + frame.height);
});

it('retains exact line height when fonts differ between the two text intervals', async () => {
  const pkg = await open(), p = pkg.paragraphs.find(p => p.runs.some(r => r.image?.anchor.x === 108 * 12700));
  p.runs = p.runs.flatMap(r => r.image ? [r] : [{ ...r, text: r.text.slice(0, 12), fontSize: 8 }, { ...r, text: r.text.slice(12), fontSize: 20 }]);
  const layout = layoutDocument(pkg.paragraphs, (t, s) => ({ width: t.length * 7, ascent: s.fontSize, descent: s.fontSize / 3 }), pageGeometry(pkg.pageSettings));
  const rows = layout.lines.filter(l => l.paragraphId === p.id && l.wrapSegments);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.height).toBe(24);
    expect(row.baseline-row.y).toBeCloseTo(19.2);
  }
});

it.each([
  ['bothSides', [{ left: 0, right: 30 }, { left: 60, right: 100 }]],
  ['left', [{ left: 0, right: 30 }]],
  ['right', [{ left: 60, right: 100 }]],
  ['largest', [{ left: 60, right: 100 }]],
])('respects %s text wrapping and excludes only intersecting pages and vertical bands', (side, expected) => {
  const exclusions = [{ left: 30, right: 60, top: 10, bottom: 30, page: 0, side }];
  expect(squareIntervals(0, 100, 10, 10, 0, exclusions).intervals).toEqual(expected);
  expect(squareIntervals(0, 100, 30, 10, 0, exclusions).intervals).toEqual([{ left: 0, right: 100 }]);
  expect(squareIntervals(0, 100, 10, 10, 1, exclusions).intervals).toEqual([{ left: 0, right: 100 }]);
});

it('unions overlapping exclusions and supplies a vertical escape for a completely obstructed line', () => {
  const a = { left: 0, right: 60, top: 0, bottom: 20, page: 0, side: 'bothSides' };
  const b = { ...a, left: 40, right: 100, bottom: 30 };
  expect(squareIntervals(0, 100, 0, 10, 0, [a, b])).toEqual({ intervals: [], nextY: 20 });
  expect(squareIntervals(0, 100, 20, 10, 0, [a, b]).intervals).toEqual([{ left: 0, right: 40 }]);
});

it('clears a floating table for an intact word but uses narrow intervals for short words', async () => {
  const p=await DocxPackage.open(readFileSync('tests/fixtures/table-overlap/words.docx')),l=render(p);
  const short=l.lines.filter(line=>line.page===0&&!line.cellId).slice(1),long=l.lines.filter(line=>line.page===1&&!line.cellId).slice(1);
  const shortFrame=l.floatingTables.find(f=>f.page===0),longFrame=l.floatingTables.find(f=>f.page===1);
  expect(short[0].baseline).toBeLessThan(shortFrame.bottom);expect(short[0].stops[0].x).toBeGreaterThan(shortFrame.right);
  expect(long).toHaveLength(1);expect(long[0].baseline).toBeGreaterThan(longFrame.bottom);expect(long[0].stops[0].x).toBe(96);
  const c=caretRect(l,long[0].start);expect(hitTest(l,c.page,c.x,c.y+c.height/2)).toBe(long[0].start);
});

it('clears before breaking a word wider than the full paragraph and retains all characters', async () => {
  const p=await DocxPackage.open(readFileSync('tests/fixtures/table-overlap/words.docx')),l=render(p);
  const lines=l.lines.filter(line=>line.page===3&&!line.cellId).slice(1),frame=l.floatingTables.find(f=>f.page===3);
  expect(lines.length).toBeGreaterThan(1);expect(lines[0].baseline).toBeGreaterThan(frame.bottom);
  expect(lines.every(line=>line.stops[0].x===96)).toBe(true);
  expect(lines.flatMap(line=>line.fragments.map(f=>f.text)).join('')).toBe('Longunbrokenword'.repeat(10));
});
