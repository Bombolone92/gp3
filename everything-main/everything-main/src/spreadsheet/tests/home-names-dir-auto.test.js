// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [{ path: 'Desktop/דוח 3.xlsx', name: 'דוח 3.xlsx', at: 1 }], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => { vi.useFakeTimers(); document.body.replaceChildren(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

// A file named in Hebrew or Arabic was laid out left to right in the home list and the recents strip,
// its number at the wrong end; the names follow their own direction now, as the cells do.
it('lays the file names and the recent names out in their own direction', async () => {
  vi.spyOn(P, 'listFiles').mockResolvedValue([{ path: 'Spreadsheets/תקציב 2026.xlsx', name: 'תקציב 2026.xlsx', size: 10, modified: 1 }]);
  const view = homeView({ openPath() {}, newDoc() {}, sampleDoc() {}, templateDoc() {}, importFile() {} });
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  const fileName = view.el.querySelector('.file-name');
  expect(fileName.textContent).toBe('תקציב 2026');
  expect(fileName.getAttribute('dir')).toBe('auto');
  const recentName = view.el.querySelector('.recent-name');
  expect(recentName.textContent).toBe('דוח 3');
  expect(recentName.getAttribute('dir')).toBe('auto');
  view.destroy();
});
