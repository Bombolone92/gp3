import { afterEach, beforeEach, expect, it } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
beforeEach(() => { mock = installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

it('does not create a file for an automatic save of an untouched new document', async () => {
  const doc = Doc.blank();
  expect(await doc.save({ auto: true })).toBe(true);
  expect(mock.calls.filter(([op]) => op === 'write')).toEqual([]);
  expect(doc.path).toBe(null);
});

it('does not copy an untouched CSV into the app folder on an automatic save', async () => {
  const doc = new Doc({ name: 'data', path: 'Desktop/data.csv' });
  expect(await doc.save({ auto: true })).toBe(true);
  expect(mock.calls.filter(([op]) => op === 'write')).toEqual([]);
});

it('still writes an explicit save and an automatic save of edits', async () => {
  // Version snapshots are written in the background alongside a save; only the documents count here.
  const documentWrites = () => mock.calls.filter(([op, p]) => op === 'write' && !p.includes('/.versions/')).map(([, p]) => p);
  const blank = Doc.blank();
  await blank.save();
  expect(documentWrites()).toEqual(['Spreadsheets/Untitled spreadsheet.xlsx']);
  const edited = Doc.blank();
  edited.wb.setInput(edited.wb.activeSheetId, 0, 0, 'hello');
  await edited.save({ auto: true });
  expect(documentWrites()).toHaveLength(2);
});

it('settles back to saved when the book is marked clean after a fit on open, and never copies the CSV', async () => {
  const doc = new Doc({ name: 'data', path: 'Desktop/data.csv' });
  const statuses = [];
  doc.addEventListener('status', (e) => statuses.push(e.detail.status));
  doc.wb.setColWidth(doc.wb.activeSheetId, 0, 180); // what fitting the columns on open does
  expect(doc.status).toBe('unsaved');
  doc.wb.clearHistory();
  doc.wb.markClean();
  expect(doc.status).toBe('saved');
  expect(statuses).toEqual(['unsaved', 'saved']);
  await new Promise((r) => setTimeout(r, 1700)); // past the autosave and draft timers
  expect(mock.calls.filter(([op]) => op === 'write')).toEqual([]);
  expect(await doc.save({ auto: true })).toBe(true);
  expect(mock.calls.filter(([op]) => op === 'write')).toEqual([]);
  expect(doc.path).toBe('Desktop/data.csv');
});
