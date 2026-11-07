import { afterEach, beforeEach, expect, it } from 'vitest';
import { Doc, autoSaveEnabled, setAutoSaveEnabled } from '../src/lib/doc.js';
import { installMockPuter } from './helpers/mock-puter.js';

// The AutoSave switch: off, edits wait for Save; turned back on, what is waiting is saved.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
let mock;
beforeEach(() => { mock = installMockPuter(); Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); });
afterEach(() => { delete globalThis.puter; setAutoSaveEnabled(true); });

const documentWrites = () => mock.calls.filter(([op, p]) => op === 'write' && !p.includes('/.versions/'));

it('leaves edits unsaved while AutoSave is off, and saves them when it is turned back on', async () => {
  expect(autoSaveEnabled()).toBe(true);
  const doc = Doc.blank({ excel: true });
  doc.setAutoSave(false);
  expect(autoSaveEnabled()).toBe(false);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'Synthetic');
  await new Promise((r) => setTimeout(r, 1700)); // past the autosave delay
  expect(doc.status).toBe('unsaved');
  expect(documentWrites()).toEqual([]);
  doc.setAutoSave(true);
  for (let i = 0; i < 50 && doc.status !== 'saved'; i++) await new Promise((r) => setTimeout(r, 100));
  expect(documentWrites().map(([, p]) => p)).toEqual(['Spreadsheets/Untitled spreadsheet.xlsx']);
  expect(doc.status).toBe('saved');
});

it('still saves on an explicit Save while AutoSave is off', async () => {
  setAutoSaveEnabled(false);
  const doc = Doc.blank({ excel: true });
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'Synthetic');
  expect(await doc.save()).toBe(true);
  expect(documentWrites().map(([, p]) => p)).toEqual(['Spreadsheets/Untitled spreadsheet.xlsx']);
});

it('drops the AutoSave already waiting on an edit when AutoSave is turned off', async () => {
  const doc = Doc.blank({ excel: true });
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'Synthetic');
  doc.setAutoSave(false); // within the autosave delay of the edit
  await new Promise((r) => setTimeout(r, 1700));
  expect(doc.status).toBe('unsaved');
  expect(documentWrites()).toEqual([]);
});
