// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';
import { confirmDialog } from '../src/ui/modal.js';
import { saveDraft, loadDraft, draftKey, liveDraftKey } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/modal.js', () => ({ promptDialog: vi.fn(), confirmDialog: vi.fn(async () => true), openModal: vi.fn() }));

let view;
beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
  vi.useFakeTimers();
  vi.spyOn(P, 'listFiles').mockResolvedValue([]);
  document.body.replaceChildren();
});
afterEach(() => { view?.destroy?.(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

function unsavedDraft(name) {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, `Work in ${name}`);
  const key = draftKey(null, name);
  expect(saveDraft(key, wb, name, 'rev-1')).toBe(true);
  return key;
}

// The "Unsaved spreadsheets" chips could only be recovered; a draft nobody wanted stayed
// on the home screen (and in local storage) for good.
it('discards an unsaved spreadsheet from the home screen after asking', async () => {
  const keep = unsavedDraft('Keep me');
  const drop = unsavedDraft('Drop me');
  view = homeView({ recoverDraft: vi.fn() });
  document.body.append(view.el);
  const discard = view.el.querySelector('[aria-label="Discard Drop me"]');
  expect(discard).not.toBeNull();
  expect(discard.className).toBe(view.el.querySelector('.recent-forget').className);
  discard.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard "Drop me"?', confirmLabel: 'Discard' }));
  expect(loadDraft(drop)).toBeNull();
  expect(loadDraft(keep)).not.toBeNull();
  expect(view.el.querySelector('[aria-label="Discard Drop me"]')).toBeNull();
  expect(view.el.querySelector('[aria-label="Recover Keep me"]')).not.toBeNull();
});

// Edits made to a file while an earlier draft of it awaited a decision are kept beside that draft, under a
// key the list never shows; discarding the lost file's draft left them in storage for good.
it('discards the edits kept beside a lost file\'s draft along with it', async () => {
  const path = 'Spreadsheets/Gone.xlsx';
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, 'edits to Gone');
  expect(saveDraft(draftKey(path), wb, 'Gone', 'rev-1', { fileModified: 1, fileUid: 'uid-gone' })).toBe(true);
  expect(saveDraft(liveDraftKey(draftKey(path)), wb, 'Gone', 'rev-2', { fileModified: 1, fileUid: 'uid-gone' })).toBe(true);
  vi.spyOn(P, 'statByUid').mockResolvedValue(null);
  view = homeView({ recoverDraft: vi.fn() });
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(10);
  view.el.querySelector('[aria-label="Discard Gone"]').click();
  await vi.advanceTimersByTimeAsync(0);
  expect(loadDraft(draftKey(path))).toBeNull();
  expect(loadDraft(liveDraftKey(draftKey(path)))).toBeNull();
  expect(view.el.querySelector('.home-drafts').hidden).toBe(true);
});

it('keeps the draft when the question is declined', async () => {
  const key = unsavedDraft('Second thoughts');
  confirmDialog.mockResolvedValueOnce(false);
  view = homeView({ recoverDraft: vi.fn() });
  document.body.append(view.el);
  view.el.querySelector('[aria-label="Discard Second thoughts"]').click();
  await vi.advanceTimersByTimeAsync(0);
  expect(loadDraft(key)).not.toBeNull();
  expect(view.el.querySelector('[aria-label="Recover Second thoughts"]')).not.toBeNull();
});
