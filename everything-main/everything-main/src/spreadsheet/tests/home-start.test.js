// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => { vi.useFakeTimers(); document.body.replaceChildren(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

const open = (nav = {}) => {
  vi.spyOn(P, 'listFiles').mockResolvedValue([
    { path: 'Spreadsheets/Budget.xlsx', name: 'Budget.xlsx', size: 2048, modified: Date.now() },
    { path: 'Spreadsheets/Plan.xlsx', name: 'Plan.xlsx', size: 10, modified: Date.now() - 1000 },
  ]);
  const view = homeView({ openPath() {}, newDoc() {}, sampleDoc() {}, templateDoc() {}, importFile() {}, ...nav });
  document.body.append(view.el);
  return view;
};

describe('the ways to start', () => {
  it('starts a blank spreadsheet or a featured template from its tile, each named by its label', async () => {
    const newDoc = vi.fn();
    const templateDoc = vi.fn();
    const view = open({ newDoc, templateDoc });
    await vi.advanceTimersByTimeAsync(0);
    const tiles = [...view.el.querySelectorAll('.start-tile')];
    expect(tiles.map((t) => t.textContent)).toEqual(['Blank spreadsheet', 'Monthly budget', 'Expense tracker', 'Invoice', 'To-do list', expect.stringMatching(/^All templates\d+ more$/)]);
    tiles[0].click();
    expect(newDoc).toHaveBeenCalledOnce();
    tiles[2].click();
    expect(templateDoc).toHaveBeenCalledWith('expenses');
    // The group is named by the section's heading, and that heading's id is this screen's own.
    const group = view.el.querySelector('.start-grid');
    expect(document.getElementById(group.getAttribute('aria-labelledby')).textContent).toBe('Start a new spreadsheet');
    view.destroy();
  });
});

describe('the search field', () => {
  it('takes the keyboard on "/" unless something is being typed, and Escape empties it', async () => {
    const view = open();
    await vi.advanceTimersByTimeAsync(0);
    const search = view.el.querySelector('.home-search');
    const names = () => [...view.el.querySelectorAll('.file-name')].map((n) => n.textContent);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(document.activeElement).toBe(search);
    // Typed into the field, "/" is a character like any other.
    const typed = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    search.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(false);
    search.value = 'bud';
    search.dispatchEvent(new Event('input'));
    expect(names()).toEqual(['Budget']);
    expect(view.el.querySelector('.home-count').textContent).toBe('1 of 2');
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(search.value).toBe('');
    expect(names()).toEqual(['Budget', 'Plan']);
    expect(view.el.querySelector('.home-count').textContent).toBe('2');
    // Leaving the screen lets go of the key.
    view.destroy();
    search.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(document.activeElement).not.toBe(search);
  });
});

describe('a long list in order of change', () => {
  const labelsAndNames = (view) => [...view.el.querySelectorAll('.file-group, .file-name')].map((n) => (n.classList.contains('file-group') ? `# ${n.textContent}` : n.textContent));

  it('is drawn in stretches of time, labelled for the eye only, and flat in any other order', async () => {
    vi.setSystemTime(new Date(2026, 8, 29, 15, 0));
    const day = 86400000;
    // The drive counts seconds.
    const ago = (ms) => Math.floor((Date.now() - ms) / 1000);
    vi.spyOn(P, 'listFiles').mockResolvedValue([
      { path: 'Spreadsheets/A.xlsx', name: 'A.xlsx', size: 1, modified: ago(3600000) },
      { path: 'Spreadsheets/B.xlsx', name: 'B.xlsx', size: 3, modified: ago(day) },
      { path: 'Spreadsheets/C.xlsx', name: 'C.xlsx', size: 2, modified: ago(4 * day) },
      { path: 'Spreadsheets/D.xlsx', name: 'D.xlsx', size: 4, modified: ago(90 * day) },
    ]);
    const view = homeView({ openPath() {}, newDoc() {}, sampleDoc() {}, templateDoc() {}, importFile() {} });
    document.body.append(view.el);
    await vi.advanceTimersByTimeAsync(0);
    expect(labelsAndNames(view)).toEqual(['# Today', 'A', '# Yesterday', 'B', '# Previous 7 days', 'C', '# Earlier', 'D']);
    const list = view.el.querySelector('.file-list');
    expect([...list.children].every((c) => c.getAttribute('role') === 'listitem' || c.getAttribute('aria-hidden') === 'true')).toBe(true);
    // Past midnight the stretches move on by themselves.
    await vi.advanceTimersByTimeAsync(10 * 3600000);
    expect(labelsAndNames(view)).toEqual(['# Yesterday', 'A', '# Previous 7 days', 'B', 'C', '# Earlier', 'D']);
    view.el.querySelector('.home-sort').click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent === 'Name').click();
    expect(labelsAndNames(view)).toEqual(['A', 'B', 'C', 'D']);
    view.destroy();
  });

  it('draws no label when every file falls in the same stretch', async () => {
    const view = open();
    await vi.advanceTimersByTimeAsync(0);
    expect(view.el.querySelector('.file-group')).toBeNull();
    view.destroy();
  });
});
