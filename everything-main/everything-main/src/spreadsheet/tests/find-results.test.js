// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createFindBar } from '../src/ui/findbar.js';

let bar;
beforeEach(() => { vi.useFakeTimers(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { bar?.destroy(); bar = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });
const button = label => [...bar.el.querySelectorAll('button')].find(b => b.textContent === label);
const cells = () => [...bar.el.querySelectorAll('.find-result-cell')];
const checkbox = text => [...bar.el.querySelectorAll('.find-option')].find(l => l.textContent.startsWith(text)).querySelector('input');
const key = (target, key, extra = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));

function setup(wb = new Workbook({ sheets: [{ name: 'Main', cells: { '1,0': { v: 'Notebook' }, '1,1': { f: 'A2' }, '2,0': { v: 'Notebook refill' } } },
  { name: 'Other', cells: { '0,0': { v: 'Notebook' } } }, { name: 'Hidden', hidden: true, cells: { '0,0': { v: 'Notebook' } } }] })) {
  const grid = { active: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 0, c2: 0 }, focus: vi.fn(), setHighlights: vi.fn(),
    setSelection: vi.fn(s => { grid.active = s.active; }) };
  bar = createFindBar({ wb, grid, sheetId: () => wb.activeSheetId, activeCell: () => null, announce: vi.fn(),
    subscribe: fn => { wb.addEventListener('change', fn); return () => wb.removeEventListener('change', fn); } });
  document.body.append(bar.el);
  bar.open();
  const query = bar.el.querySelector('[aria-label="Find"]');
  const type = text => { query.value = text; query.dispatchEvent(new Event('input')); };
  type('Notebook');
  vi.advanceTimersByTime(150);
  return { wb, grid, query, type };
}

it('adds a live result table while preserving quick Find and read-only navigation', () => {
  const { wb, grid } = setup();
  const before = wb.toJSON();
  const toggle = button('Find all');
  expect(bar.el.querySelector('.find-results').hidden).toBe(true);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.click();
  const region = bar.el.querySelector('.find-results');
  expect(region.hidden).toBe(false);
  expect(toggle.getAttribute('aria-controls')).toBe(region.id);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect([...bar.el.querySelectorAll('th')].map(th => th.textContent)).toEqual(['Sheet', 'Cell', 'Value', 'Formula']);
  expect(cells().map(b => b.getAttribute('aria-label'))).toEqual(['Main A2', 'Main B2', 'Main A3']);
  expect(cells()[1].closest('tr').textContent).toContain('Notebook=A2');
  cells()[2].click();
  expect(grid.active).toEqual({ r: 2, c: 0 });
  expect(cells()[2].getAttribute('aria-current')).toBe('true');
  expect(cells().filter(b => b.tabIndex === 0)).toHaveLength(1);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  toggle.click();
  expect(region.hidden).toBe(true);
  expect(bar.el.classList.contains('find-expanded')).toBe(false);
});

