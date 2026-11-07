// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openSparklineDialog } from '../src/ui/sparklinedialog.js';
import { closeAllModals } from '../src/ui/modal.js';
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const setup = () => {
  const wb = new Workbook({ sheets: [{ id: 's', name: 'Data', sparklineGroups: [{ colorSeries: { theme: 5, tint: .4 }, high: true, sparklines: [{ ref: 'D1', formula: 'A1:C1' }, { ref: 'D2', formula: 'A2:C2' }] }] }] });
  const focus = vi.fn(), modal = openSparklineDialog({ wb, sheetId: () => 's', active: () => ({ r: 0, c: 3 }), grid: { focus } });
  const input = label => modal.panel.querySelector(`[aria-label="${label}"]`);
  const change = (label, value) => { const node = input(label); if (node.type === 'checkbox') node.checked = value; else node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); node.dispatchEvent(new Event('input', { bubbles: true })); };
  const save = () => modal.panel.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return { wb, modal, input, change, save, focus };
};
it('names the dialog, focuses its source field, explains group scope and cancels without edits', () => {
  const { wb, modal, input } = setup(), before = wb.toJSON();
  expect(modal.panel.getAttribute('aria-label')).toBe('Sparkline settings'); expect(document.activeElement).toBe(input('Data range for D1'));
  expect(modal.panel.textContent).toContain('all 2 sparklines');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
});
it('saves group settings and one data binding while preserving untouched theme colors', () => {
  const { wb, change, save, focus } = setup();
  change('Chart type', 'column'); change('Data range for D1', 'A3:C3'); change('Include hidden rows and columns', true); save();
  expect(wb.sheet('s').sparklineGroups[0]).toMatchObject({ type: 'column', displayHidden: true, colorSeries: { theme: 5, tint: .4 }, sparklines: [{ ref: 'D1', formula: 'A3:C3' }, { ref: 'D2', formula: 'A2:C2' }] });
  expect(wb.undoLabels()).toHaveLength(1); expect(focus).toHaveBeenCalled();
});
it('rejects a two-dimensional data range with a field-linked error', () => {
  const { wb, input, change, save } = setup(); change('Data range for D1', 'A1:C3'); save();
  expect(input('Data range for D1').getAttribute('aria-invalid')).toBe('true'); expect(wb.canUndo()).toBe(false);
  change('Data range for D1', 'A4:C4'); expect(input('Data range for D1').hasAttribute('aria-invalid')).toBe(false); save();
  expect(wb.sheet('s').sparklineGroups[0].sparklines[0].formula).toBe('A4:C4');
});
it('edits axes and colors and validates the date-category count', () => {
  const { wb, change, save, input } = setup();
  change('Use a date axis', true); expect(input('Date range for the group').disabled).toBe(false);
  change('Date range for the group', 'A4:B4'); save(); expect(wb.canUndo()).toBe(false);
  expect(input('Date range for the group').getAttribute('aria-invalid')).toBe('true');
  change('Date range for the group', 'A4:C4'); change('Series color', '#ff0088'); change('Minimum scale', 'custom'); change('Minimum value', '-5'); save();
  expect(wb.sheet('s').sparklineGroups[0]).toMatchObject({ dateAxis: true, dateFormula: 'A4:C4', minAxisType: 'custom', manualMin: -5, colorSeries: { rgb: 'FFFF0088' } });
});
it('no-op save does not flatten theme colors or create history', () => {
  const { wb, save } = setup(), before = wb.toJSON(); save(); expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
});
it('preserves unsupported existing bindings when editing only their appearance', () => {
  const { wb, modal } = setup(); modal.close();
  wb.sheet('s').sparklineGroups[0].sparklines[0].formula = "'[Unavailable.xlsx]Data'!A1:C1";
  const dialog = openSparklineDialog({ wb, sheetId: () => 's', active: () => ({ r: 0, c: 3 }), grid: { focus() {} } });
  const type = dialog.panel.querySelector('[aria-label="Chart type"]'); type.value = 'stacked';
  dialog.panel.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(wb.sheet('s').sparklineGroups[0].type).toBe('stacked');
  expect(wb.sheet('s').sparklineGroups[0].sparklines[0].formula).toBe("'[Unavailable.xlsx]Data'!A1:C1");
});
it('reveals invalid numeric fields in collapsed axes settings and focuses the error', () => {
  const { wb, input, change, save } = setup(); change('Minimum scale', 'custom'); save();
  expect(input('Minimum value').closest('details').open).toBe(true);
  expect(document.activeElement).toBe(input('Minimum value')); expect(wb.canUndo()).toBe(false);
});

it('rejects a named three-dimensional source instead of saving an unavailable series', () => {
  const { wb, input, change, save } = setup();
  wb.addSheet('Other'); wb.defineName('AcrossSheets', 'Data:Other!A1:C1');
  const before = wb.toJSON(); change('Data range for D1', 'AcrossSheets'); save();
  expect(input('Data range for D1').getAttribute('aria-invalid')).toBe('true');
  expect(wb.toJSON()).toEqual(before);
});

it.each([false, true])('checks named dates at every member anchor (matching: %s)', matching => {
  const { wb, change, save, input } = setup();
  wb.defineName('Dates', 'OFFSET(Data!$A$4,0,0,1,ROW()+2)');
  if (matching) wb.sheet('s').sparklineGroups[0].sparklines[1].formula = 'A2:D2';
  const before = wb.toJSON();
  change('Use a date axis', true); change('Date range for the group', 'Dates'); save();
  if (matching) expect(wb.sheet('s').sparklineGroups[0]).toMatchObject({ dateAxis: true, dateFormula: 'Dates' });
  else {
    expect(wb.toJSON()).toEqual(before);
    expect(input('Date range for the group').getAttribute('aria-invalid')).toBe('true');
  }
});
