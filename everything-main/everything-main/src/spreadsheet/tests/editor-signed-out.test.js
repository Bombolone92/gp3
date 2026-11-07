// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { session } from '../src/lib/session.js';
import { closeAllModals } from '../src/ui/modal.js';
import { installMockPuter } from './helpers/mock-puter.js';
import { workbookToXlsx } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';

let view, calls;
// SheetJS loads through a real dynamic import that fake timers cannot advance; warm it up first.
beforeAll(async () => { await workbookToXlsx(new Workbook()); });
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
  ({ calls } = installMockPuter());
  puter._signedIn = false;
  puter.auth = {
    isSignedIn: () => puter._signedIn,
    signIn: vi.fn(async () => { puter._signedIn = true; }),
    getUser: async () => (puter._signedIn ? { username: 'nariman', uuid: 'u-1' } : null),
  };
  await session.init();
});
afterEach(() => {
  closeAllModals();
  view?.destroy();
  view = null;
  session.state = 'unknown';
  session.user = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globalThis.puter;
  document.body.replaceChildren();
});

// Document writes only; a version snapshot may follow a save.
const writes = () => calls.filter(([op, path]) => op === 'write' && !path.includes('/.versions/')).map(([, path]) => path);

function setup(leaveDialog = null) {
  const doc = Doc.blank();
  const goHome = vi.fn();
  view = editorView({ doc, goHome, openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn(), leaveDialog });
  document.querySelector('#app').append(view.el);
  return { doc, goHome };
}

describe('editing without a Puter session', () => {
  it('shows "Sign in to save" instead of autosaving, and the pill signs in and saves', async () => {
    const { doc } = setup();
    const pill = view.el.querySelector('.save-status');
    expect(pill.textContent).toContain('Sign in to save');
    expect(pill.disabled).toBe(false);
    const account = view.el.querySelector('.user-btn');
    expect(account.title).toBe('Not signed in');

    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'typed before signing in');
    await vi.advanceTimersByTimeAsync(10000);
    expect(writes()).toEqual([]);
    expect(doc.wb.dirty).toBe(true);
    expect(pill.textContent).toContain('Sign in to save');

    pill.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(puter.auth.signIn).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(writes()).toEqual(['Spreadsheets/Untitled spreadsheet.xlsx']));
    await vi.waitFor(() => expect(doc.wb.dirty).toBe(false));
    expect(pill.classList.contains('signed-out')).toBe(false);
    expect(pill.textContent).toContain('Saved');
    expect(account.title).toBe('nariman');

    // From here on autosave runs as usual.
    doc.wb.setInput(doc.wb.activeSheetId, 0, 1, 'after');
    await vi.advanceTimersByTimeAsync(1600);
    await vi.waitFor(() => expect(writes()).toHaveLength(2));
  });

  it('lets the user keep editing, leave the edits to the local draft, or sign in and save', async () => {
    const leaveDialog = vi.fn();
    const { doc, goHome } = setup(leaveDialog);
    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'unsaved');

    leaveDialog.mockResolvedValueOnce('stay');
    expect(await view.flush()).toBe(false);
    expect(doc.wb.dirty).toBe(true);
    expect(puter.auth.signIn).not.toHaveBeenCalled();

    leaveDialog.mockResolvedValueOnce('leave');
    expect(await view.flush()).toBe(true);
    expect(writes()).toEqual([]);
    // The draft in this browser keeps what was typed.
    expect(localStorage.keys().some((key) => key.includes('guest'))).toBe(true);
    // The router flushes once more on the way out; the answer stands.
    expect(await view.flush()).toBe(true);
    expect(leaveDialog).toHaveBeenCalledTimes(2);

    // Typing again makes the question worth asking again.
    doc.wb.setInput(doc.wb.activeSheetId, 1, 0, 'more');
    leaveDialog.mockResolvedValueOnce('sign-in');
    expect(await view.flush()).toBe(true);
    expect(puter.auth.signIn).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual(['Spreadsheets/Untitled spreadsheet.xlsx']);
    expect(doc.wb.dirty).toBe(false);
    expect(goHome).not.toHaveBeenCalled();
  });

  it('leaves an untouched new sheet without asking', async () => {
    const leaveDialog = vi.fn();
    setup(leaveDialog);
    expect(await view.flush()).toBe(true);
    expect(leaveDialog).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});
