import { afterEach, beforeEach, expect, it } from 'vitest';
import * as P from '../src/lib/puter.js';
import { Doc } from '../src/lib/doc.js';
import { draftKey, saveDraft, loadDraft } from '../src/lib/drafts.js';
import { listVersions, versionsFolder } from '../src/lib/versions.js';
import { recentFiles, rememberRecent } from '../src/lib/recent.js';
import { accountStorageKey } from '../src/lib/account-storage.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

const HOME = '/alice/AppData/app-1';

/**
 * The SDK as it really behaves: a relative path is resolved under the app's own
 * data folder, and every result (a listing, a stat, a write) reports the file by
 * its absolute path there.
 */
function installAbsolutePuter() {
  const mock = installMockPuter();
  const fs = puter.fs;
  const abs = (p) => (p.startsWith('/') ? p : `${HOME}/${p}`);
  for (const op of ['mkdir', 'readdir', 'read', 'write', 'stat', 'delete', 'rename']) {
    const original = fs[op].bind(fs);
    fs[op] = (p, ...rest) => original(abs(p), ...rest);
  }
  return { ...mock, abs };
}

let mock;
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installAbsolutePuter(); });
afterEach(() => { delete globalThis.puter; });

const text = (draft) => draft?.workbook.sheets[0].cells['0,0'].v;
const consentKey = (path) => `${accountStorageKey('spreadsheet:external')}${path}`;

// A document saved here kept the relative address it was written under, while the
// list on the home screen (and the picker, and "Open with") named the same file by
// the absolute address the drive reports. Everything keyed by address then missed
// when the file was reopened: its draft, the outside-content decision, its history
// folder, and the recent list all split between the two spellings.
it('keeps a saved document under the address the drive reports, so reopening it from the list finds its records', async () => {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'x');
  expect(await doc.save()).toBe(true);
  expect(doc.path).toBe(`${HOME}/Spreadsheets/Untitled spreadsheet.xlsx`);
  expect(doc.name).toBe('Untitled spreadsheet');
  const [listed] = await P.listFiles();
  expect(listed.path).toBe(doc.path);
  expect(P.inAppFolder(doc.path)).toBe(true);

  // The outside-content decision is kept under the listed address.
  doc.distrustExternal();
  expect((await Doc.fromPath(listed.path)).wb.externalAllowed).toBe(false);

  // The history is one folder, whichever spelling of the address names the file, and a labelled
  // snapshot shows up when the file is opened from the list.
  expect(versionsFolder(doc.path)).toBe(versionsFolder('Spreadsheets/Untitled spreadsheet.xlsx'));
  expect(versionsFolder(doc.file)).toBe(versionsFolder({ path: 'Spreadsheets/Untitled spreadsheet.xlsx', uid: doc.uid }));
  await doc.saveVersion('mark');
  expect((await listVersions({ path: listed.path, uid: listed.uid })).map((v) => v.label)).toContain('mark');

  // A draft of unsaved edits is offered when the file is opened from the list.
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'unsaved');
  expect(doc.writeDraft()).toBe(true);
  doc.destroy();
  const reopened = await Doc.fromPath(listed.path);
  expect(text(reopened.recoverable)).toBe('unsaved');
  reopened.destroy();

  // A file in the app folder is not one "opened elsewhere".
  rememberRecent(listed.path, 'Untitled spreadsheet');
  expect(recentFiles()).toEqual([]);
});

it('adopts the reported address when a file is opened by its relative one, and carries the records kept under it', async () => {
  const bytes = await Doc.blank().toXlsxBlob();
  await puter.fs.write('Spreadsheets/Budget.xlsx', bytes);
  mock.fs.get(`${HOME}/Spreadsheets/Budget.xlsx`).modified = 1;
  // Records made before the fix lived under the relative spelling.
  const precious = new Workbook();
  precious.setInput(precious.activeSheetId, 0, 0, 'never saved');
  expect(saveDraft(draftKey('Spreadsheets/Budget.xlsx'), precious, 'Budget', 'rev-1')).toBe(true);
  localStorage.setItem(consentKey('Spreadsheets/Budget.xlsx'), '0');

  const doc = await Doc.fromPath('Spreadsheets/Budget.xlsx');
  expect(doc.path).toBe(`${HOME}/Spreadsheets/Budget.xlsx`);
  expect(doc.name).toBe('Budget');
  expect(doc.wb.externalAllowed).toBe(false);
  expect(text(doc.recoverable)).toBe('never saved');
  expect(loadDraft(draftKey('Spreadsheets/Budget.xlsx'))).toBeNull();
  expect(text(loadDraft(draftKey(doc.path)))).toBe('never saved');
  expect(localStorage.getItem(consentKey('Spreadsheets/Budget.xlsx'))).toBeNull();
  expect(localStorage.getItem(consentKey(doc.path))).toBe('0');
  doc.destroy();
});

it('renames and saves a copy of a document under its reported address', async () => {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'x');
  await doc.save();
  expect(await doc.rename('Plan')).toBeNull();
  expect(doc.path).toBe(`${HOME}/Spreadsheets/Plan.xlsx`);
  expect((await P.listFiles()).map((f) => f.path)).toEqual([doc.path]);
  expect(await doc.saveAs('Plan copy')).toBeNull();
  expect(doc.path).toBe(`${HOME}/Spreadsheets/Plan copy.xlsx`);
  expect((await P.listFiles()).map((f) => f.path).sort()).toEqual([`${HOME}/Spreadsheets/Plan copy.xlsx`, `${HOME}/Spreadsheets/Plan.xlsx`]);
  doc.destroy();
});

it('tells the two spellings of one file apart from a file elsewhere', async () => {
  await puter.fs.write('Spreadsheets/A.xlsx', new Blob(['a']));
  await P.listFiles(); // the app folder's absolute spelling is learned from the listing
  expect(P.samePath('Spreadsheets/A.xlsx', `${HOME}/Spreadsheets/A.xlsx`)).toBe(true);
  expect(P.samePath(`${HOME}/Spreadsheets/A.xlsx`, `${HOME}/Spreadsheets/A.xlsx`)).toBe(true);
  expect(P.samePath('Spreadsheets/A.xlsx', '/alice/Desktop/Spreadsheets/A.xlsx')).toBe(false);
  expect(P.samePath('Spreadsheets/A.xlsx', 'Spreadsheets/B.xlsx')).toBe(false);
  expect(P.samePath(null, 'Spreadsheets/A.xlsx')).toBe(false);
  expect(P.inAppFolder(`${HOME}/Spreadsheets/sub/A.xlsx`)).toBe(false);
  expect(P.inAppFolder('/alice/Desktop/Spreadsheets/A.xlsx')).toBe(false);
  expect(P.inAppFolder('Spreadsheets/A.xlsx')).toBe(true);
});