it('navigates result cells on other visible sheets without including hidden sheets', () => {
  const { wb, grid } = setup();
  const before = wb.sheets.map(s => [...s.cells]);
  checkbox('All sheets').click();
  button('Find all').click();
  expect(cells().map(b => b.getAttribute('aria-label'))).toEqual(['Main A2', 'Main B2', 'Main A3', 'Other A1']);
  cells()[3].click();
  expect(wb.activeSheet.name).toBe('Other');
  expect(grid.active).toEqual({ r: 0, c: 0 });
  expect(bar.el.querySelector('.find-count').textContent).toBe('4 of 4 on 2 sheets');
  expect(wb.sheets.map(s => [...s.cells])).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it('keeps result rendering bounded and supports keyboard navigation across pages', () => {
  const wb = new Workbook({ sheets: [{ name: 'Large', cells: Object.fromEntries(Array.from({ length: 1205 }, (_, r) => [`${r},0`, { v: 'Notebook' }])) }] });
  const { grid } = setup(wb);
  button('Find all').click();
  expect(cells()).toHaveLength(100);
  expect(bar.el.querySelector('.find-results-summary').textContent).toBe('1–100 of 1205 results');
  cells()[0].focus();
  key(cells()[0], 'PageDown');
  expect(grid.active.r).toBe(100);
  expect(document.activeElement.getAttribute('aria-label')).toBe('Large A101');
  expect(cells()).toHaveLength(100);
  key(document.activeElement, 'End');
  expect(grid.active.r).toBe(1204);
  expect(document.activeElement.getAttribute('aria-label')).toBe('Large A1205');
  expect(cells()).toHaveLength(5);
  key(document.activeElement, 'Home');
  expect(document.activeElement.getAttribute('aria-label')).toBe('Large A1');
  bar.el.querySelector('[aria-label="Next results page"]').click();
  expect(grid.active.r).toBe(100);
  bar.el.querySelector('[aria-label="Previous results page"]').click();
  expect(grid.active.r).toBe(0);
});

it('clears stale rows while a new query is pending and lets invalid results collapse', () => {
  const { type, query } = setup();
  button('Find all').click();
  type('Missing');
  expect(cells()).toHaveLength(0);
  expect(bar.el.querySelector('.find-results-summary').textContent).toBe('Searching…');
  key(query, 'Enter');
  expect(bar.el.querySelector('.find-results-summary').textContent).toBe('No matches');
  checkbox('Regular expression').click();
  type('[');
  expect(bar.el.querySelector('.find-results-summary').textContent).toBe('Invalid regular expression');
  expect(button('Hide results').disabled).toBe(false);
  button('Hide results').click();
  expect(button('Find all').disabled).toBe(true);
});

it('updates rows on recalculation and returns focus when a focused result disappears', () => {
  const { wb, query } = setup();
  button('Find all').click();
  cells()[0].focus();
  wb.setInput(wb.activeSheetId, 1, 0, 'Paper');
  wb.setInput(wb.activeSheetId, 2, 0, 'Folder');
  wb.recalculate();
  expect(cells()).toHaveLength(0);
  expect(document.activeElement).toBe(query);
  expect(bar.el.querySelector('.find-results-summary').textContent).toBe('No matches');
});

it('retains formula-result replacement safeguards and one transaction for Replace all', () => {
  const { wb } = setup();
  checkbox('All sheets').click();
  button('Find all').click();
  const before = wb.toJSON();
  bar.el.querySelector('[aria-label="Show replace"]').click();
  bar.el.querySelector('[aria-label="Replace with"]').value = 'Paper';
  button('Replace all').click();
  expect(wb.getCell(wb.sheetByName('Main').id, 1, 1).f).toBe('A2');
  expect(wb.getValue(wb.sheetByName('Main').id, 1, 1)).toBe('Paper');
  expect(wb.getValue(wb.sheetByName('Other').id, 0, 0)).toBe('Paper');
  expect(cells()).toHaveLength(0);
  expect(wb.undoLabel()).toBe('Replace all');
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  expect(cells()).toHaveLength(4);
});

it('leaves composing and modified navigation keys alone, and closes with Escape', () => {
  const { grid } = setup();
  button('Find all').click();
  cells()[0].focus();
  grid.setSelection.mockClear();
  for (const extra of [{ isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) key(cells()[0], 'ArrowDown', extra);
  expect(grid.setSelection).not.toHaveBeenCalled();
  key(cells()[0], 'ArrowDown');
  expect(grid.active).toEqual({ r: 1, c: 1 });
  key(document.activeElement, 'Escape');
  expect(bar.el.hidden).toBe(true);
  expect(cells()).toHaveLength(0);
  expect(grid.focus).toHaveBeenCalledOnce();
});

it('renders sheet names, cell values and formulas as bounded text rather than markup', () => {
  const wb = new Workbook({ sheets: [{ name: 'Text', cells: { '0,0': { v: '<img src=x onerror=alert(1)>' + 'Notebook'.repeat(200) } } }] });
  setup(wb);
  button('Find all').click();
  const row = cells()[0].closest('tr');
  expect(row.querySelector('img')).toBeNull();
  expect(row.querySelectorAll('td')[2].textContent.length).toBe(200);
  expect(row.querySelectorAll('td')[2].title.length).toBe(200);
  expect(wb.getValue(wb.activeSheetId, 0, 0).length).toBeGreaterThan(1500);
});
