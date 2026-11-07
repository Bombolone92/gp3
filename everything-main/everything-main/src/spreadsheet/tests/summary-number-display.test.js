// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';
import { createStatusBar } from '../src/ui/statusbar.js';
import { openColumnStats } from '../src/ui/colstats.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it.each([
  [1e-12, 1e-12, '2E-12', '1E-12'],
  [1e305, 1e305, '2E+305', '1E+305'],
  [0.1, 0.2, '0.3', '0.15'],
  [1e308, 1e308, '#NUM!', '1E+308'],
])('displays accurate selection and column summaries for %s and %s', (a, b, sum, avg) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: a } }, { r: 1, c: 0, cell: { v: b } }]);
  const range = { r1: 0, c1: 0, r2: 1, c2: 0 };
  const ctx = { wb, sheetId: () => id, subscribe: () => () => {}, grid: { range, selection: S.fromRange(range), zoom: 1 } };
  const status = createStatusBar(ctx);
  document.querySelector('#app').append(status.el);
  expect.soft([...status.el.querySelectorAll('.status-item')].map((node) => node.textContent)).toEqual(expect.arrayContaining([`Sum: ${sum}`, `Average: ${avg}`]));
  status.destroy();
  const modal = openColumnStats(ctx, 0);
  const stats = Object.fromEntries([...modal.panel.querySelectorAll('.stat')].map((node) => [node.querySelector('.stat-label').textContent, node.querySelector('.stat-value').textContent]));
  expect(stats.Sum).toBe(sum);
  expect(stats.Average).toBe(avg);
  expect(stats.Median).toBe(avg);
});
