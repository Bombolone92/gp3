// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';
import { closeMenu } from '../src/ui/menu.js';
import { saveDraft, loadDraft, draftKey } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/modal.js', () => ({ promptDialog: vi.fn(), confirmDialog: vi.fn(async () => true), openModal: vi.fn() }));

beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); vi.useFakeTimers(); document.body.replaceChildren(); });
afterEach(() => { closeMenu(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

// A draft kept for a file lived on after the file was deleted, filling local storage for good.
it('clears the local draft of a file deleted from the list', async () => {
  const path = 'Spreadsheets/Budget.xlsx';
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, 'unsaved');
  expect(saveDraft(draftKey(path), wb, 'Budget', 'rev-1')).toBe(true);
  vi.spyOn(P, 'listFiles').mockResolvedValue([{ path, name: 'Budget.xlsx', modified: Date.now(), size: 1000 }]);
  vi.spyOn(P, 'deleteFile').mockResolvedValue(undefined);
  const view = homeView({});
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  view.el.querySelector('.file-menu-btn').click();
  const del = [...document.querySelectorAll('.menu .menu-item')].find((b) => /delete/i.test(b.textContent));
  expect(del).toBeTruthy();
  del.click();
  await vi.advanceTimersByTimeAsync(10);
  expect(P.deleteFile).toHaveBeenCalledWith(path);
  expect(loadDraft(draftKey(path))).toBeNull();
  view.destroy?.();
});
