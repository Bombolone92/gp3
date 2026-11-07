// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openTableDialog } from '../src/ui/tabledialog.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

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

function setup(style = 'blue') {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Amount');
  wb.setInput(id, 1, 0, '10');
  const tableId = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { style });
  wb.clearHistory();
  const { panel } = openTableDialog({ wb, sheetId: () => id, grid: { focus: vi.fn() } }, { table: wb.tableById(id, tableId) });
  return { wb, id, tableId, panel, choices: [...panel.querySelectorAll('[role="radio"]')] };
}

function key(name) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  document.activeElement.dispatchEvent(event);
  return event;
}

it('exposes only the current style as a tab stop', () => {
  const { choices } = setup('green');
  expect(choices.filter((node) => node.tabIndex === 0).map((node) => node.dataset.key)).toEqual(['green']);
});

it('selects styles with arrow keys, wraps, and saves the choice in one undo step', () => {
  const { wb, id, tableId, panel, choices } = setup();
  choices[0].focus();
  for (const [press, expected] of [['ArrowLeft', 'none'], ['ArrowDown', 'blue'], ['ArrowRight', 'gray'], ['ArrowUp', 'blue']]) {
    expect(key(press).defaultPrevented).toBe(true);
    expect(document.activeElement.dataset.key).toBe(expected);
    expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
    expect(choices.filter((node) => node.tabIndex === 0)).toEqual([document.activeElement]);
    expect(choices.filter((node) => node.getAttribute('aria-checked') === 'true')).toEqual([document.activeElement]);
  }
  key('ArrowRight');
  expect(wb.tableById(id, tableId).style).toBe('blue');
  expect(wb.undoLabels()).toHaveLength(0);
  panel.querySelector('form').requestSubmit();
  expect(wb.tableById(id, tableId).style).toBe('gray');
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect(wb.tableById(id, tableId).style).toBe('blue');
});

it('updates the tab stop after a pointer choice and leaves text-field arrows alone', () => {
  const { panel, choices } = setup();
  choices[2].click();
  expect(choices.filter((node) => node.tabIndex === 0)).toEqual([choices[2]]);
  panel.querySelector('[aria-label="Table name"]').focus();
  expect(key('ArrowLeft').defaultPrevented).toBe(false);
});
