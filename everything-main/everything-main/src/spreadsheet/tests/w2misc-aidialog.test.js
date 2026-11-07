// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openAiDialog } from '../src/ui/aidialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { textReachesOut } from '../src/core/reaches-out.js';
import { sampleRange } from '../src/core/aiformula.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
// The scan the open and paste paths share, made switchable so a test can flag any formula.
vi.mock('../src/core/reaches-out.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, textReachesOut: vi.fn(real.textReachesOut) };
});
// The rows the prompt quotes, made switchable so a test can check the note follows them.
vi.mock('../src/core/aiformula.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, sampleRange: vi.fn(real.sampleRange) };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(P, 'canAI').mockReturnValue(true);
  textReachesOut.mockClear();
  sampleRange.mockClear();
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** Opens the write dialog on A2, has the AI reply with `reply`, and inserts it. */
async function insertFormula(reply) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'secret');
  vi.spyOn(P, 'aiChat').mockResolvedValue(reply);
  const doc = { distrustExternal: vi.fn() };
  const { panel } = openAiDialog({
    wb, doc, sheetId: () => id, active: () => ({ r: 1, c: 0 }),
    range: () => ({ r1: 1, c1: 0, r2: 1, c2: 0 }), grid: { focus() {} },
  }, { mode: 'write' });
  panel.querySelector('textarea').value = 'Total of column A';
  panel.querySelector('form').requestSubmit();
  await vi.advanceTimersByTimeAsync(0);
  [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Insert into A2').click();
  return { wb, id, doc };
}

// The dialog kept its own copy of the reach-out pattern, so a provider added to
// the shared scan would have been inserted from here without asking.
it('gates an inserted formula through the shared reach-out scan', async () => {
  textReachesOut.mockReturnValueOnce(true);
  const { wb, id, doc } = await insertFormula('=SUM(A1:A3)');
  expect(textReachesOut).toHaveBeenCalledWith('=SUM(A1:A3)');
  expect(wb.getCell(id, 1, 0).f).toBe('SUM(A1:A3)');
  expect(doc.distrustExternal).toHaveBeenCalledTimes(1);
});

it('leaves a formula alone when the shared scan does', async () => {
  const { wb, id, doc } = await insertFormula('=SUM(A1:A3)');
  expect(textReachesOut).toHaveBeenCalledWith('=SUM(A1:A3)');
  expect(wb.getCell(id, 1, 0).f).toBe('SUM(A1:A3)');
  expect(doc.distrustExternal).not.toHaveBeenCalled();
});

/** The "Data sent" note of a write dialog opened over three rows in A1:C3. */
function dataNoteFor(sample) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Name', 'Qty', 'Price'], ['Pen', 3, 1.5], ['Ink', 5, 2]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  sampleRange.mockReturnValueOnce(sample);
  const { panel } = openAiDialog({
    wb, sheetId: () => id, active: () => ({ r: 5, c: 0 }),
    range: () => ({ r1: 5, c1: 0, r2: 5, c2: 0 }), grid: { focus() {} },
  }, { mode: 'write' });
  expect(sampleRange).toHaveBeenCalledTimes(1);
  return [...panel.querySelectorAll('.field-hint')].find((hint) => hint.textContent.startsWith('Data sent:')).textContent;
}

// The note worked out the sample rows by a rule of its own; it now names the
// rows the prompt quotes (sampleRange in core/aiformula.js), whatever they are.
it.each([
  [{ r1: 4, c1: 2, r2: 5, c2: 6 }, ' and rows 5–6 of C:G'],
  [{ r1: 1, c1: 0, r2: 1, c2: 2 }, ' and row 2 of A:C'],
  [null, ''],
])('names the sample rows the prompt quotes: %j', (sample, rows) => {
  expect(dataNoteFor(sample)).toBe(`Data sent: headers in A1:C1${rows} on Sheet1, values as shown, with the names of the sheets, tables, and named ranges.`);
});

// A table starting at C2 was announced as headers in A1:D1 with rows 2–4 sent,
// while the prompt found no headers in row 1 and quoted the header row as data.
it('describes a table that does not start at A1 from its own first cell', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Item', 'Qty'], ['Pen', 3], ['Ink', 5]].flatMap((row, r) => row.map((v, c) => ({ r: r + 1, c: c + 2, cell: { v } }))));
  const prompts = [];
  vi.spyOn(P, 'aiChat').mockImplementation(async (prompt) => { prompts.push(prompt); return '=SUM(D3:D4)'; });
  const { panel } = openAiDialog({
    wb, sheetId: () => id, active: () => ({ r: 5, c: 3 }),
    range: () => ({ r1: 5, c1: 3, r2: 5, c2: 3 }), grid: { focus() {} },
  }, { mode: 'write' });
  const note = [...panel.querySelectorAll('.field-hint')].find((hint) => hint.textContent.startsWith('Data sent:'));
  expect(note.textContent).toBe('Data sent: headers in C2:D2 and rows 3–4 of C:D on Sheet1, values as shown, with the names of the sheets, tables, and named ranges.');
  panel.querySelector('textarea').value = 'Total quantity';
  panel.querySelector('form').requestSubmit();
  await vi.advanceTimersByTimeAsync(0);
  expect(prompts[0]).toContain('First row of the data (likely headers): C2="Item", D2="Qty".');
  expect(prompts[0]).toContain('Data occupies C2:D4.');
  expect(prompts[0]).toContain('Row 3: Pen | 3');
  expect(prompts[0]).not.toContain('Row 2:');
});

// Asking about the sheet's data with one cell selected sent A1:D4 for a table
// at C2:D4, the blank columns A and B included, and the note said so.
it('asks about the sheet\'s data from its first cell when one cell is selected', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Item', 'Qty'], ['Pen', 3], ['Ink', 5]].flatMap((row, r) => row.map((v, c) => ({ r: r + 1, c: c + 2, cell: { v } }))));
  const prompts = [];
  vi.spyOn(P, 'aiChat').mockImplementation(async (prompt) => { prompts.push(prompt); return 'Eight in all.'; });
  const { panel } = openAiDialog({
    wb, sheetId: () => id, active: () => ({ r: 5, c: 3 }),
    range: () => ({ r1: 5, c1: 3, r2: 5, c2: 3 }), grid: { focus() {} },
  }, { mode: 'ask' });
  const note = [...panel.querySelectorAll('.field-hint')].find((hint) => hint.textContent.startsWith('Data sent:'));
  expect(note.textContent).toBe('Data sent: C2:D4 (the sheet\'s data; select cells first to ask about part of it) on Sheet1, values as shown, with the names of the sheets, tables, and named ranges.');
  panel.querySelector('textarea').value = 'How many items in all?';
  panel.querySelector('form').requestSubmit();
  await vi.advanceTimersByTimeAsync(0);
  expect(prompts[0]).toContain('Cells C2:D4 (row numbers first, columns tab-separated):\n\tC\tD\n2\tItem\tQty\n3\tPen\t3\n4\tInk\t5');
});
