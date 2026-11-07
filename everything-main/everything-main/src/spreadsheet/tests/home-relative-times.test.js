// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import { relativeTime } from '../src/ui/dom.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

// The home list wrote its relative times once, so "Just now" stayed for the whole session, and rounded them
// up (89 minutes read "2 hours ago", 23.6 hours "1 day ago"); its search read the file names with their
// extension, so "x" or "xls" matched every file.
beforeEach(() => { vi.useFakeTimers(); document.body.replaceChildren(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

const open = () => {
  const view = homeView({ openPath() {}, newDoc() {}, sampleDoc() {}, templateDoc() {}, importFile() {} });
  document.body.append(view.el);
  return view;
};

describe('relativeTime', () => {
  it('names the whole units gone by, never rounding up', () => {
    const now = Date.now();
    expect(relativeTime(now - 30000)).toBe('Just now');
    expect(relativeTime(now - 60000)).toBe('1 min ago');
    expect(relativeTime(now - 59.6 * 60000)).toBe('59 min ago');
    expect(relativeTime(now - 89.5 * 60000)).toBe('1 hour ago');
    expect(relativeTime(now - 23.6 * 3600000)).toBe('23 hours ago');
    expect(relativeTime(now - 6.9 * 86400000)).toBe('6 days ago');
  });
});

describe('the home list', () => {
  it('keeps the modified times current while it is on screen, leaving the rows themselves in place', async () => {
    vi.spyOn(P, 'listFiles').mockResolvedValue([{ path: 'Spreadsheets/Budget.xlsx', name: 'Budget.xlsx', size: 2048, modified: Date.now() - 30000 }]);
    const view = open();
    await vi.advanceTimersByTimeAsync(0);
    const row = view.el.querySelector('.file-row');
    const meta = row.querySelector('.file-meta');
    expect(meta.textContent).toBe('Just now · 2.0 KB');
    await vi.advanceTimersByTimeAsync(60000);
    expect(meta.textContent).toBe('1 min ago · 2.0 KB');
    expect(view.el.querySelector('.file-row')).toBe(row);
    await vi.advanceTimersByTimeAsync(59 * 60000);
    expect(meta.textContent).toBe('1 hour ago · 2.0 KB');
    // Leaving the screen stops the clock.
    view.destroy();
    await vi.advanceTimersByTimeAsync(2 * 3600000);
    expect(meta.textContent).toBe('1 hour ago · 2.0 KB');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('searches the names without their extensions', async () => {
    vi.spyOn(P, 'listFiles').mockResolvedValue([
      { path: 'Spreadsheets/Budget.xlsx', name: 'Budget.xlsx', size: 1, modified: 2 },
      { path: 'Spreadsheets/Expenses.csv', name: 'Expenses.csv', size: 1, modified: 1 },
    ]);
    const view = open();
    await vi.advanceTimersByTimeAsync(0);
    const search = view.el.querySelector('.home-search');
    const names = () => [...view.el.querySelectorAll('.file-name')].map((n) => n.textContent);
    const type = (text) => { search.value = text; search.dispatchEvent(new Event('input')); };
    expect(names()).toEqual(['Budget', 'Expenses']);
    type('xls');
    expect(names()).toEqual([]);
    expect(view.el.querySelector('.empty h3').textContent).toBe('No matches');
    type('csv');
    expect(names()).toEqual([]);
    type('BUD');
    expect(names()).toEqual(['Budget']);
    type('');
    expect(names()).toEqual(['Budget', 'Expenses']);
    view.destroy();
  });
});
