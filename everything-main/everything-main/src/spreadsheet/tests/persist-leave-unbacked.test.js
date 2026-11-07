// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeAllModals } from '../src/ui/modal.js';

const mocks = vi.hoisted(() => ({ editor: vi.fn(), home: vi.fn(), doc: null }));
vi.mock('../src/lib/doc.js', () => ({ Doc: { blank: () => mocks.doc, fromPath: vi.fn(), fromBrowserFile: vi.fn(), fromDraft: vi.fn() } }));
vi.mock('../src/views/editor.js', () => ({ editorView: mocks.editor }));
vi.mock('../src/views/home.js', () => ({ homeView: mocks.home }));
vi.mock('../src/lib/session.js', () => ({ session: { init: async () => {}, signedOut: true, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ rememberRecent: vi.fn(), forgetRecent: vi.fn() }));
vi.mock('../src/lib/puter.js', () => ({
  hasSDK: () => true, isSignedIn: async () => false, onAuth() {}, onLaunchedWithItems() {}, onWindowClose() {}, setWindowTitle() {}, isNotFound: () => false, samePath: (a, b) => a === b,
}));

let handlers;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="app"></div>';
  mocks.doc = Object.assign(new EventTarget(), { path: null, name: 'Untitled spreadsheet', draftKept: true });
  mocks.editor.mockImplementation((options) => ({ el: document.createElement('div'), doc: options.doc, flush: vi.fn().mockResolvedValue(true), destroy: vi.fn(), goTo: vi.fn(), options }));
  mocks.home.mockImplementation(() => ({ el: document.createElement('div'), destroy: vi.fn() }));
  handlers = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => { handlers.push([type, listener, options]); add(type, listener, options); });
  history.replaceState(null, '', '#/new');
});
afterEach(() => {
  closeAllModals();
  for (const [type, listener, options] of handlers) window.removeEventListener(type, listener, options);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const dialogText = () => document.querySelector('[role="dialog"]')?.textContent || '';
// The dialog belongs to the module instance main.js loaded, so it is closed through its own button.
const keepEditing = () => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'Keep editing').click();

// Leaving without a session said the edits could be left to the local draft even when this
// browser had not been able to keep one: leaving then lost them without a word.
it('warns that leaving loses the edits when this browser could not keep a copy of them', async () => {
  await import('../src/main.js');
  await vi.waitFor(() => expect(mocks.editor).toHaveBeenCalledOnce());
  const { leaveDialog } = mocks.editor.mock.calls[0][0];
  mocks.doc.draftKept = false;
  const pending = leaveDialog();
  expect(dialogText()).toMatch(/could not keep a copy/);
  expect(dialogText()).toMatch(/lose/);
  keepEditing();
  expect(await pending).toBe('stay');
});

// While the local draft holds the edits, leaving said the spreadsheet would be discarded, though the
// home screen lists it under Unsaved spreadsheets for recovery.
it('says the edits stay on this device and where to find them, while the local draft holds them', async () => {
  await import('../src/main.js');
  await vi.waitFor(() => expect(mocks.editor).toHaveBeenCalledOnce());
  const { leaveDialog } = mocks.editor.mock.calls[0][0];
  const pending = leaveDialog();
  expect(dialogText()).toMatch(/not saved to Puter yet\. Sign in/);
  expect(dialogText()).toMatch(/stays? on this device/);
  expect(dialogText()).toMatch(/Unsaved spreadsheets/);
  expect(dialogText()).not.toMatch(/discard|lose|could not keep a copy/);
  keepEditing();
  expect(await pending).toBe('stay');
});
