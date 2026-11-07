// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openFormatCellsDialog } from '../src/ui/formatcells.js';
import { orientationControl } from '../src/ui/orientation.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); });
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const key = (node, name, options = {}) => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options });
  node.dispatchEvent(event); return event;
};
function pointer(node, type, x, y, pointerId = 1, extra = {}) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...extra });
  Object.defineProperty(event, 'pointerId', { value: pointerId }); node.dispatchEvent(event); return event;
}
function open(rot = 0, protectedRange = false) {
  const wb = new Workbook(), id = wb.activeSheetId, range = parseRange('A1:B1');
  wb.setInput(id, 0, 0, '3'); wb.setInput(id, 0, 1, '=A1*2');
  wb.applyStyle(id, range, { rot, bold: true });
  if (protectedRange) wb.protectRange(id, range, 'Fixture');
  wb.clearHistory(); const before = wb.toJSON();
  const run = vi.fn((cmd, { patch }) => {
    expect(cmd).toBe('applyFormat'); wb.transaction('Format cells', () => wb.applyStyle(id, range, patch));
  });
  const modal = openFormatCellsDialog({ wb, sheetId: () => id, range: () => range, active: () => ({ r: 0, c: 0 }),
    style: () => wb.styleAt(id, 0, 0), grid: {}, run }, { panel: 'align' });
  const dial = modal.panel.querySelector('[role="slider"]');
  const degrees = modal.panel.querySelector('[aria-label="Rotation (degrees, -90 to 90)"]');
  const preview = modal.panel.querySelector('[aria-label="Alignment preview"] span');
  const apply = () => modal.panel.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  return { wb, id, before, modal, dial, degrees, preview, run, apply };
}

it('synchronizes imported and typed angles with the dial and preview, without editing the workbook', () => {
  const { wb, before, dial, degrees, preview, modal, run } = open(-45);
  expect(dial.getAttribute('aria-valuenow')).toBe('-45');
  expect(dial.querySelector('g').getAttribute('transform')).toBe('rotate(45 12 90)');
  degrees.value = '45'; degrees.dispatchEvent(new Event('input', { bubbles: true }));
  expect(dial.getAttribute('aria-valuenow')).toBe('45'); expect(preview.style.transform).toBe('rotate(-45deg)');
  degrees.value = '100'; degrees.dispatchEvent(new Event('input', { bubbles: true }));
  expect(degrees.value).toBe('90'); expect(dial.getAttribute('aria-valuenow')).toBe('90');
  expect(wb.toJSON()).toEqual(before); modal.close(); expect(run).not.toHaveBeenCalled();
});

it('applies keyboard orientation to the selection as one undoable formatting change', () => {
  const { wb, id, before, dial, degrees, preview, apply, run } = open();
  expect(key(dial, 'PageUp').defaultPrevented).toBe(true);
  expect(degrees.value).toBe('15'); expect(preview.style.transform).toBe('rotate(-15deg)');
  apply(); expect(run).toHaveBeenCalledWith('applyFormat', { patch: { rot: 15 }, border: null });
  expect(wb.undoLabels()).toHaveLength(1);
  expect(wb.styleAt(id, 0, 1)).toMatchObject({ rot: 15, bold: true });
  expect(wb.getValue(id, 0, 1)).toBe(6); wb.undo(); expect(wb.toJSON()).toEqual(before);
});

it('supports both signs, boundaries and reset without submitting the form', () => {
  const { dial, degrees, apply, run } = open(30);
  key(dial, 'ArrowDown'); expect(degrees.value).toBe('29');
  key(dial, 'ArrowLeft'); expect(degrees.value).toBe('28');
  key(dial, 'ArrowUp'); key(dial, 'ArrowRight'); expect(degrees.value).toBe('30');
  key(dial, 'Home'); key(dial, 'PageDown'); expect(degrees.value).toBe('-90');
  key(dial, 'End'); key(dial, 'PageUp'); expect(degrees.value).toBe('90');
  for (let i = 0; i < 6; i++) key(dial, 'PageDown'); expect(degrees.value).toBe('0');
  expect(run).not.toHaveBeenCalled(); apply(); expect(run).toHaveBeenCalledWith('applyFormat', { patch: { rot: null }, border: null });
});

it('leaves composing, modified and unrelated keys to their normal behavior', () => {
  const { dial, degrees, run } = open(45);
  for (const options of [{ isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
    expect(key(dial, 'ArrowUp', options).defaultPrevented).toBe(false);
  }
  expect(key(dial, 'Tab').defaultPrevented).toBe(false);
  expect(degrees.value).toBe('45'); expect(run).not.toHaveBeenCalled();
});

it('preserves no-edit Apply and clearly disables stacked vertical text', () => {
  const { modal, apply, run, wb, before } = open(-45);
  const button = [...modal.panel.querySelectorAll('button')].find(b => b.textContent === 'Vertical text');
  expect(button.disabled).toBe(true); expect(button.title).toContain('not supported');
  apply(); expect(run).not.toHaveBeenCalled(); expect(wb.toJSON()).toEqual(before);
});

it('uses the existing range-protection guard for orientation edits', () => {
  const { wb, before, dial, apply } = open(0, true);
  key(dial, 'PageDown'); apply(); expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
});

it('maps clicks and captured drags to signed degrees, ignoring other pointers', () => {
  const change = vi.fn(), { node } = orientationControl(0, change);
  node.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 180 });
  pointer(node, 'pointerdown', 60, 72); expect(change).toHaveBeenLastCalledWith(45);
  pointer(node, 'pointermove', 60, 148, 2); expect(change).toHaveBeenLastCalledWith(45);
  pointer(node, 'pointermove', 60, 148); expect(change).toHaveBeenLastCalledWith(-45);
  pointer(node, 'pointerup', 98, 110); expect(change).toHaveBeenLastCalledWith(0);
  pointer(node, 'pointermove', 60, 72); expect(change).toHaveBeenLastCalledWith(0);
});

it.each(['pointercancel', 'lostpointercapture'])('restores the pre-drag draft on %s', type => {
  const change = vi.fn(), { node } = orientationControl(30, change);
  node.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 180 });
  pointer(node, 'pointerdown', 60, 72); expect(change).toHaveBeenLastCalledWith(45);
  pointer(node, type, 60, 72); expect(change).toHaveBeenLastCalledWith(30);
  expect(node.getAttribute('aria-valuenow')).toBe('30');
});

it('ignores secondary-button gestures and leaves the origin unchanged', () => {
  const change = vi.fn(), { node } = orientationControl(30, change);
  node.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 180 });
  pointer(node, 'pointerdown', 60, 72, 1, { button: 2 }); expect(change).not.toHaveBeenCalled();
  pointer(node, 'pointerdown', 22, 110); expect(change).not.toHaveBeenCalled();
  pointer(node, 'pointerup', 22, 110); expect(node.getAttribute('aria-valuenow')).toBe('30');
});
