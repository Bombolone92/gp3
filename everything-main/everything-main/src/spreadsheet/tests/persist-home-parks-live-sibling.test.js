// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';
import { saveDraft, loadDraft, draftKey, liveDraftKey, listDrafts } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/modal.js', () => ({ promptDialog: vi.fn(), confirmDialog: vi.fn(async () => true), openModal: vi.fn() }));

beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); vi.useFakeTimers(); document.body.replaceChildren(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

/** A draft under `key` of edits made for the file with id `fileUid`. */
function draft(key, value, fileUid) {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, value);
  expect(saveDraft(key, wb, 'Budget', `rev-${value}`, { fileModified: 1, fileUid })).toBe(true);
}
const text = (d) => d?.workbook.sheets[0].cells['0,0']?.v;
const file = (path, uid) => ({ path, name: path.split('/').pop(), modified: 1, size: 100, uid });

// When a deleted file's draft was kept as an unsaved spreadsheet because another file had taken its
// address, the edits made beside it while it awaited a decision stayed under that address, where nothing
// listed them and the file now there would have been offered them as its own.
it('keeps the edits made beside a deleted file\'s draft as an unsaved spreadsheet too, when another file has its address', async () => {
  const key = draftKey('Spreadsheets/Budget.xlsx');
  draft(key, 'recovered edits', 'uid-old-budget');
  draft(liveDraftKey(key), 'meanwhile', 'uid-old-budget');
  vi.spyOn(P, 'listFiles').mockResolvedValue([file('Spreadsheets/Budget.xlsx', 'uid-new-budget')]);
  vi.spyOn(P, 'statByUid').mockResolvedValue(null);
  vi.spyOn(P, 'statFile').mockResolvedValue(null);
  const view = homeView({ openPath: vi.fn(), recoverDraft: vi.fn() });
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(10);
  expect(loadDraft(key)).toBeNull();
  expect(loadDraft(liveDraftKey(key))).toBeNull();
  expect(listDrafts().map((d) => [d.name, d.path, text(loadDraft(d.key))]).sort((a, b) => a[2].localeCompare(b[2]))).toEqual([['Budget', null, 'meanwhile'], ['Budget', null, 'recovered edits']]);
  expect([...view.el.querySelectorAll('.home-drafts .recent-name')].map((n) => n.textContent)).toEqual(['Budget', 'Budget']);
  view.destroy();
});

it('parks both when the other file at the address is only found by asking the drive', async () => {
  const key = draftKey('/nj/Desktop/Report.xlsx');
  draft(key, 'recovered edits', 'uid-old-report');
  draft(liveDraftKey(key), 'meanwhile', 'uid-old-report');
  vi.spyOn(P, 'listFiles').mockResolvedValue([]);
  vi.spyOn(P, 'statByUid').mockResolvedValue(null);
  vi.spyOn(P, 'statFile').mockImplementation(async (path) => (path === '/nj/Desktop/Report.xlsx' ? file(path, 'uid-new-report') : null));
  const view = homeView({ openPath: vi.fn(), recoverDraft: vi.fn() });
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(10);
  expect(loadDraft(key)).toBeNull();
  expect(loadDraft(liveDraftKey(key))).toBeNull();
  expect(listDrafts().map((d) => [d.path, text(loadDraft(d.key))]).sort((a, b) => a[1].localeCompare(b[1]))).toEqual([[null, 'meanwhile'], [null, 'recovered edits']]);
  view.destroy();
});
