// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';
import { saveDraft, loadDraft, draftKey } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/modal.js', () => ({ promptDialog: vi.fn(), confirmDialog: vi.fn(async () => true), openModal: vi.fn() }));

beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); vi.useFakeTimers(); document.body.replaceChildren(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

/** A draft of edits to the file at `path` (or, without a path, to a spreadsheet that has no file yet). */
function draft(path, name, fileUid = undefined) {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, `edits to ${name}`);
  expect(saveDraft(draftKey(path, name), wb, name, `rev-${name}`, path ? { fileModified: 1, fileUid } : {})).toBe(true);
}

const file = (path, uid) => ({ path, name: path.split('/').pop(), modified: 1, size: 100, uid });
const names = (view) => [...view.el.querySelectorAll('.home-drafts .recent-name')].map((n) => n.textContent);

// A draft of a file deleted elsewhere was listed nowhere: the home screen showed only drafts of
// spreadsheets without a file, so only a stale link to the old address could still reach the edits,
// and the draft otherwise sat in local storage for good.
it('lists the drafts of files that no longer exist under unsaved spreadsheets, opening them by their old address', async () => {
  draft('Spreadsheets/Gone.xlsx', 'Gone', 'uid-gone');
  draft('/nj/Desktop/Elsewhere.xlsx', 'Elsewhere', 'uid-elsewhere'); // deleted too, from outside the folder
  draft('Spreadsheets/Legacy.xlsx', 'Legacy'); // from before file ids were kept: its address decides
  draft('Spreadsheets/Renamed.xlsx', 'Renamed', 'uid-renamed'); // the file lives on under another name: its draft is offered when that is opened
  draft('Spreadsheets/Kept.xlsx', 'Kept', 'uid-kept');
  draft(null, 'Never saved');
  vi.spyOn(P, 'listFiles').mockResolvedValue([file('Spreadsheets/Kept.xlsx', 'uid-kept'), file('Spreadsheets/Q3.xlsx', 'uid-renamed')]);
  vi.spyOn(P, 'statByUid').mockImplementation(async (uid) => (uid === 'uid-renamed' ? file('Spreadsheets/Q3.xlsx', uid) : null));
  vi.spyOn(P, 'statFile').mockResolvedValue(null);
  const openPath = vi.fn();
  const recoverDraft = vi.fn();
  const view = homeView({ openPath, recoverDraft });
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(10);
  const drafts = view.el.querySelector('.home-drafts');
  expect(drafts.hidden).toBe(false);
  expect(names(view)).toEqual(expect.arrayContaining(['Never saved', 'Gone', 'Elsewhere', 'Legacy']));
  expect(names(view)).toHaveLength(4);
  // Only files not in the list are asked after, and a file in the list is not.
  expect(P.statByUid).not.toHaveBeenCalledWith('uid-kept');
  expect(P.statFile).toHaveBeenCalledWith('Spreadsheets/Legacy.xlsx');
  // A lost file's draft opens through its old address, where the edits become a new spreadsheet.
  [...drafts.querySelectorAll('.recent-open')].find((b) => b.textContent.includes('Gone')).click();
  expect(openPath).toHaveBeenCalledWith('Spreadsheets/Gone.xlsx');
  [...drafts.querySelectorAll('.recent-open')].find((b) => b.textContent.includes('Never saved')).click();
  expect(recoverDraft).toHaveBeenCalledWith(draftKey(null, 'Never saved'));
  // Discarding removes it, as for any unsaved spreadsheet.
  [...drafts.querySelectorAll('.recent-forget')].find((b) => b.getAttribute('aria-label') === 'Discard Gone').click();
  await vi.advanceTimersByTimeAsync(10);
  expect(loadDraft(draftKey('Spreadsheets/Gone.xlsx'))).toBeNull();
  expect(names(view)).not.toContain('Gone');
  view.destroy();
});

it('does not take a file for lost when the drive could not be asked, or the list could not be loaded', async () => {
  draft('Spreadsheets/Gone.xlsx', 'Gone', 'uid-gone');
  vi.spyOn(P, 'listFiles').mockResolvedValue([]);
  vi.spyOn(P, 'statByUid').mockRejectedValue(new Error('network down'));
  const view = homeView({});
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(10);
  expect(view.el.querySelector('.home-drafts').hidden).toBe(true);
  view.destroy();
  document.body.replaceChildren();
  P.listFiles.mockRejectedValue(new Error('network down'));
  P.statByUid.mockResolvedValue(null);
  const offline = homeView({});
  document.body.append(offline.el);
  await vi.advanceTimersByTimeAsync(10);
  expect(offline.el.querySelector('.home-drafts').hidden).toBe(true);
  expect(P.statByUid).toHaveBeenCalledTimes(1);
  offline.destroy();
});
