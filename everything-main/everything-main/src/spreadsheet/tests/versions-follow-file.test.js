import { afterEach, beforeEach, expect, it } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { listVersions, removeVersions, moveVersions, saveVersion } from '../src/lib/versions.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
beforeEach(() => { mock = installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

it('deletes a document\'s snapshots with the document', async () => {
  const path = 'Spreadsheets/Untitled spreadsheet.xlsx';
  await saveVersion(path, new Blob(['v1']), 'first');
  expect(await listVersions(path)).toHaveLength(1);
  expect(await removeVersions(path)).toBe(true);
  expect(await listVersions(path)).toEqual([]);
  // A later file with the same name starts with no history.
  expect(await removeVersions(path)).toBe(false);
});

it('moves snapshots when the document is renamed', async () => {
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  mock.fs.set('Spreadsheets/Budget.xlsx', { blob: new Blob(['x']), size: 1, modified: 1 });
  await saveVersion(doc.path, new Blob(['v1']), 'first');
  expect(await doc.rename('Plan')).toBe(null);
  await new Promise((r) => setTimeout(r, 0));
  expect(await listVersions('Spreadsheets/Plan.xlsx')).toHaveLength(1);
  expect(await listVersions('Spreadsheets/Budget.xlsx')).toEqual([]);
});

// A history already at the destination is a gone file's (the name was free for the rename): it is put aside, not merged with.
it('puts an occupied destination aside and moves the snapshots there', async () => {
  await saveVersion('Spreadsheets/A.xlsx', new Blob(['a']), 'a');
  await saveVersion('Spreadsheets/B.xlsx', new Blob(['b']), 'b');
  expect(await moveVersions('Spreadsheets/A.xlsx', 'Spreadsheets/B.xlsx')).toBe(true);
  expect((await listVersions('Spreadsheets/B.xlsx')).map((v) => v.label)).toEqual(['a']);
  expect(await listVersions('Spreadsheets/A.xlsx')).toEqual([]);
});
