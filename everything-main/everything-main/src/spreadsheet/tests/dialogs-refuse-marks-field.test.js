// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openNamesManager } from '../src/ui/names.js';
import { openTableDialog } from '../src/ui/tabledialog.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { openValidationManager } from '../src/ui/validation.js';
import { openProtectedRanges } from '../src/ui/protect.js';
import { openPivotDialog } from '../src/ui/pivotdialog.js';
import { openDedupeDialog } from '../src/ui/dedupedialog.js';
import { openGoalSeek } from '../src/ui/goalseek.js';
import { openSeriesDialog } from '../src/ui/seriesdialog.js';
import { openTextBoxDialog } from '../src/ui/textboxdialog.js';
import { openCopySheetDialog } from '../src/ui/copysheet.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as S from '../src/core/selection.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(P, 'listFiles').mockResolvedValue([]);
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// Eleven dialogs showed a refusal as text alone: the field was not marked aria-invalid, the message was
// not tied to it, and the focus stayed on the Save button, so a screen reader heard the alert once with
// no way to find which of the form's fields was at fault. Each refusal now names its field.
const panel = () => [...document.querySelectorAll('.modal-root:not(.closing):not([inert]) .modal-panel')].at(-1);
const field = (label) => panel().querySelector(`[aria-label="${label}"]`);
/** A checkbox by the text of its label. */
const check = (text) => [...panel().querySelectorAll('label')].find((l) => l.textContent.includes(text)).querySelector('input');
const submit = () => { document.activeElement?.blur?.(); panel().querySelector('form').requestSubmit(); };

/**
 * The refusal a screen reader and a keyboard user can follow: one field (by aria-label, or the node)
 * marked, described by the message, focused. `fix` puts a value the field accepts before it is changed,
 * for a field that is judged as it is typed.
 */
function expectRefusal(label, message, fix = () => {}) {
  const alert = [...panel().querySelectorAll('[role="alert"]')].find((n) => !n.hidden);
  expect(alert, 'a visible alert').toBeTruthy();
  expect(alert.textContent).toMatch(message);
  const target = typeof label === 'string' ? field(label) : label;
  expect(target, `a field labelled ${label}`).toBeTruthy();
  expect([...panel().querySelectorAll('[aria-invalid="true"]')]).toEqual([target]);
  expect(target.getAttribute('aria-describedby')).toBe(alert.id);
  expect(document.activeElement).toBe(target);
  // A changed value is no longer the one refused: the mark and the message go until the next submit.
  fix(target);
  target.dispatchEvent(new Event(target.matches('select, input[type="checkbox"]') ? 'change' : 'input', { bubbles: true }));
  expect(target.hasAttribute('aria-invalid')).toBe(false);
  expect(target.hasAttribute('aria-describedby')).toBe(false);
  expect(alert.hidden).toBe(true);
}

function workbook() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Item', 'Amount'], ['A', '10'], ['B', '20'], ['C', '30']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  return { wb, id };
}
const grid = () => ({ focus: vi.fn(), setSelection: vi.fn(), range: { r1: 0, c1: 0, r2: 0, c2: 0 } });

describe('Named ranges', () => {
  const open = () => {
    const { wb, id } = workbook();
    expect(wb.defineName('Total', 'Sheet1!$B$4')).toBeNull();
    openNamesManager({ wb, sheetId: () => id, grid: grid(), run: vi.fn() });
    document.querySelector('[aria-label="New name"]').click();
    return { wb, id };
  };
  it('blames Refers to for a reference that does not read', () => {
    open();
    field('Name').value = 'Sales';
    // Space-separated words can now be intersecting defined names; use
    // genuinely malformed syntax to exercise the accessible refusal.
    field('Refers to').value = 'A1 + )';
    submit();
    expectRefusal('Refers to', /reference/i);
  });
  it('accepts a reference intersection as a named formula', () => {
    const { wb, id } = open();
    field('Name').value = 'Sales';
    field('Refers to').value = 'Sheet1!$B$2:$B$4 Sheet1!$B$3';
    submit();
    expect(wb.names.some(n => n.name === 'Sales')).toBe(true);
    wb.setInput(id, 5, 4, '=Sales');
    expect(wb.getValue(id, 5, 4)).toBe(20);
  });
  it('blames Name for a spelling already used, or one that cannot be a name', () => {
    const { wb } = open();
    field('Name').value = 'total';
    field('Refers to').value = 'Sheet1!$B$2';
    submit();
    expectRefusal('Name', /already used/i);
    field('Name').value = '1st';
    submit();
    expectRefusal('Name', /start with a letter/i);
    expect(wb.names).toHaveLength(1);
  });
});

