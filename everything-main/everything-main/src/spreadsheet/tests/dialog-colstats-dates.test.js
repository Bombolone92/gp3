// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { ymdToSerial } from '../src/core/format.js';
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

const d = (y, m, day) => ymdToSerial(y, m, day);

function open(col) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const columns = [
    ['When', [d(2026, 1, 1), d(2026, 1, 15), d(2026, 1, 15), d(2026, 3, 1)], { fmt: 'date' }],
    ['Amount', [10, 20, 30, 40], null],
    ['Due', [d(2026, 1, 1), d(2026, 2, 1), d(2026, 2, 1), d(2026, 3, 1)], { fmt: 'custom', code: 'dd/mm/yyyy' }],
    ['At', [0.25, 0.5, 0.5, 0.75], { fmt: 'time' }],
    ['Mixed', [d(2026, 1, 1), d(2026, 1, 2), 7, d(2026, 1, 4)], { fmt: 'date' }],
  ];
  const cells = [];
  columns.forEach(([header, values, style], c) => {
    cells.push({ r: 0, c, cell: { v: header } });
    values.forEach((v, i) => cells.push({ r: i + 1, c, cell: { v, s: style && !(header === 'Mixed' && v === 7) ? style : undefined } }));
  });
  wb.setCells(id, cells);
  const modal = openColumnStats({ wb, sheetId: () => id }, col);
  const stat = (label) => [...modal.panel.querySelectorAll('.stat')].find((x) => x.querySelector('.stat-label').textContent === label)?.querySelector('.stat-value').textContent;
  const axis = () => [...modal.panel.querySelectorAll('.hist-axis span')].map((x) => x.textContent);
  const bars = () => [...modal.panel.querySelectorAll('.hist-bar')].map((x) => x.title);
  const frequent = () => [...modal.panel.querySelectorAll('.freq-value')].map((x) => x.textContent);
  return { modal, stat, axis, bars, frequent };
}

// The column's cells show dates; its summary showed their serial numbers.
it('summarises a date column as dates, without a sum', () => {
  const { stat, axis, bars, frequent } = open(0);
  expect(stat('Sum')).toBeUndefined();
  expect(stat('Min')).toBe('2026-01-01');
  expect(stat('Max')).toBe('2026-03-01');
  expect(stat('Median')).toBe('2026-01-15');
  expect(stat('Average')).toMatch(/^2026-01-\d{2}$/);
  expect(stat('Range')).toBe('59 days');
  expect(axis()).toEqual(['2026-01-01', '2026-03-01']);
  for (const title of bars()) expect(title).toMatch(/^\d{4}-\d{2}-\d{2} – \d{4}-\d{2}-\d{2}: \d+$/);
  expect(frequent()[0]).toBe('2026-01-15');
});

it('keeps a number column as numbers, with its sum', () => {
  const { stat, axis } = open(1);
  expect(stat('Sum')).toBe('100');
  expect(stat('Min')).toBe('10');
  expect(stat('Max')).toBe('40');
  expect(stat('Range')).toBe('30');
  expect(axis()).toEqual(['10', '40']);
});

it('uses the cells\' own date format', () => {
  const { stat, axis } = open(2);
  expect(stat('Sum')).toBeUndefined();
  expect(stat('Min')).toBe('01/01/2026');
  expect(stat('Max')).toBe('01/03/2026');
  expect(stat('Range')).toBe('59 days');
  expect(axis()).toEqual(['01/01/2026', '01/03/2026']);
});

it('summarises a time column as times', () => {
  const { stat } = open(3);
  expect(stat('Sum')).toBeUndefined();
  expect(stat('Min')).toBe('06:00');
  expect(stat('Max')).toBe('18:00');
  expect(stat('Median')).toBe('12:00');
  expect(stat('Range')).toBe('12:00');
});

it('follows the format most of the column\'s numbers carry', () => {
  const { stat } = open(4);
  expect(stat('Sum')).toBeUndefined();
  expect(stat('Min')).toBe('1900-01-07'); // serial 7 in the 1900 date system
  expect(stat('Max')).toBe('2026-01-04');
});
