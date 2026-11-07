// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
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

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 1, c2: 0 };
  openConditionalFormatting({ wb, sheetId: () => id, range: () => range, grid: { focus: vi.fn() } });
  const group = document.querySelector('[role="radiogroup"][aria-label="Fill color"]');
  return { wb, id, group };
}

it('keeps focus on the chosen color when a focused swatch is activated', () => {
  const { group } = setup();
  const choice = group.querySelector('[role="radio"]:not(.none)');
  const color = choice.getAttribute('aria-label');
  choice.focus();
  choice.click();
  expect(document.activeElement.getAttribute('aria-label')).toBe(color);
  expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
});

it('has one radio tab stop and supports arrows, wrapping, and saving the chosen fill', () => {
  const { wb, id, group } = setup();
  const radios = () => [...group.querySelectorAll('[role="radio"]')];
  expect(radios().filter((node) => node.tabIndex === 0)).toHaveLength(1);
  const first = radios()[0];
  first.focus();
  first.click();
  const press = (key) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  };
  press('ArrowLeft');
  expect(document.activeElement).toBe(radios().at(-1));
  press('ArrowDown');
  expect(document.activeElement.getAttribute('aria-label')).toBe('None');
  press('ArrowRight');
  press('ArrowUp');
  press('ArrowRight');
  const fill = document.activeElement.getAttribute('aria-label');
  expect(radios().filter((node) => node.tabIndex === 0)).toEqual([document.activeElement]);
  expect(radios().filter((node) => node.getAttribute('aria-checked') === 'true')).toEqual([document.activeElement]);
  const custom = group.querySelector('.custom');
  expect(custom.getAttribute('role')).not.toBe('radio');
  expect(custom.tabIndex).toBe(0);
  expect(wb.sheet(id).rules).toHaveLength(0);
  document.querySelector('[aria-label="Value"]').value = '0';
  document.querySelector('form').requestSubmit();
  expect(wb.sheet(id).rules[0].style.bg).toBe(fill);
  wb.undo();
  expect(wb.sheet(id).rules).toHaveLength(0);
});

it('keeps custom colors selectable and leaves composition and custom-button arrows alone', () => {
  const { group } = setup();
  const custom = group.querySelector('.custom');
  custom.focus();
  const arrow = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
  custom.dispatchEvent(arrow);
  expect(arrow.defaultPrevented).toBe(false);
  custom.click();
  const picker = document.querySelector('input.color-native');
  picker.value = '#123456';
  picker.dispatchEvent(new Event('change'));
  expect(document.activeElement.getAttribute('aria-label')).toBe('#123456');
  expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
  const composing = new KeyboardEvent('keydown', { key: 'ArrowLeft', isComposing: true, bubbles: true, cancelable: true });
  document.activeElement.dispatchEvent(composing);
  expect(composing.defaultPrevented).toBe(false);
  expect(document.activeElement.getAttribute('aria-label')).toBe('#123456');
});
