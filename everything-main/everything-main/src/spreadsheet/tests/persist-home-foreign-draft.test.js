// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';
import { saveDraft, loadDraft, draftKey, listDrafts, isUnsavedDraftKey } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/modal.js', () => ({ promptDialog: vi.fn(), confirmDialog: vi.fn(async () => true), openModal: vi.fn() }));

beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); vi.useFakeTimers(); document.body.replaceChildren(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

/** A draft of edits to the file at `path`, made for the file with id `fileUid`. */
function draft(path, name, fileUid) {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, `edits to ${name}`);
  expect(saveDraft(draftKey(path, name), wb, name, `rev-${name}`, { fileModified: 1, fileUid })).toBe(true);
}

const file = (path, uid) => ({ path, name: path.split('/').pop(), modified: 1, size: 100, uid });
const names = (view) => [...view.el.querySelectorAll('.home-drafts .recent-name')].map((n) => n.textContent).sort();

// The draft of a file deleted elsewhere was listed as that file's lost edits, opening through the old
// address, though another file had been saved there since: selecting it opened that other file.
it('lists a deleted file\'s draft as an unsaved spreadsheet of its own once another file has its address, recovering it as such', async () => {
  draft('Spreadsheets/Budget.xlsx', 'Budget', 'uid-old-budget'); // a new Budget.xlsx is in the folder now
  draft('/nj/Desktop/Report.xlsx', 'Report', 'uid-old-report'); // deleted outside the folder, and another file saved at its address
  draft('Spreadsheets/Gone.xlsx', 'Gone', 'uid-gone'); // deleted, its address free: still the lost file's edits
  vi.spyOn(P, 'listFiles').mockResolvedValue([file('Spreadsheets/Budget.xlsx', 'uid-new-budget')]);
  vi.spyOn(P, 'statByUid').mockResolvedValue(null);
  vi.spyOn(P, 'statFile').mockImplementation(async (path) => (path === '/nj/Desktop/Report.xlsx' ? file(path, 'uid-new-report') : null));
  const openPath = vi.fn();
  const recoverDraft = vi.fn();
  const view = homeView({ openPath, recoverDraft });
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(10);
  expect(names(view)).toEqual(['Budget', 'Gone', 'Report']);
  expect(listDrafts().map((d) => [d.name, d.path]).sort()).toEqual([['Budget', null], ['Gone', 'Spreadsheets/Gone.xlsx'], ['Report', null]]);
  expect(loadDraft(draftKey('Spreadsheets/Budget.xlsx'))).toBeNull();
  const chips = [...view.el.querySelectorAll('.home-drafts .recent-open')];
  chips.find((b) => b.textContent.includes('Budget')).click();
  expect(openPath).not.toHaveBeenCalled();
  expect(recoverDraft).toHaveBeenCalledOnce();
  expect(isUnsavedDraftKey(recoverDraft.mock.calls[0][0])).toBe(true);
  expect(chips.find((b) => b.textContent.includes('Budget')).title).toBeFalsy();
  chips.find((b) => b.textContent.includes('Gone')).click();
  expect(openPath).toHaveBeenCalledWith('Spreadsheets/Gone.xlsx');
  view.destroy();
});
