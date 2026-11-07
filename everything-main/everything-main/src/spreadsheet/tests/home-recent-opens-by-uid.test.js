// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';

const recent = vi.hoisted(() => ({ list: [] }));
vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({
  recentFiles: () => recent.list,
  // The drive reports the file under its new name once asked.
  refreshRecent: async () => { recent.list = [{ path: '/nj/Documents/Q3 final.xlsx', name: 'Q3 final.xlsx', uid: 'u1', at: 1 }]; return recent.list; },
  forgetRecent() {},
}));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  recent.list = [
    { path: '/nj/Desktop/Q3.xlsx', name: 'Q3.xlsx', uid: 'u1', at: 1 },
    { path: '/nj/Desktop/old.xlsx', name: 'old.xlsx', at: 1 }, // kept before ids were
  ];
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

it('lists a file opened elsewhere under its new name, and opens a remembered file by its id', async () => {
  vi.spyOn(P, 'listFiles').mockResolvedValue([]);
  vi.spyOn(P, 'listSharedWithMe').mockResolvedValue([]);
  const openPath = vi.fn();
  const openFile = vi.fn();
  const view = homeView({ openPath, openFile, newDoc() {}, sampleDoc() {}, templateDoc() {}, importFile() {} });
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  const names = [...view.el.querySelectorAll('.recent-name')].map((n) => n.textContent);
  expect(names).toEqual(['Q3 final']);
  view.el.querySelector('.recent-open').click();
  expect(openFile).toHaveBeenCalledWith('u1');
  expect(openPath).not.toHaveBeenCalled();
  view.destroy();
});
