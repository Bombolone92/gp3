// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openTextBoxDialog } from '../src/ui/textboxdialog.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(() => {
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function setup(style) {
  const wb = new Workbook();
  const sheetId = wb.activeSheetId;
  const ctx = { wb, sheetId: () => sheetId, active: () => ({ r: 0, c: 0 }), grid: { focus: vi.fn(), selectChart: vi.fn() } };
  const id = style && wb.addChart(sheetId, { type: 'text', text: 'Original', anchor: { r: 0, c: 0 }, style });
  const textbox = id ? wb.chartById(sheetId, id) : null;
  const modal = openTextBoxDialog(ctx, { textbox });
  const submit = () => modal.panel.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return { wb, sheetId, id, modal, submit, text: modal.panel.querySelector('textarea') };
}

it.each([
  [0, 'Horizontal alignment', 'align', 'left', 'center', 'right'],
  [1, 'Vertical alignment', 'valign', 'top', 'middle', 'bottom'],
])('supports keyboard selection and saving in alignment group %i', (index, label, key, first, middle, last) => {
  const { wb, sheetId, id, modal, submit } = setup({ align: 'center', valign: 'middle' });
  const group = modal.panel.querySelectorAll('[role="radiogroup"]')[index];
  const radios = [...group.querySelectorAll('[role="radio"]')];
  expect(group.getAttribute('aria-label')).toBe(label);
  expect(radios.filter((node) => node.tabIndex === 0)).toEqual([radios[1]]);
  radios[1].focus();
  const press = (name) => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  };
  press('ArrowRight');
  expect(document.activeElement.dataset.key).toBe(last);
  press('ArrowDown');
  expect(document.activeElement.dataset.key).toBe(first);
  press('ArrowLeft');
  expect(document.activeElement.dataset.key).toBe(last);
  press('ArrowUp');
  expect(document.activeElement.dataset.key).toBe(middle);
  press('ArrowRight');
  expect(radios.filter((node) => node.tabIndex === 0)).toEqual([document.activeElement]);
  expect(radios.filter((node) => node.getAttribute('aria-checked') === 'true')).toEqual([document.activeElement]);
  submit();
  expect(wb.chartById(sheetId, id).style[key]).toBe(last);
  wb.undo();
  expect(wb.chartById(sheetId, id).style[key]).toBe(middle);
  wb.redo();
  expect(wb.chartById(sheetId, id).style[key]).toBe(last);
});

it('moves the alignment tab stop on click and leaves composition keys alone', () => {
  const { modal } = setup(null);
  const group = modal.panel.querySelector('[role="radiogroup"]');
  const radios = [...group.querySelectorAll('[role="radio"]')];
  radios[2].focus();
  radios[2].click();
  expect(radios.filter((node) => node.tabIndex === 0)).toEqual([radios[2]]);
  for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true, ...init });
    radios[2].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(radios[2]);
    expect(radios[2].getAttribute('aria-checked')).toBe('true');
  }
});

it('preserves imported text and fill colors when editing only the caption', () => {
  const { wb, sheetId, id, modal, submit, text } = setup({ color: '#123456', bg: '#abcdef', bold: true });
  expect(modal.panel.querySelector('[aria-label="Text color"]').value).toBe('#123456');
  expect(modal.panel.querySelector('[aria-label="Fill color"]').value).toBe('#abcdef');
  text.value = 'Updated';
  submit();
  expect(wb.chartById(sheetId, id)).toMatchObject({ text: 'Updated', style: { color: '#123456', bg: '#abcdef', bold: true } });
  wb.undo();
  expect(wb.chartById(sheetId, id)).toMatchObject({ text: 'Original', style: { color: '#123456', bg: '#abcdef' } });
  wb.redo();
  expect(wb.chartById(sheetId, id).text).toBe('Updated');
});

it('allows replacing custom colors with palette colors or no fill', () => {
  const { wb, sheetId, id, modal, submit } = setup({ color: '#123456', bg: '#abcdef' });
  modal.panel.querySelector('[aria-label="Text color"]').value = '#c22a2a';
  modal.panel.querySelector('[aria-label="Fill color"]').value = '';
  submit();
  expect(wb.chartById(sheetId, id).style).toMatchObject({ color: '#c22a2a', bg: null });
});

it.each([false, true])('keeps overlong text available for correction when editing=%s', (editing) => {
  const { wb, sheetId, id, modal, submit, text } = setup(editing ? { bold: true } : null);
  const before = wb.toJSON();
  const version = wb.version;
  text.value = 'x'.repeat(4001);
  submit();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.version).toBe(version);
  expect(modal.panel.closest('.modal-root').classList.contains('closing')).toBe(false);
  expect(text.value).toHaveLength(4001);
  expect(document.activeElement).toBe(text);
  expect(modal.panel.querySelector('[role="alert"]').hidden).toBe(false);
  expect(modal.panel.querySelector('[role="alert"]').textContent).toContain('4,000');
  text.value = 'x'.repeat(4000);
  submit();
  const saved = id ? wb.chartById(sheetId, id) : wb.activeSheet.charts[0];
  expect(saved.text).toBe(text.value);
  expect(new Workbook(wb.toJSON()).activeSheet.charts[0].text).toBe(text.value);
  wb.undo();
  expect(editing ? wb.chartById(sheetId, id).text : wb.activeSheet.charts.length).toBe(editing ? 'Original' : 0);
  wb.redo();
  expect(wb.activeSheet.charts[0].text).toBe(text.value);
});
