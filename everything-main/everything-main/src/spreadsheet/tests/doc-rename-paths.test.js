import { afterEach, beforeEach, expect, it } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
beforeEach(() => { mock = installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

it('renames a file that has no extension without inventing one', async () => {
  const doc = new Doc({ name: 'data', path: 'Desktop/data' });
  expect(await doc.rename('renamed')).toBe(null);
  expect(mock.calls.filter(([op]) => op === 'rename')).toEqual([['rename', 'Desktop/data', 'renamed']]);
  expect(doc.path).toBe('Desktop/renamed');
  expect(doc.name).toBe('renamed');
});

it('keeps the extension of other files and handles dotted folders', async () => {
  const csv = new Doc({ name: 'data', path: 'My.Files/data.csv' });
  await csv.rename('renamed');
  expect(csv.path).toBe('My.Files/renamed.csv');
  const nested = new Doc({ name: 'notes', path: 'v1.2/notes' });
  await nested.rename('todo');
  expect(nested.path).toBe('v1.2/todo');
  const xlsx = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  await xlsx.rename('Plan.xlsx');
  expect(xlsx.path).toBe('Spreadsheets/Plan.xlsx');
  expect(xlsx.name).toBe('Plan');
});

it('names the old path in the path event so a stale recent entry can be dropped', async () => {
  const { Doc } = await import('../src/lib/doc.js');
  const { installMockPuter } = await import('./helpers/mock-puter.js');
  installMockPuter();
  await puter.fs.write('Spreadsheets/Old.xlsx', new Blob(['x']));
  const doc = new Doc({ name: 'Old', path: 'Spreadsheets/Old.xlsx' });
  const events = [];
  doc.addEventListener('path', (e) => events.push(e.detail));
  expect(await doc.rename('New')).toBeNull();
  expect(events).toEqual([{ path: 'Spreadsheets/New.xlsx', name: 'New', oldPath: 'Spreadsheets/Old.xlsx' }]);
  delete globalThis.puter;
});