describe('Create table', () => {
  const open = (prepare = () => {}) => {
    const { wb, id } = workbook();
    prepare(wb, id);
    openTableDialog({ wb, sheetId: () => id, grid: grid() }, { range: { r1: 0, c1: 0, r2: 3, c2: 1 } });
    return { wb, id };
  };
  it('blames Range for an overlap with another table, a range that does not read, or merged cells', () => {
    const { wb, id } = open((wb, id) => { wb.addTable(id, { r1: 0, c1: 3, r2: 2, c2: 3 }); });
    field('Range').value = 'A1:D4';
    submit();
    expectRefusal('Range', /overlaps/i);
    field('Range').value = 'nowhere';
    submit();
    expectRefusal('Range', /range like/i);
    wb.mergeCells(id, { r1: 1, c1: 0, r2: 1, c2: 1 });
    field('Range').value = 'A1:B4';
    submit();
    expectRefusal('Range', /merged/i);
    expect(wb.tablesOn(id)).toHaveLength(1);
  });
  it('blames Table name for a name that cannot be used', () => {
    open();
    field('Table name').value = 'A1';
    submit();
    expectRefusal('Table name', /./);
  });
  it('blames the Totals row box when the totals row would be protected', () => {
    const { wb, id } = open((wb, id) => { wb.protectRange(id, { r1: 4, c1: 0, r2: 4, c2: 1 }, 'locked'); });
    check('Totals row').checked = true;
    submit();
    expectRefusal(check('Totals row'), /totals row is protected/i);
    expect(wb.tablesOn(id)).toHaveLength(0);
  });
});

const dataRange = { r1: 1, c1: 1, r2: 3, c2: 1 };
const choose = (label, value) => { field(label).value = value; field(label).dispatchEvent(new Event('change', { bubbles: true })); };

describe('Conditional formatting', () => {
  const open = () => {
    const { wb, id } = workbook();
    openConditionalFormatting({ wb, sheetId: () => id, range: () => dataRange, grid: grid() });
    return { wb, id };
  };
  it('blames the range field, then the value fields, in turn', () => {
    const { wb, id } = open();
    field('Apply to range').value = 'nope';
    submit();
    expectRefusal('Apply to range', /range like/i);
    field('Apply to range').value = 'B2:B4';
    submit();
    expectRefusal('Value', /enter a value/i);
    choose('Condition', 'between');
    field('Value').value = '1';
    submit();
    expectRefusal('Second value', /both values/i);
    field('Second value').value = 'ten';
    submit();
    expectRefusal('Second value', /needs numbers/i);
    expect(wb.sheet(id).rules).toHaveLength(0);
  });
  it('blames the threshold field of an icon set that is left empty', () => {
    open();
    choose('Condition', 'icons');
    field('Low threshold percent').value = '';
    submit();
    expectRefusal('Low threshold percent', /both thresholds/i);
    field('Low threshold percent').value = '80';
    submit();
    expectRefusal('High threshold percent', /0 to 100/i);
  });
});

describe('Data validation', () => {
  const open = () => {
    const { wb, id } = workbook();
    openValidationManager({ wb, sheetId: () => id, range: () => dataRange, grid: grid() });
    return { wb, id };
  };
  it('blames the list options, the range, and the bound that is wrong', () => {
    const { wb, id } = open();
    submit();
    expectRefusal('List options', /list options/i);
    field('List options').value = 'a, b';
    field('Apply to range').value = 'nope';
    submit();
    expectRefusal('Apply to range', /range like/i);
    field('Apply to range').value = 'B2:B4';
    choose('Type', 'number');
    field('Minimum').value = '5';
    field('Maximum').value = '1';
    submit();
    expectRefusal('Minimum', /must not exceed/i);
    choose('Type', 'text');
    field('Minimum').value = '1';
    field('Maximum').value = '2.5';
    submit();
    expectRefusal('Maximum', /whole numbers/i);
    choose('Type', 'date');
    field('Earliest date').value = '2024-05-01';
    field('Latest date').value = '2024-01-01';
    submit();
    expectRefusal('Earliest date', /must not exceed/i);
    expect(wb.sheet(id).validations).toHaveLength(0);
  });
});

