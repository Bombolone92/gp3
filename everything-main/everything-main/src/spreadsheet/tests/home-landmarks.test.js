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

describe('the home screen', () => {
  it('has one top-level heading and only files inside its list', async () => {
    let resolve;
    vi.spyOn(P, 'listFiles').mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = homeView({});
    document.body.append(view.el);
    expect(view.el.querySelectorAll('h1')).toHaveLength(1);
    expect(view.el.querySelector('h1').textContent).toBe('Spreadsheet');
    const list = view.el.querySelector('.file-list');
    // Loading skeletons are not list items, so the list role waits for real rows.
    expect(list.querySelector('.skeleton-row')).toBeTruthy();
    expect(list.getAttribute('role')).toBeNull();
    resolve([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(list.querySelector('.empty')).toBeTruthy();
    expect(list.getAttribute('role')).toBeNull();
    view.destroy?.();
    vi.spyOn(P, 'listFiles').mockResolvedValue([{ path: 'Spreadsheets/Budget.xlsx', name: 'Budget.xlsx', modified: Date.now(), size: 1000 }]);
    const filled = homeView({});
    document.body.append(filled.el);
    await vi.advanceTimersByTimeAsync(0);
    const rows = filled.el.querySelector('.file-list');
    expect(rows.getAttribute('role')).toBe('list');
    expect(rows.querySelectorAll('[role="listitem"]')).toHaveLength(1);
    filled.destroy?.();
  });
});
