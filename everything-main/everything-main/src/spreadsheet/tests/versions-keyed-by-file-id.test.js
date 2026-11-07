import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import * as P from '../src/lib/puter.js';
import { listVersions, saveVersion, versionsFolder } from '../src/lib/versions.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
  mock = installMockPuter();
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const BUDGET = 'Spreadsheets/Budget.xlsx';
const labels = async (file) => (await listVersions(file)).map((v) => v.label).sort();
const historyFolders = async () => (await P.listDir(`${P.FOLDER}/.versions`)).filter((it) => it.is_dir).map((it) => it.name).sort();
async function bytesOf(value) {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, value);
  return new Doc({ wb }).toXlsxBlob();
}

/** Budget.xlsx saved here, with an automatic snapshot and a labelled one. */
async function budgetWithHistory() {
  const doc = new Doc({ wb: new Workbook() });
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'budget');
  await doc.rename('Budget');
  expect(await doc.save()).toBe(true);
  await doc._versioning;
  await doc.saveVersion('Q1 final');
  expect(await labels(doc.file)).toEqual(['', 'Q1 final']);
  doc.destroy();
  return doc;
}

// Histories were kept under the file's name, so a rename or a move made outside the app — which the
// app never sees — left the whole history behind under a name nothing read, pruned or deleted again.
it('keeps the history when the file is renamed outside the app', async () => {
  const before = await budgetWithHistory();
  await puter.fs.rename(BUDGET, 'Q3.xlsx'); // the desktop renames it while the app is not looking
  const doc = await Doc.fromPath('Spreadsheets/Q3.xlsx');
  try {
    expect(doc.uid).toBe(before.uid);
    expect(await labels(doc.file)).toEqual(['', 'Q1 final']);
    // The next snapshot brings the folder back to the name the file has now; the history is one folder still.
    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'more');
    expect(await doc.save()).toBe(true);
    await doc._versioning;
    await doc.saveVersion('Q3 checkpoint');
    expect(await labels(doc.file)).toEqual(['', 'Q1 final', 'Q3 checkpoint']);
    expect(await historyFolders()).toEqual([P.displayName(versionsFolder(doc.file))]);
    expect(P.displayName(versionsFolder(doc.file))).toMatch(/^Q3 ~/);
  } finally { doc.destroy(); }
});

it('follows a rename made in the app without leaving a folder behind', async () => {
  const before = await budgetWithHistory();
  const doc = await Doc.fromPath(BUDGET);
  try {
    expect(await doc.rename('Plan')).toBeNull();
    expect(await labels(doc.file)).toEqual(['', 'Q1 final']);
    expect(await historyFolders()).toEqual([P.displayName(versionsFolder(doc.file))]);
    expect(P.displayName(versionsFolder(doc.file))).toMatch(/^Plan ~/);
    expect(versionsFolder(doc.file)).not.toBe(versionsFolder(before.file));
  } finally { doc.destroy(); }
});

// A history from before ids were used sits under the file's name alone.
it('reads a history kept under the name alone, and takes it over at the next snapshot', async () => {
  const bytes = await bytesOf('budget');
  mock.fs.set(BUDGET, { blob: bytes, size: bytes.size, modified: 1 });
  await saveVersion(BUDGET, await bytesOf('older'), 'Q1 final'); // written the way histories were kept
  expect(await historyFolders()).toEqual(['Budget']);
  const doc = await Doc.fromPath(BUDGET);
  try {
    expect(await labels(doc.file)).toEqual(['Q1 final']); // read where it is, before anything moves
    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'more');
    expect(await doc.save()).toBe(true);
    await doc._versioning;
    // The folder the file's id names holds the old snapshot now, though this save was too soon after
    // it for one of its own, and nothing is left under the bare name for another file to inherit.
    expect(await historyFolders()).toEqual([P.displayName(versionsFolder(doc.file))]);
    expect(await labels(doc.file)).toEqual(['Q1 final']);
  } finally { doc.destroy(); }
});

it('keeps to the name when the drive gave the file no id', async () => {
  const bytes = await bytesOf('budget');
  mock.fs.set(BUDGET, { blob: bytes, size: bytes.size, modified: 1 });
  const doc = new Doc({ name: 'Budget', path: BUDGET }); // no id: the look-up failed at open
  try {
    expect(doc.uid).toBeNull();
    await doc.saveVersion('By hand');
    expect(await historyFolders()).toEqual(['Budget']);
    expect(await labels(doc.file)).toEqual(['By hand']);
    expect(await labels(BUDGET)).toEqual(['By hand']);
  } finally { doc.destroy(); }
});

it('never writes to the drive while a history is read', async () => {
  const before = await budgetWithHistory();
  await puter.fs.rename(BUDGET, 'Q3.xlsx');
  const doc = await Doc.fromPath('Spreadsheets/Q3.xlsx');
  try {
    const folders = await historyFolders();
    mock.calls.length = 0;
    expect(await labels(doc.file)).toEqual(['', 'Q1 final']);
    expect(await listVersions(doc.file)).toHaveLength(2);
    expect(mock.calls.filter(([what]) => ['write', 'rename', 'delete', 'mkdir'].includes(what))).toEqual([]);
    expect(await historyFolders()).toEqual(folders);
    expect(before.uid).toBe(doc.uid);
  } finally { doc.destroy(); }
});
