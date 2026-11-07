// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createSheetTabs } from '../src/ui/sheettabs.js';
import { homeView } from '../src/views/home.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

// An item that opens a dialog before acting ends in an ellipsis, as "Color…" and "Copy to another
// spreadsheet…" do; the sheet tab's Rename and Delete and the home screen's Rename and Delete, which
// open a prompt or ask to be sure, had none.
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
beforeEach(() => { vi.useFakeTimers(); Element.prototype.scrollIntoView = vi.fn(); document.body.replaceChildren(); });
afterEach(() => { closeMenu(); closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

const labels = () => [...document.querySelectorAll('.menu-item')].map((b) => b.querySelector('.menu-label').textContent);

describe('the sheet tab menu', () => {
  it('marks Rename, which asks for the name, and Delete when the sheet holds work and asks first', () => {
    const wb = new Workbook({ sheets: [{ name: 'Data' }, { name: 'Empty' }] });
    wb.setInput(wb.sheets[0].id, 0, 0, 'x');
    const tabs = createSheetTabs({ wb });
    document.body.append(tabs.el);
    tabs.el.querySelector('.tab-menu-btn').click();
    expect(labels()).toContain('Rename…');
    expect(labels()).toContain('Delete…');
    expect(labels()).not.toContain('Delete');
    closeMenu();
    // An empty sheet is deleted at once, with nothing to ask.
    wb.setActiveSheet(wb.sheets[1].id);
    tabs.el.querySelector('.tab-menu-btn').click();
    expect(labels()).toContain('Delete');
    expect(labels()).not.toContain('Delete…');
    [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Delete').click();
    expect(document.querySelector('.modal-panel')).toBeNull();
    expect(wb.sheets).toHaveLength(1);
    tabs.destroy();
  });
});

describe('the home file menu', () => {
  it('marks Rename and Delete, which open a prompt and a confirmation', async () => {
    vi.spyOn(P, 'listFiles').mockResolvedValue([{ path: 'Spreadsheets/Budget.xlsx', name: 'Budget.xlsx', size: 10, modified: 1 }]);
    const view = homeView({ openPath() {}, newDoc() {}, sampleDoc() {}, templateDoc() {}, importFile() {} });
    document.body.append(view.el);
    await vi.advanceTimersByTimeAsync(0);
    view.el.querySelector('.file-menu-btn').click();
    expect(labels()).toEqual(['Open', 'Rename…', 'Duplicate', 'Download', 'Delete…']);
    [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Delete…').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.modal-panel')?.getAttribute('aria-label')).toBe('Delete "Budget"?');
    view.destroy();
  });
});
