// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openAiDialog } from '../src/ui/aidialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { parseRange } from '../src/core/cell.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(P, 'canAI').mockReturnValue(true);
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

const TAIL = 'on Sheet1, values as shown, with the names of the sheets, tables, and named ranges.';

/** A sheet of `rows` rows under `cols` headers (Name, Salary, SSN, Notes, then H5…), each cell naming its column and row. */
function staffSheet(rows = 9, cols = 4) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const headers = ['Name', 'Salary', 'SSN', 'Notes'];
  const cells = [];
  for (let c = 0; c < cols; c++) {
    cells.push({ r: 0, c, cell: { v: headers[c] || `H${c + 1}` } });
    for (let r = 1; r < rows; r++) cells.push({ r, c, cell: { v: c === 1 ? r * 1000 : c === 0 ? `Person${r}` : c === 2 ? `SSN-${r}` : c === 3 ? `Secret note ${r}` : `${headers[c] || `H${c + 1}`}${r}` } });
  }
  wb.setCells(id, cells);
  return { wb, id };
}

/** Opens Ask AI over `range`, asks a question, and returns the note shown and the prompt sent. */
async function askOver(wb, id, range) {
  const sel = parseRange(range);
  const prompts = [];
  vi.spyOn(P, 'aiChat').mockImplementation(async (prompt) => { prompts.push(prompt); return 'An answer.'; });
  const { panel } = openAiDialog({
    wb, sheetId: () => id, active: () => ({ r: sel.r1, c: sel.c1 }),
    range: () => sel, grid: { focus() {} },
  }, { mode: 'ask' });
  const note = [...panel.querySelectorAll('.field-hint')].find((hint) => hint.textContent.startsWith('Data sent:')).textContent;
  panel.querySelector('textarea').value = 'What stands out?';
  panel.querySelector('form').requestSubmit();
  await vi.advanceTimersByTimeAsync(0);
  return { note, prompt: prompts[0] };
}

// The note named the selection while the prompt also carried the sheet's header row and three
// sample rows from every column, the SSN and Notes columns outside the selection included.
it('sends a selected column with its header and nothing from the other columns, and says so', async () => {
  const { wb, id } = staffSheet();
  const { note, prompt } = await askOver(wb, id, 'B2:B9');
  expect(note).toBe(`Data sent: B2:B9 and its header B1 ${TAIL}`);
  expect(prompt).toContain('B1="Salary"');
  expect(prompt).toContain('Cells B2:B9 (row numbers first, columns tab-separated):\n\tB\n2\t1000\n3\t2000');
  for (const outside of ['SSN', 'Secret note', 'Person', 'Name', 'Row 2:', 'First row of the data']) expect(prompt).not.toContain(outside);
});

it('sends a selection that starts on the header row as it is, with no header line', async () => {
  const { wb, id } = staffSheet();
  const { note, prompt } = await askOver(wb, id, 'A1:B3');
  expect(note).toBe(`Data sent: A1:B3 ${TAIL}`);
  expect(prompt).toContain('\tA\tB\n1\tName\tSalary\n2\tPerson1\t1000\n3\tPerson2\t2000');
  for (const outside of ['SSN', 'Secret note', 'Headers', 'Row 2:']) expect(prompt).not.toContain(outside);
});

it('names the part of a large selection that is sent, headers included', async () => {
  const { wb, id } = staffSheet(70, 20);
  const { note, prompt } = await askOver(wb, id, 'A2:T70');
  expect(note).toBe(`Data sent: A2:O61 (the first 60 rows and 15 columns of A2:T70) and its headers A1:O1 ${TAIL}`);
  expect(prompt).toContain('O1="H15"');
  expect(prompt).not.toContain('P1=');
  expect(prompt).toContain('(9 more rows and 5 more columns not shown)');
});

it('sends the sheet\'s data and nothing else of the sheet when one cell is selected', async () => {
  const { wb, id } = staffSheet();
  const { note, prompt } = await askOver(wb, id, 'F12');
  expect(note).toBe(`Data sent: A1:D9 (the sheet's data; select cells first to ask about part of it) ${TAIL}`);
  expect(prompt).toContain('Cells A1:D9 (row numbers first, columns tab-separated):\n\tA\tB\tC\tD\n1\tName\tSalary\tSSN\tNotes\n2\tPerson1\t1000\tSSN-1\tSecret note 1');
  for (const twice of ['Row 2:', 'First row of the data']) expect(prompt).not.toContain(twice);
});

// The header line of the sheet description named 31 columns while the data block stopped at 15.
it('names the part of a wide sheet that is sent when one cell is selected', async () => {
  const { wb, id } = staffSheet(70, 20);
  const { note, prompt } = await askOver(wb, id, 'A1');
  expect(note).toBe(`Data sent: A1:O60 (the first 60 rows and 15 columns of the sheet's data A1:T70; select cells first to ask about part of it) ${TAIL}`);
  expect(prompt).not.toContain('P1=');
  expect(prompt).not.toContain('H16');
});

it('takes the header row of the table a selection sits in', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: 'Title' } }, { r: 1, c: 0, cell: { v: 'Private' } },
    ...[['Item', 'Qty'], ['Pen', 3], ['Ink', 5], ['Cap', 2]].flatMap((row, r) => row.map((v, c) => ({ r: r + 4, c: c + 2, cell: { v } })))]);
  wb.addTable(id, parseRange('C5:D8'), { name: 'Stock' });
  const { note, prompt } = await askOver(wb, id, 'D7:D8');
  expect(note).toBe(`Data sent: D7:D8 and its header D5 ${TAIL}`);
  expect(prompt).toContain('D5="Qty"');
  expect(prompt).toContain('\tD\n7\t5\n8\t2');
  // The table's column names travel with its name, as the note says; its cells do not.
  expect(prompt).toContain('Table "Stock" with columns [Item], [Qty]');
  for (const outside of ['Title', 'Private', 'Pen', 'Ink', 'C5', 'Row 5:']) expect(prompt).not.toContain(outside);
});

it('keeps the sheet\'s tables and names in the prompt without its cells', async () => {
  const { wb, id } = staffSheet();
  wb.defineName('Pay', 'Sheet1!$B$2:$B$9');
  const { prompt } = await askOver(wb, id, 'B2:B9');
  expect(prompt).toContain('Named ranges: Pay = Sheet1!$B$2:$B$9.');
  expect(prompt).toContain('Data occupies A1:D9.');
});
