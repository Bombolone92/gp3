import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { listVersions, saveVersion } from '../src/lib/versions.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
beforeEach(() => { mock = installMockPuter(); });
afterEach(() => { delete globalThis.puter; vi.restoreAllMocks(); });

// The version folder used to move in the background: a save queued right after the rename
// wrote a fresh snapshot under the new name first, and the old history was left behind.
it('has the history under the new name by the time rename resolves', async () => {
  const doc = new Doc({ name: 'Old', path: 'Spreadsheets/Old.xlsx' });
  await saveVersion('Spreadsheets/Old.xlsx', new Blob(['v1']), 'first');
  expect(await listVersions('Spreadsheets/Old.xlsx')).toHaveLength(1);
  const slowMove = puter.fs.rename;
  puter.fs.rename = async (...args) => { await new Promise((r) => setTimeout(r, 30)); return slowMove.call(puter.fs, ...args); };
  expect(await doc.rename('New')).toBeNull();
  expect(doc.path).toBe('Spreadsheets/New.xlsx');
  expect(await listVersions('Spreadsheets/New.xlsx')).toHaveLength(1);
  expect(await listVersions('Spreadsheets/Old.xlsx')).toHaveLength(0);
});

// A labelled snapshot of an opened CSV went under the CSV's own folder; the first save then
// moved the document to Spreadsheets/<name>.xlsx, whose history did not have it.
it('saves the .xlsx first when a labelled version is taken of a CSV, so the history stays with the file', async () => {
  const doc = new Doc({ name: 'data', path: 'Desktop/data.csv' });
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, '1');
  await doc.saveVersion('Milestone');
  expect(doc.path).toBe('Spreadsheets/data.xlsx');
  // The first save of the .xlsx may take its own automatic snapshot; the labelled one is with it, not under the CSV.
  // The history is the new file's own, kept under its id on the drive.
  const versions = await listVersions(doc.file);
  expect(versions.map((v) => v.label)).toContain('Milestone');
  expect(await listVersions('Desktop/data.csv')).toEqual([]);
});
