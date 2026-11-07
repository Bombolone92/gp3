import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx } from '../src/core/io.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

// The open-time scan read every conditional rule's value and every dropdown's list as a formula.
// Once a reaching function counted by its bare name, a rule highlighting the text "AI" or a list
// offering Yes, No, AI made a file in the app folder ask before it opened trusted. Only what the
// workbook itself reads as a formula is scanned now: formula rules, and lists drawn from a range
// or a formula.
let mock;
beforeAll(async () => { await workbookToXlsx(new Workbook()); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

const A1 = { r1: 0, c1: 0, r2: 0, c2: 0 };
const B1 = { r1: 0, c1: 1, r2: 0, c2: 1 };
async function fileWith(decorate) {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, 'https://example.com/a.csv');
  decorate(wb, wb.activeSheetId);
  const blob = await workbookToXlsx(wb);
  const path = `Spreadsheets/${Math.random().toString(36).slice(2)}.xlsx`;
  mock.fs.set(path, { blob, size: blob.size, modified: 1 });
  return path;
}

it('opens trusted a file whose rules and dropdowns merely mention a reaching function as text', async () => {
  const doc = await Doc.fromPath(await fileWith((wb, id) => {
    wb.addRule(id, { range: A1, type: 'contains', value: 'AI', style: { bold: true } });
    wb.addRule(id, { range: B1, type: 'eq', value: 'IMPORTDATA', style: { bold: true } });
    wb.addValidation(id, { range: A1, type: 'list', source: 'Yes, No, AI' });
    wb.addValidation(id, { range: B1, type: 'list', source: 'IMAGE' });
  }));
  expect(doc.wb.sheets[0].rules.map((r) => r.value)).toEqual(['AI', 'IMPORTDATA']);
  expect(doc.wb.sheets[0].validations.map((r) => r.source)).toEqual(['Yes, No, AI', 'IMAGE']);
  expect(doc.wb.externalAllowed).toBe(true);
});

it('still asks for a formula rule, or a dropdown drawn from a formula, that reaches out', async () => {
  const decorations = [
    (wb, id) => wb.addRule(id, { range: A1, type: 'formula', value: '=IMPORTDATA(A1)', style: { bold: true } }),
    (wb, id) => wb.addRule(id, { range: A1, type: 'formula', value: '=LET(f, IMPORTDATA, f(A1))', style: { bold: true } }),
    (wb, id) => wb.addValidation(id, { range: B1, type: 'list', source: '=MAP(A1, IMPORTDATA)' }),
    (wb, id) => wb.addValidation(id, { range: B1, type: 'formula', source: '=ISTEXT(AI(A1))' }),
  ];
  for (const decorate of decorations) {
    const doc = await Doc.fromPath(await fileWith(decorate));
    expect(doc.wb.sheets[0].rules.length + doc.wb.sheets[0].validations.length).toBe(1);
    expect(doc.wb.externalAllowed).toBe(false);
  }
});
