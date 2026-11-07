// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import * as P from '../src/lib/puter.js';
import { openCustomFormatDialog } from '../src/ui/numfmtdialog.js';
import { openTableDialog } from '../src/ui/tabledialog.js';
import { openChartDialog } from '../src/ui/chartdialog.js';
import { openGoalSeek } from '../src/ui/goalseek.js';
import { openSeriesDialog } from '../src/ui/seriesdialog.js';
import { openTextBoxDialog } from '../src/ui/textboxdialog.js';
import { openValidationManager } from '../src/ui/validation.js';
import { openAiDialog } from '../src/ui/aidialog.js';
import { closeAllModals, promptDialog } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

let phone = false;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: !phone, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(P, 'canAI').mockReturnValue(true);
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function workbook() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Month', 'Sales'], ['Jan', '100'], ['Feb', '200']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  return { wb, id };
}
const range = { r1: 0, c1: 0, r2: 2, c2: 1 };
const grid = () => ({ focus: vi.fn(), setSelection: vi.fn(), selectChart: vi.fn() });

// Each dialog focused its main field itself, so on a phone the soft keyboard opened over the bottom
// sheet and hid the form; openModal now takes the field and applies its own screen-size guard.
const dialogs = [
  ['Custom number format', ({ wb, id }) => openCustomFormatDialog({ wb, sheetId: () => id, active: () => ({ r: 1, c: 1 }), style: () => ({}), run: vi.fn(), grid: grid() }), 'Format code'],
  ['Create table', ({ wb, id }) => openTableDialog({ wb, sheetId: () => id, grid: grid() }, { range }), 'Table name'],
  ['Insert chart', ({ wb, id }) => openChartDialog({ wb, sheetId: () => id, range: () => range, grid: grid() }, { range }), 'Title'],
  ['Goal seek', ({ wb, id }) => openGoalSeek({ wb, sheetId: () => id, active: () => ({ r: 1, c: 1 }), grid: grid() }), 'To value'],
  ['Fill series', ({ wb, id }) => openSeriesDialog({ wb, sheetId: () => id, range: () => ({ r1: 1, c1: 1, r2: 5, c2: 1 }), grid: grid() }), 'Step'],
  ['Insert text box', ({ wb, id }) => openTextBoxDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid: grid() }, {}), 'Text'],
  ['Data validation for a dropdown', ({ wb, id }) => openValidationManager({ wb, sheetId: () => id, range: () => range, grid: grid() }, { type: 'list' }), 'List options'],
  ['Write a formula with AI', ({ wb, id }) => openAiDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), range: () => range, grid: grid() }, { mode: 'write' }), 'What should the formula calculate?'],
  // Rename spreadsheet, Save a copy, Rename sheet, Go to, Split text, Import from URL: one prompt for all of them.
  ['A text prompt', () => promptDialog({ title: 'Rename spreadsheet', label: 'Name', value: 'Budget' }), 'Name'],
];

describe('on a phone', () => {
  beforeEach(() => { phone = true; });
  afterEach(() => { phone = false; });
  it.each(dialogs)('%s leaves the focus on the sheet itself, keeping the keyboard down', (_name, open) => {
    open(workbook());
    vi.runAllTimers();
    const panel = document.querySelector('.modal-panel');
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(panel);
  });
});

describe('on a larger screen', () => {
  it.each(dialogs)('%s starts on its main field', (_name, open, label) => {
    open(workbook());
    const field = document.querySelector(`.modal-panel [aria-label="${label}"]`);
    expect(field).not.toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it('offers the generated table name selected, so typing replaces it', () => {
    const { wb, id } = workbook();
    openTableDialog({ wb, sheetId: () => id, grid: grid() }, { range });
    const name = document.querySelector('.modal-panel [aria-label="Table name"]');
    expect(name.value).not.toBe('');
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, name.value.length]);
  });

  it('offers a prompt\'s value selected too', () => {
    promptDialog({ title: 'Rename sheet', label: 'Name', value: 'Budget' });
    const input = document.querySelector('.modal-panel [aria-label="Name"]');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 6]);
  });
});
