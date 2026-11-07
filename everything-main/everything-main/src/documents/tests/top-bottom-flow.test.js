import { it, expect } from 'vitest';
import { paginateParagraphs } from '../src/engine/pagination.js';

const page = { width: 200, height: 100, top: 0, bottom: 0, left: 0, right: 0, compatibilityMode: 15 };
const block = (id, heights, props = {}, bands) => ({
  format: { spaceBefore: 0, spaceAfter: 0, widowControl: false, ...props },
  lines: heights.map((height, i) => ({ paragraphId: id, start: id * 100 + i, end: id * 100 + i + 1,
    paragraphEnd: i === heights.length - 1, baseline: 8, height, fitHeight: height,
    ...(i === 0 && bands ? { topBottomBands: bands } : {}), fragments: [], stops: [] })),
});
const run = (blocks, geometry = page) => paginateParagraphs(blocks, geometry, 20);

it('uses space above a following band and clears only intersecting lines', () => {
  const result = run([block(1, [10], {}, [[40, 80]]), block(2, [10]), block(3, [20])]);
  expect(result.lines.map(l => l.baseline)).toEqual([8, 18, 28]);
  const cleared = run([block(1, [10], {}, [[40, 80]]), block(2, [10]), block(3, [21])]);
  expect(cleared.lines[1].baseline).toBe(18);
  expect(cleared.lines[2].page).toBe(1); // A 21px line cannot fit below the band on page 0.
  expect(cleared.lines[2].baseline).toBe(8);
});

it('checks the paragraph before-gap against a thin band and reapplies it after clearance', () => {
  const result = run([block(1, [10], {}, [[14.4, 14.5]]), block(2, [10], { spaceBefore: 8.25 })]);
  expect(result.lines[1].baseline).toBeCloseTo(14.5 + 11 + 8, 8);
});

it('clears overlapping bands without displacing the anchor origin', () => {
  const result = run([block(1, [10], {}, [[10, 20], [15, 35]]), block(2, [10])]);
  expect(result.lines[0].y).toBe(0);
  expect(result.lines[1].baseline).toBe(43);
});

it('keeps exclusions on their original page after an explicit page break', () => {
  const result = run([block(1, [10], {}, [[40, 80]]), block(2, [10], { pageBreakBefore: true })]);
  expect(result.lines[1]).toMatchObject({ page: 1, baseline: 8 });
});

it('includes wrapping clearance when deciding a keepNext chain', () => {
  const result = run([block(1, [10], {}, [[40, 70]]), block(2, [10], { keepNext: true }), block(3, [30])], { ...page, height: 90 });
  expect(result.lines.filter(l => l.paragraphId !== 1).map(l => l.page)).toEqual([1, 1]);
});

it('includes wrapping clearance when deciding keepLines', () => {
  const result = run([block(1, [20], {}, [[30, 50]]), block(2, [10, 10, 10, 10], { keepLines: true })], { ...page, height: 75 });
  expect(result.lines.filter(l => l.paragraphId === 2).map(l => l.page)).toEqual([1, 1, 1, 1]);
});

it('retains the occupied band extent at the end of a region', () => {
  const result = run([block(1, [10], {}, [[40, 80]])]);
  expect(result.lines[0].height).toBe(10);
  expect(result.endY).toBe(80);
});

it('does not alter measured lines or accumulate clearance across pagination calls', () => {
  const blocks = [block(1, [10], {}, [[14.4, 14.5]]), block(2, [10], { spaceBefore: 8.25 })];
  const snapshot = structuredClone(blocks), first = run(blocks);
  expect(run(blocks)).toEqual(first);
  expect(blocks).toEqual(snapshot);
});

it('does not restore contextually suppressed before-spacing when clearing a band', () => {
  const result = run([block(1, [10], {}, [[14.4, 14.5]]),
    block(2, [10], { spaceBefore: 8.25, contextualSpacing: true })]);
  expect(result.lines[1].baseline).toBeCloseTo(14.5 + 8, 8);
});
