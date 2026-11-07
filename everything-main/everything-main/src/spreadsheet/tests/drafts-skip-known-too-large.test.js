import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { saveDraft } from '../src/lib/drafts.js';

// The draft is attempted 600 ms after every pause in editing. A book too large for local storage was
// serialized in full and then thrown away on each attempt, a fifth of a second of main-thread work for
// nothing on the very books where editing is already slow. What the last attempt measured now turns
// the next attempts away without serializing, until the book has shrunk enough to fit, by losing cells
// or by its cells growing shorter.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

// 60 000 cells of some fifty characters each: past the cap, yet under the floor of fourteen per cell that turns a book away untried.
const LONG = (r) => `a long enough text for row ${r} to overflow the draft`;
const book = (rows, text) => new Workbook({ sheets: [{ name: 'S', rows: rows + 5, cols: 3, cells: Object.fromEntries(Array.from({ length: rows }, (_, r) => [`${r},0`, { v: text(r) }])) }] });

it('serializes a book the last attempt found too large no more, until enough cells are gone', () => {
  const wb = book(60000, LONG);
  const id = wb.activeSheetId;
  const toJSON = vi.spyOn(wb, 'toJSON');
  expect(saveDraft('k', wb, 'Big', 'r1')).toBe(false);
  expect(toJSON).toHaveBeenCalledTimes(1);
  wb.setInput(id, 0, 1, 'edit');
  expect(saveDraft('k', wb, 'Big', 'r2')).toBe(false);
  wb.setInput(id, 1, 1, 'edit');
  expect(saveDraft('k', wb, 'Big', 'r3')).toBe(false);
  expect(toJSON).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('k')).toBe(null);
  // Half the cells gone, the book fits and is drafted.
  wb.clearRange(id, { r1: 0, c1: 0, r2: 34999, c2: 0 });
  expect(saveDraft('k', wb, 'Big', 'r4')).toBe(true);
  expect(toJSON).toHaveBeenCalledTimes(2);
  const draft = JSON.parse(localStorage.getItem('k'));
  expect(draft.workbook.sheets[0].cells['35000,0'].v).toBe(LONG(35000));
  expect(draft.workbook.sheets[0].cells['0,0']).toBe(undefined);
});

it('drafts a book again once its cells have grown shorter, though there are as many', () => {
  const wb = book(60000, LONG);
  const id = wb.activeSheetId;
  const toJSON = vi.spyOn(wb, 'toJSON');
  expect(saveDraft('k2', wb, 'Big', 'r1')).toBe(false);
  expect(saveDraft('k2', wb, 'Big', 'r2')).toBe(false);
  expect(toJSON).toHaveBeenCalledTimes(1);
  wb.setCells(id, Array.from({ length: 60000 }, (_, r) => ({ r, c: 0, cell: { v: r } })));
  expect(wb.sheets[0].cells.size).toBe(60000);
  expect(saveDraft('k2', wb, 'Big', 'r3')).toBe(true);
  expect(toJSON).toHaveBeenCalledTimes(2);
  expect(JSON.parse(localStorage.getItem('k2')).workbook.sheets[0].cells['59999,0'].v).toBe(59999);
});

it('keeps drafting a book that fits, and a book that grows past the cap is refused with one attempt', () => {
  const wb = book(20000, (r) => `row ${r}`);
  const id = wb.activeSheetId;
  const toJSON = vi.spyOn(wb, 'toJSON');
  expect(saveDraft('k3', wb, 'Fits', 'r1')).toBe(true);
  wb.setInput(id, 0, 1, 'edit');
  expect(saveDraft('k3', wb, 'Fits', 'r2')).toBe(true);
  expect(toJSON).toHaveBeenCalledTimes(2);
  wb.setCells(id, Array.from({ length: 20000 }, (_, r) => ({ r, c: 1, cell: { v: LONG(r) + LONG(r) } })));
  expect(saveDraft('k3', wb, 'Fits', 'r3')).toBe(false);
  expect(toJSON).toHaveBeenCalledTimes(3);
  wb.setInput(id, 0, 2, 'edit');
  expect(saveDraft('k3', wb, 'Fits', 'r4')).toBe(false);
  expect(toJSON).toHaveBeenCalledTimes(3);
  expect(JSON.parse(localStorage.getItem('k3')).revision).toBe('r2'); // the last draft that fit stays
});
