// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openColumnStats } from '../src/ui/colstats.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

// The distribution was a row of empty bars with tooltips only, so a screen reader passed over it.
it('describes the distribution in words, bucket by bucket', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 20; r++) wb.setInput(id, r, 0, String(r * r));
  const modal = openColumnStats({ wb, sheetId: () => id }, 0);
  const hist = modal.panel.querySelector('.hist');
  expect(hist.getAttribute('role')).toBe('img');
  const label = hist.getAttribute('aria-label');
  expect(label).toMatch(/^Distribution: /);
  const bars = [...hist.querySelectorAll('.hist-bar')];
  expect(bars.length).toBeGreaterThan(1);
  for (const bar of bars) expect(label).toContain(bar.title);
});
