// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const data = new Map();
  vi.stubGlobal('localStorage', { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// Picking a custom colour rebuilt the whole swatch group, and the group only restored the focus when
// it still held it. Chrome and Safari hand the focus back to the <input type=color> that owned the
// popup — on the body, aria-hidden and out of the tab order — so the focus left the dialog entirely
// and the next Tab was redirected by the modal's trap to the Close button.
const panel = () => document.querySelector('.modal-panel');

function open() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Item', 'Amount'], ['A', '10']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  openConditionalFormatting({ wb, sheetId: () => id, range: () => ({ r1: 1, c1: 1, r2: 1, c2: 1 }), grid: { focus() {} } });
  return { wb, id };
}

/** Open the browser's picker from `group`'s Custom swatch and choose `hex`. `restore` models the
 *  browser putting the focus back on its own input before the change is heard. */
function pickCustom(group, hex, { restore = true } = {}) {
  const custom = group.querySelector('.swatch.custom');
  custom.focus();
  custom.click();
  const native = document.querySelector('input.color-native');
  expect(native.closest('.modal-panel')).toBeNull(); // it lives on the body, outside the dialog
  native.value = hex;
  if (restore) native.focus();
  native.dispatchEvent(new Event('change'));
}

describe.each([['Fill color'], ['Text color'], ['Bar color']])('%s swatches', (label) => {
  it('leaves the focus on the chosen swatch, inside the dialog', () => {
    open();
    if (label === 'Bar color') {
      const type = panel().querySelector('[aria-label="Condition"]');
      type.value = 'databar';
      type.dispatchEvent(new Event('change'));
    }
    const group = panel().querySelector(`[aria-label="${label}"]`);
    pickCustom(group, '#123456');
    const focused = document.activeElement;
    expect(focused.closest('.modal-panel')).toBe(panel());
    // What a screen reader announces: the colour, as the checked option of its labelled group.
    expect(focused.getAttribute('aria-label')).toBe('#123456');
    expect(focused.getAttribute('role')).toBe('radio');
    expect(focused.getAttribute('aria-checked')).toBe('true');
    expect(focused.closest('[role="radiogroup"]').getAttribute('aria-label')).toBe(label);
    expect(focused.tabIndex).toBe(0);
  });
});

it('lets the next Tab move on, instead of the trap sending it back to Close', () => {
  open();
  pickCustom(panel().querySelector('[aria-label="Fill color"]'), '#123456');
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  document.activeElement.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(document.activeElement.getAttribute('aria-label')).not.toBe('Close');
});

it('still lands on the chosen swatch when the browser leaves the focus where it was', () => {
  open();
  pickCustom(panel().querySelector('[aria-label="Fill color"]'), '#abcdef', { restore: false });
  expect(document.activeElement.getAttribute('aria-label')).toBe('#abcdef');
  expect(document.activeElement.closest('.modal-panel')).toBe(panel());
});

it('shows referenced text color and preserves it when an imported rule is saved unchanged', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const color = { theme: 4, base: '#286844', rgb: '#286844' };
  const range = { r1: 0, c1: 0, r2: 2, c2: 0 };
  wb.addRule(id, { range, type: 'gt', value: 3, style: { color } });
  const before = JSON.stringify(wb.activeSheet.rules);
  openConditionalFormatting({ wb, sheetId: () => id, range: () => range, grid: { focus() {} } });
  expect(panel().querySelector('.cf-preview').style.color).toBe('rgb(40, 104, 68)');
  panel().querySelector('.names-main').click();
  const selected = panel().querySelector('[aria-label="Text color"] [aria-checked="true"]');
  expect(selected.getAttribute('aria-label')).toBe('#286844');
  expect(selected.style.background).toBe('rgb(40, 104, 68)');
  [...panel().querySelectorAll('button')].find(b => b.textContent === 'Save rule').click();
  expect(JSON.stringify(wb.activeSheet.rules)).toBe(before);
});
