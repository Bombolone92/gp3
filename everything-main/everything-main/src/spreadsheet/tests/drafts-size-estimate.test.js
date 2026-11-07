import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { saveDraft } from '../src/lib/drafts.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

it('declines a book that cannot fit without serializing it', () => {
  const wb = new Workbook({ sheets: [{ name: 'Big', rows: 250000, cols: 2, cells: Object.fromEntries(
    Array.from({ length: 240000 }, (_, r) => [`${r},0`, { v: r }]),
  ) }] });
  const toJSON = vi.spyOn(wb, 'toJSON');
  expect(saveDraft('k', wb, 'Big', 'r1')).toBe(false);
  expect(toJSON).not.toHaveBeenCalled();
  expect(localStorage.getItem('k')).toBe(null);
});

it('still drafts a book that fits', () => {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, 'hello');
  expect(saveDraft('k2', wb, 'Small', 'r1')).toBe(true);
  expect(JSON.parse(localStorage.getItem('k2')).workbook.sheets[0].cells['0,0'].v).toBe('hello');
});
