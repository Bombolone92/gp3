// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openFormatCellsDialog } from '../src/ui/formatcells.js';
import { closeAllModals } from '../src/ui/modal.js';
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
// Sizes are typed in points and stored in pixels (a point is 4/3 px).
const pt = points => points * 4 / 3;
function open(style = {}) {
  const wb = new Workbook(), id = wb.activeSheetId, range = parseRange('A1:B1');
  wb.setInput(id, 0, 0, '12.5'); wb.setInput(id, 0, 1, '=A1*2'); wb.setNote(id, 0, 0, 'Synthetic font sample'); wb.applyStyle(id, range, style); wb.clearHistory();
  const run = vi.fn((cmd, { patch }) => wb.transaction('Format cells', () => wb.applyStyle(id, range, patch)));
  const modal = openFormatCellsDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), range: () => range, style: () => wb.styleAt(id, 0, 0) || {}, run, grid: { focus: vi.fn() } }, { panel: 'font' });
  const field = label => modal.panel.querySelector(`[aria-label="${label}"]`);
  const choose = (label, value) => { const input = field(label); input.value = value; input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
  const check = label => [...modal.panel.querySelectorAll('label.find-option')].find(n => n.textContent === label).querySelector('input');
  const apply = () => modal.panel.querySelector('form').requestSubmit();
  const tab = label => [...modal.panel.querySelectorAll('[role=tab]')].find(n => n.textContent === label);
  return { wb, id, modal, field, choose, check, apply, tab, run };
}
it('shows visible family/style/size lists and synchronizes the original bold/italic controls in both directions', () => {
  const { field, choose, check, run } = open({ bold: true });
  expect(field('Font').size).toBe(8); expect(field('Font style').size).toBe(4); expect(field('Size').size).toBe(8);
  expect(field('Font style').value).toBe('bold'); choose('Font style', 'bolditalic'); expect(check('Bold').checked).toBe(true); expect(check('Italic').checked).toBe(true);
  check('Bold').click(); expect(field('Font style').value).toBe('italic'); check('Italic').click(); expect(field('Font style').value).toBe('regular');
  choose('Size', '18'); expect(field('Font size').value).toBe('18'); choose('Font', 'arial'); expect(field('Font name').value).toBe('Arial'); expect(run).not.toHaveBeenCalled();
});
it('previews typed families and decimal sizes, then applies only those changes in one Undo step', () => {
  const { wb, id, choose, field, apply, run } = open({ fmt: 'number', dec: 2, bg: '#ddeeff' }), before = wb.toJSON();
  choose('Font name', 'Arial'); choose('Font size', '17.5'); choose('Font style', 'bolditalic');
  const preview = field('Font preview').querySelector('span'); expect(preview.style.fontSize).toBe(`${pt(17.5)}px`); expect(preview.style.fontFamily).toContain('Arial'); expect(preview.style.fontStyle).toBe('italic');
  expect(wb.toJSON()).toEqual(before); apply(); expect(run).toHaveBeenCalledOnce(); expect(run.mock.calls[0][1].patch).toEqual({ font: 'arial', size: pt(17.5), bold: true, italic: true });
  expect(wb.getCell(id, 0, 1).f).toBe('A1*2'); expect(wb.getValue(id, 0, 1)).toBe(25); expect(wb.getNote(id, 0, 0)).toBe('Synthetic font sample');
  expect(wb.styleAt(id, 0, 1)).toMatchObject({ fmt: 'number', dec: 2, bg: '#ddeeff', font: 'arial', size: pt(17.5) });
  expect(wb.undoLabels()).toHaveLength(1); wb.undo(); expect(wb.toJSON()).toEqual(before);
});
it.each(['', '0', '410', 'abc', 'Infinity', '1e2'])('refuses invalid typed size %j, brings its tab into view, and permits correction without losing other drafts', value => {
  const { modal, field, choose, check, apply, tab, run } = open(); choose('Font size', value); check('Bold').click(); tab('Fill').click(); apply();
  expect(run).not.toHaveBeenCalled(); expect(modal.panel.closest('.modal-root').classList.contains('closing')).toBe(false); expect(tab('Font').getAttribute('aria-selected')).toBe('true');
  expect(field('Font size').getAttribute('aria-invalid')).toBe('true'); expect(document.activeElement).toBe(field('Font size')); expect(field('Font size').value).toBe(value);
  choose('Font size', '19.25'); expect(field('Font size').hasAttribute('aria-invalid')).toBe(false); apply(); expect(run.mock.calls[0][1].patch).toEqual({ size: pt(19.25), bold: true });
});
it('refuses an empty family without applying the last valid preview and resolves case-insensitive preset names', () => {
  const { choose, apply, field, run } = open(); choose('Font name', ''); apply(); expect(run).not.toHaveBeenCalled(); expect(document.activeElement).toBe(field('Font name'));
  choose('Font name', 'aRiAl'); expect(field('Font').value).toBe('arial'); apply(); expect(run.mock.calls[0][1].patch).toEqual({ font: 'arial' });
});
it('retains literal imported/custom families and unusual imported sizes when unrelated controls change', () => {
  const font = 'font:Synthetic, "Wide" Face', { choose, field, check, apply, run } = open({ font, size: 512 });
  expect(field('Font name').value).toBe('Synthetic, "Wide" Face'); expect(field('Font').value).toBe(font); expect(field('Font size').value).toBe('384');
  check('Italic').click(); apply(); expect(run.mock.calls[0][1].patch).toEqual({ italic: true });
});
it('accepts literal Unicode/punctuation families without treating names as HTML or CSS declarations', () => {
  const { choose, apply, field, run } = open(); choose('Font name', 'Synthetic 字体, "A"; color: red');
  expect(field('Font preview').querySelector('span').style.color).not.toBe('red'); expect(document.querySelector('script')).toBeNull(); apply();
  expect(run.mock.calls[0][1].patch).toEqual({ font: 'font:Synthetic 字体, "A"; color: red' });
});
it('retains the untouched default and cancels typed/font-style drafts without changing history', () => {
  const first = open({ size: 13, font: 'default' }); first.apply(); expect(first.run).not.toHaveBeenCalled();
  const { wb, modal, choose, run } = open(), before = wb.toJSON(); choose('Font name', 'Georgia'); choose('Font size', '22.5'); choose('Font style', 'bolditalic');
  [...modal.panel.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click(); expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false); expect(run).not.toHaveBeenCalled();
});
it('moves Down from Font to the editable family field while modified/composing keys remain unchanged', () => {
  const { tab, field } = open(); const font = tab('Font'); font.focus();
  for (const extra of [{ isComposing: true }, { ctrlKey: true }, { metaKey: true }]) {
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, ...extra }); font.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  }
  font.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); expect(document.activeElement).toBe(field('Font name'));
});
