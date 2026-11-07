import { afterEach, expect, it } from 'vitest';
import { formulaReachesOut, textReachesOut } from '../src/core/reaches-out.js';
import { Workbook, MAX_FORMULA_LENGTH } from '../src/core/workbook.js';
import { Doc } from '../src/lib/doc.js';
import { workbookToXlsx } from '../src/core/io.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

const request = 'SUM(MAP("https://example.test/data",IMPORTDATA))';
const longFormula = '1+'.repeat(4000) + request;
let doc;
afterEach(() => { doc?.destroy(); doc = null; delete globalThis.puter; });

it('finds outside requests anywhere in a valid long operator chain', () => {
  for (const formula of [longFormula, request + '+1'.repeat(4000), '1+'.repeat(2000) + request + '+1'.repeat(2000)]) {
    expect(formula.length).toBeLessThan(MAX_FORMULA_LENGTH);
    expect(formulaReachesOut(formula)).toBe(true);
    expect(textReachesOut(`=${formula}`)).toBe(true);
  }
});

it('keeps long harmless formulas and inline pictures trusted', () => {
  expect(formulaReachesOut('1+'.repeat(4000) + 'LEN("IMPORTDATA")')).toBe(false);
  expect(formulaReachesOut('IMAGE("data:"' + '&A1'.repeat(2500) + ')')).toBe(false);
});

it('opens a file with a long request formula blocked until the user allows it', async () => {
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
  const mock = installMockPuter();
  const source = new Workbook();
  source.setInput(source.activeSheetId, 0, 0, `=${longFormula}`);
  expect(source.getCell(source.activeSheetId, 0, 0).f).toBe(longFormula);
  const blob = await workbookToXlsx(source);
  const path = 'Spreadsheets/Long formula.xlsx';
  mock.fs.set(path, { blob, size: blob.size, modified: 1 });
  doc = await Doc.fromPath(path);
  const { wb } = doc, id = wb.activeSheetId;
  const calls = [];
  wb.setAsyncProvider('IMPORTDATA', async (text) => { calls.push(text); return [[1]]; });
  expect(wb.externalAllowed).toBe(false);
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BLOCKED!' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toEqual([]);

  doc.allowExternal();
  wb.getValue(id, 0, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toHaveLength(1);
  expect(wb.getValue(id, 0, 0)).toBe(4001);
});