describe('Protected ranges', () => {
  it('blames the Range field for a range that does not read or is already protected', () => {
    const { wb, id } = workbook();
    wb.protectRange(id, { r1: 1, c1: 1, r2: 3, c2: 3 }, 'Totals');
    openProtectedRanges({ wb, sheetId: () => id, range: () => dataRange, grid: grid() });
    field('Range').value = 'nope';
    submit();
    expectRefusal('Range', /range like/i);
    field('Range').value = 'D4:B2';
    submit();
    expectRefusal('Range', /already protected/i);
    expect(wb.sheet(id).protectedRanges).toHaveLength(1);
  });
});

const tableRange = { r1: 0, c1: 0, r2: 3, c2: 1 };

describe('Pivot table', () => {
  const open = () => {
    const { wb, id } = workbook();
    openPivotDialog({ wb, sheetId: () => id, range: () => tableRange, selection: () => S.fromRange(tableRange, { r: 0, c: 0 }), grid: grid() });
    return { wb, id };
  };
  it('marks the source range as it is typed and blames Columns for a field that is also the rows', () => {
    const { wb } = open();
    field('Source range').value = 'nope';
    field('Source range').dispatchEvent(new Event('input', { bubbles: true }));
    submit();
    expectRefusal('Source range', /./, (f) => { f.value = 'A1:B4'; });
    choose('Columns', field('Rows').value);
    submit();
    expectRefusal('Columns', /different fields/i);
    expect(wb.sheets).toHaveLength(1);
  });
});

describe('Remove duplicates', () => {
  it('blames the first column box when no column is left to compare', () => {
    const { wb, id } = workbook();
    openDedupeDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), selection: () => S.fromRange(tableRange, { r: 0, c: 0 }), grid: grid() }, tableRange);
    [...panel().querySelectorAll('button')].find((b) => b.textContent === 'Clear').click();
    submit();
    expectRefusal(panel().querySelector('.dedupe-cols input'), /at least one column/i);
    expect(wb.getValue(id, 3, 0)).toBe('C');
  });
});

describe('Goal seek', () => {
  it('blames the empty To value, then the cell to change', () => {
    const { wb, id } = workbook();
    openGoalSeek({ wb, sheetId: () => id, active: () => ({ r: 3, c: 1 }), grid: grid() });
    submit();
    expectRefusal('To value', /value to reach/i);
    field('To value').value = '5';
    field('By changing cell').value = 'zzz';
    submit();
    expectRefusal('By changing cell', /cell to change/i);
  });
});

describe('Fill series', () => {
  it('blames the Step field, and the Stop value a single cell needs', () => {
    const { wb, id } = workbook();
    openSeriesDialog({ wb, sheetId: () => id, range: () => ({ r1: 1, c1: 1, r2: 5, c2: 1 }), grid: grid() });
    field('Step').value = '';
    submit();
    expectRefusal('Step', /enter a step/i);
    closeAllModals();
    vi.runAllTimers();
    openSeriesDialog({ wb, sheetId: () => id, range: () => ({ r1: 1, c1: 1, r2: 1, c2: 1 }), grid: grid() });
    submit();
    expectRefusal('Stop value', /stop value/i);
    expect(wb.getValue(id, 2, 1)).toBe(20);
  });
});

describe('Text box', () => {
  it('blames the Text field when it is empty', () => {
    const { wb, id } = workbook();
    openTextBoxDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid: grid() }, {});
    submit();
    expectRefusal('Text', /type some text/i);
    expect(wb.sheet(id).charts).toHaveLength(0);
  });
});

describe('Copy sheet', () => {
  it('blames the name of a new spreadsheet, or the choice of an existing one', async () => {
    const { wb, id } = workbook();
    P.listFiles.mockResolvedValue([{ name: 'Other.xlsx', path: 'Spreadsheets/Other.xlsx' }]); // so the choice is open at all
    openCopySheetDialog({ wb, sheetId: () => id, grid: grid(), run: vi.fn() }, id);
    await vi.advanceTimersByTimeAsync(1);
    field('Name of the new spreadsheet').value = '';
    submit();
    await vi.advanceTimersByTimeAsync(1);
    expectRefusal('Name of the new spreadsheet', /enter a name/i);
    panel().querySelector('input[type="radio"][value="existing"]').click();
    field('Spreadsheet to copy into').value = ''; // nothing chosen
    submit();
    await vi.advanceTimersByTimeAsync(1);
    expectRefusal('Spreadsheet to copy into', /choose a spreadsheet/i);
  });
});
