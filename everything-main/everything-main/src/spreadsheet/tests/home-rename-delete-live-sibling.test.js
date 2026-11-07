// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';
import { closeMenu } from '../src/ui/menu.js';
import { saveDraft, loadDraft, draftKey, liveDraftKey } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {}, rememberRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/modal.js', () => ({ promptDialog: vi.fn(async () => 'Plan'), confirmDialog: vi.fn(async () => true), openModal: vi.fn() }));

beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); vi.useFakeTimers(); document.body.replaceChildren(); });
afterEach(() => { closeMenu(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

const PATH = 'Spreadsheets/Budget.xlsx';
const text = (draft) => draft?.workbook.sheets[0].cells['0,0']?.v;

/** A draft of edits to Budget.xlsx that awaited a decision, with the edits made meanwhile kept beside it. */
function draftWithSibling() {
  const old = new Workbook();
  old.setInput(old.activeSheetId, 0, 0, 'recovered edits');
  expect(saveDraft(draftKey(PATH), old, 'Budget', 'rev-old', { fileModified: 1 })).toBe(true);
  const live = new Workbook();
  live.setInput(live.activeSheetId, 0, 0, 'meanwhile');
  expect(saveDraft(liveDraftKey(draftKey(PATH)), live, 'Budget', 'rev-live', { fileModified: 1 })).toBe(true);
}

/** Open the home screen and pick `action` from the file's menu. */
async function act(action) {
  vi.spyOn(P, 'listFiles').mockResolvedValue([{ path: PATH, name: 'Budget.xlsx', modified: Date.now(), size: 1000, uid: 'uid-budget' }]);
  const view = homeView({});
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(10);
  view.el.querySelector('.file-menu-btn').click();
  [...document.querySelectorAll('.menu .menu-item')].find((node) => node.querySelector('.menu-label')?.textContent === action).click();
  await vi.advanceTimersByTimeAsync(10);
  return view;
}

// Edits made while a draft of the file awaited a decision are kept beside it; a rename or a deletion
// from the list carried or cleared the draft alone, stranding those edits under the old address.
it('carries the edits kept beside a draft along when the file is renamed from the list', async () => {
  draftWithSibling();
  vi.spyOn(P, 'renameFile').mockResolvedValue({ path: 'Spreadsheets/Plan.xlsx', name: 'Plan.xlsx' });
  const view = await act('Rename…');
  expect(P.renameFile).toHaveBeenCalledWith(PATH, 'Plan.xlsx');
  expect(loadDraft(draftKey(PATH))).toBeNull();
  expect(loadDraft(liveDraftKey(draftKey(PATH)))).toBeNull();
  expect(text(loadDraft(draftKey('Spreadsheets/Plan.xlsx')))).toBe('recovered edits');
  expect(text(loadDraft(liveDraftKey(draftKey('Spreadsheets/Plan.xlsx'))))).toBe('meanwhile');
  view.destroy();
});

it('clears the edits kept beside a draft along with it when the file is deleted from the list', async () => {
  draftWithSibling();
  vi.spyOn(P, 'deleteFile').mockResolvedValue(undefined);
  const view = await act('Delete…');
  expect(P.deleteFile).toHaveBeenCalledWith(PATH);
  expect(loadDraft(draftKey(PATH))).toBeNull();
  expect(loadDraft(liveDraftKey(draftKey(PATH)))).toBeNull();
  view.destroy();
});
