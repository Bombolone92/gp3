// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import { closeMenu } from '../src/ui/menu.js';
import { Doc } from '../src/lib/doc.js';
import { saveDraft, loadDraft, draftKey } from '../src/lib/drafts.js';
import { accountStorageKey } from '../src/lib/account-storage.js';
import { listVersions, saveVersion } from '../src/lib/versions.js';
import * as P from '../src/lib/puter.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

const recent = vi.hoisted(() => ({ forgetRecent: vi.fn() }));
vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent: recent.forgetRecent, rememberRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/modal.js', () => ({ promptDialog: vi.fn(async () => 'Plan'), confirmDialog: vi.fn(async () => true), openModal: vi.fn() }));

// jsdom's Blob has no arrayBuffer(); reading a file back needs one.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(this); });
  };
}

let mock;
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); recent.forgetRecent.mockClear(); document.body.replaceChildren(); });
afterEach(() => { closeMenu(); vi.restoreAllMocks(); document.body.replaceChildren(); delete globalThis.puter; });

const settle = async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const consentKey = (path) => `${accountStorageKey('spreadsheet:external')}${path}`;
const text = (draft) => draft?.workbook.sheets[0].cells['0,0'].v;

async function fileInFolder(name) {
  const bytes = await Doc.blank().toXlsxBlob();
  mock.fs.set(`Spreadsheets/${name}`, { blob: bytes, size: bytes.size, modified: 1 });
}

/** Open the home screen and pick `action` from the first file's menu. */
async function act(action) {
  const view = homeView({});
  document.body.append(view.el);
  await settle(4);
  view.el.querySelector('.file-menu-btn').click();
  [...document.querySelectorAll('.menu-item')].find((node) => node.querySelector('.menu-label')?.textContent === action).click();
  await settle(8);
  return view;
}

// Renaming from the list moved the file and its history but not what this browser kept for it:
// an offline draft was stranded under the old name, the recent list kept an address that opens
// nothing, and a file whose outside content was blocked came back under its new name with no
// decision at all.
it('carries the draft and the outside-content decision when a file is renamed from the list, and forgets the old address', async () => {
  await fileInFolder('Budget.xlsx');
  const offline = new Workbook();
  offline.setInput(offline.activeSheetId, 0, 0, 'offline edits');
  expect(saveDraft(draftKey('Spreadsheets/Budget.xlsx'), offline, 'Budget', 'rev-1')).toBe(true);
  const blocked = await Doc.fromPath('Spreadsheets/Budget.xlsx');
  blocked.distrustExternal();
  blocked.destroy();
  expect(localStorage.getItem(consentKey('Spreadsheets/Budget.xlsx'))).toMatch(/^0:/); // blocked, and the record names the file

  const view = await act('Rename…');
  expect(mock.fs.has('Spreadsheets/Plan.xlsx')).toBe(true);
  expect(mock.fs.has('Spreadsheets/Budget.xlsx')).toBe(false);
  expect(loadDraft(draftKey('Spreadsheets/Budget.xlsx'))).toBeNull();
  expect(text(loadDraft(draftKey('Spreadsheets/Plan.xlsx')))).toBe('offline edits');
  expect(localStorage.getItem(consentKey('Spreadsheets/Budget.xlsx'))).toBeNull();
  expect(localStorage.getItem(consentKey('Spreadsheets/Plan.xlsx'))).toMatch(/^0:/);
  expect(recent.forgetRecent).toHaveBeenCalledWith('Spreadsheets/Budget.xlsx');
  // The browser's own record answers even when the account's store cannot be reached.
  puter.kv.get = async () => { throw new Error('Network request failed'); };
  const reopened = await Doc.fromPath('Spreadsheets/Plan.xlsx');
  expect(reopened.wb.externalAllowed).toBe(false);
  expect(text(reopened.recoverable)).toBe('offline edits');
  reopened.destroy();
  view.destroy();
});

it('gives a copy made from the list the original\'s outside-content decision', async () => {
  await fileInFolder('Budget.xlsx');
  const blocked = await Doc.fromPath('Spreadsheets/Budget.xlsx');
  blocked.distrustExternal();
  blocked.destroy();

  const view = await act('Duplicate');
  expect(mock.fs.has('Spreadsheets/Budget copy.xlsx')).toBe(true);
  expect((await Doc.fromPath('Spreadsheets/Budget copy.xlsx')).wb.externalAllowed).toBe(false);
  // Another device sees the same for the copy.
  localStorage.clear();
  expect((await Doc.fromPath('Spreadsheets/Budget copy.xlsx')).wb.externalAllowed).toBe(false);
  view.destroy();
});

// Histories are kept by name, so a file deleted outside the app left one behind that a copy made
// here took for its own: a stranger's snapshots were listed under the copy and restorable into it.
it('sets a gone file\'s history aside when a copy takes its name', async () => {
  await fileInFolder('Budget.xlsx');
  const dead = new Workbook();
  dead.setInput(dead.activeSheetId, 0, 0, 'the dead file');
  await saveVersion('Spreadsheets/Budget copy.xlsx', await new Doc({ wb: dead }).toXlsxBlob(), 'Q1 final');

  const view = await act('Duplicate');
  expect(mock.fs.has('Spreadsheets/Budget copy.xlsx')).toBe(true);
  expect(await listVersions('Spreadsheets/Budget copy.xlsx')).toEqual([]);
  // The dead file's snapshots are kept, under a name no file's history is read from.
  const aside = (await P.listDir(`${P.FOLDER}/.versions`)).filter((it) => it.is_dir && /\(orphaned /.test(it.name));
  expect(aside.map((it) => it.name)).toEqual([expect.stringMatching(/^Budget copy \(orphaned /)]);
  view.destroy();
});

// The history is kept under the file's id, so the list must name the file, not its address alone,
// or a rename from the list would leave the history behind and a delete would leave it on the drive.
it('carries the history when a file is renamed from the list, and removes it when the file is deleted', async () => {
  await fileInFolder('Budget.xlsx');
  const doc = await Doc.fromPath('Spreadsheets/Budget.xlsx');
  await doc.saveVersion('Q1 final');
  doc.destroy();

  let view = await act('Rename…');
  const renamed = await Doc.fromPath('Spreadsheets/Plan.xlsx');
  expect((await listVersions(renamed.file)).map((v) => v.label)).toEqual(['Q1 final']);
  renamed.destroy();
  view.destroy();

  view = await act('Delete…');
  expect(await P.listDir(`${P.FOLDER}/.versions`)).toEqual([]);
  view.destroy();
});

it('forgets the decision of a file deleted from the list', async () => {
  await fileInFolder('Budget.xlsx');
  const blocked = await Doc.fromPath('Spreadsheets/Budget.xlsx');
  blocked.distrustExternal();
  blocked.destroy();
  const view = await act('Delete…');
  expect(mock.fs.has('Spreadsheets/Budget.xlsx')).toBe(false);
  expect(localStorage.getItem(consentKey('Spreadsheets/Budget.xlsx'))).toBeNull();
  expect([...mock.kv.keys()].filter((k) => k.startsWith('spreadsheet:external:'))).toEqual([]);
  view.destroy();
});
