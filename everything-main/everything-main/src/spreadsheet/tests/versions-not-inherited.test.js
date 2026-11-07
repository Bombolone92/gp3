import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import * as P from '../src/lib/puter.js';
import { listVersions, saveVersion, readVersion, moveVersions, versionsFolder } from '../src/lib/versions.js';
import { workbookFromFile } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const BUDGET = 'Spreadsheets/Budget.xlsx';
const cellA1 = (wb) => wb.getValue(wb.activeSheetId, 0, 0);
async function bytesOf(value) {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, value);
  return new Doc({ wb }).toXlsxBlob();
}
const labels = async (path) => (await listVersions(path)).map((v) => v.label).sort();
const snapshotText = async (v) => cellA1(await workbookFromFile(await readVersion(v.path), 'v.xlsx'));
/** The histories put aside under .versions, by name. */
const orphaned = async () => (await P.listDir(`${P.FOLDER}/.versions`)).filter((it) => it.is_dir && /\(orphaned /.test(it.name)).map((it) => it.name);

/**
 * Budget.xlsx was here once, its history kept under its name as every history was before file ids
 * were used, and was deleted outside the app, which leaves that history behind under the name.
 */
async function deletedBudgetWithHistory() {
  await saveVersion(BUDGET, await bytesOf('the dead file'), '');
  await saveVersion(BUDGET, await bytesOf('the dead file'), 'Q1 final');
  expect(await labels(BUDGET)).toEqual(['', 'Q1 final']);
  expect(mock.fs.has(BUDGET)).toBe(false); // the desktop deleted the file alone
  await vi.advanceTimersByTimeAsync(2000);
}

// Histories are kept by file name, so a file deleted outside the app left one that the next file of that
// name inherited: a rename onto the name refused to move the file's own history (stranding it), listed the
// dead file's snapshots as this file's, and Restore put the dead file's content into the document.
it('sets a deleted file\'s history aside when another file is renamed onto its name, and moves that file\'s own history there', async () => {
  await deletedBudgetWithHistory();
  const plan = new Doc({ wb: new Workbook() });
  plan.wb.setInput(plan.wb.activeSheetId, 0, 0, 'plan');
  await plan.rename('Plan');
  expect(await plan.save()).toBe(true);
  await plan._versioning;
  await plan.saveVersion('Plan milestone');
  try {
    expect(await plan.rename('Budget')).toBeNull();
    expect(plan.path).toBe(BUDGET);
    expect(await labels(plan.file)).toEqual(['', 'Plan milestone']);
    expect(await labels('Spreadsheets/Plan.xlsx')).toEqual([]);
    for (const v of await listVersions(plan.file)) expect(await snapshotText(v)).toBe('plan');
    // The dead file's snapshots are still on the drive, under a name no file's history is read from.
    const aside = await orphaned();
    expect(aside).toHaveLength(1);
    expect(aside[0]).toMatch(/^Budget \(orphaned /);
    expect((await P.listDir(`${P.FOLDER}/.versions/${aside[0]}`)).map((it) => it.name).some((n) => n.endsWith(' Q1 final.xlsx'))).toBe(true);
  } finally { plan.destroy(); }
});

it('starts a new spreadsheet saved under a deleted file\'s name with a history of its own, and takes its first snapshot', async () => {
  await deletedBudgetWithHistory();
  const fresh = new Doc({ wb: new Workbook() });
  fresh.wb.setInput(fresh.wb.activeSheetId, 0, 0, 'new budget');
  await fresh.rename('Budget');
  try {
    expect(await fresh.save()).toBe(true);
    expect(fresh.path).toBe(BUDGET);
    await fresh._versioning;
    const versions = await listVersions(fresh.file);
    expect(versions.map((v) => v.label)).toEqual(['']);
    expect(await snapshotText(versions[0])).toBe('new budget');
    expect(await orphaned()).toHaveLength(1);
  } finally { fresh.destroy(); }
});

it('does the same for a copy saved under a deleted file\'s name', async () => {
  await deletedBudgetWithHistory();
  const other = new Doc({ wb: new Workbook() });
  other.wb.setInput(other.wb.activeSheetId, 0, 0, 'copy');
  await other.rename('Other');
  expect(await other.save()).toBe(true);
  try {
    expect(await other.saveAs('Budget')).toBeNull();
    expect(other.path).toBe(BUDGET);
    expect(await listVersions(other.file)).toEqual([]);
    expect(await orphaned()).toHaveLength(1);
  } finally { other.destroy(); }
});

it('puts an occupied destination aside when snapshots move, rather than refusing, and leaves a free one be', async () => {
  await saveVersion('Spreadsheets/A.xlsx', await bytesOf('a'), 'a');
  await saveVersion('Spreadsheets/B.xlsx', await bytesOf('b'), 'b');
  expect(await moveVersions('Spreadsheets/A.xlsx', 'Spreadsheets/B.xlsx')).toBe(true);
  expect(await labels('Spreadsheets/B.xlsx')).toEqual(['a']);
  expect(await labels('Spreadsheets/A.xlsx')).toEqual([]);
  expect(await orphaned()).toEqual([expect.stringMatching(/^B \(orphaned /)]);
  expect(await P.fileExists(versionsFolder('Spreadsheets/A.xlsx'))).toBe(false);
  // Nothing to put aside: a plain move, and a source without a history moves nothing.
  expect(await moveVersions('Spreadsheets/B.xlsx', 'Spreadsheets/C.xlsx')).toBe(true);
  expect(await moveVersions('Spreadsheets/B.xlsx', 'Spreadsheets/D.xlsx')).toBe(false);
  expect(await orphaned()).toHaveLength(1);
});
