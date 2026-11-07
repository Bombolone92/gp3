// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';
import { closeMenu } from '../src/ui/menu.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => { vi.useFakeTimers(); document.body.replaceChildren(); });
afterEach(() => { closeMenu(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('file links on the home screen', () => {
  it('leave a modifier click to the browser so the file can open in a new tab', async () => {
    vi.spyOn(P, 'listFiles').mockResolvedValue([{ path: 'Spreadsheets/Budget.xlsx', name: 'Budget.xlsx', modified: Date.now(), size: 1000 }]);
    const openPath = vi.fn();
    const view = homeView({ openPath });
    document.body.append(view.el);
    await vi.advanceTimersByTimeAsync(0);
    const link = view.el.querySelector('a.file-main');
    expect(link.getAttribute('href')).toBe('#/edit/Spreadsheets%2FBudget.xlsx');
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) {
      const e = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
      link.dispatchEvent(e);
      expect(e.defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    expect(openPath).not.toHaveBeenCalled();
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(openPath).toHaveBeenCalledWith('Spreadsheets/Budget.xlsx');
    view.destroy?.();
  });
});
