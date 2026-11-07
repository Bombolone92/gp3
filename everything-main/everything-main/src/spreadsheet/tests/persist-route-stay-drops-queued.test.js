// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeAllModals } from '../src/ui/modal.js';

const mocks = vi.hoisted(() => ({ editor: vi.fn(), home: vi.fn(), fromBrowserFile: vi.fn(), doc: null }));
vi.mock('../src/lib/doc.js', () => {
  // Constructable, since the sample route builds a document itself (`new Doc(...)`).
  function Doc(options = {}) {
    return Object.assign(new EventTarget(), { path: null, name: options.name ?? 'Untitled spreadsheet', wb: options.wb ?? null, draftKept: true, _changed() {} });
  }
  Doc.blank = () => mocks.doc;
  Doc.fromPath = vi.fn();
  Doc.fromBrowserFile = mocks.fromBrowserFile;
  Doc.fromDraft = vi.fn();
  return { Doc };
});
vi.mock('../src/views/editor.js', () => ({ editorView: mocks.editor }));
vi.mock('../src/views/home.js', () => ({ homeView: mocks.home }));
vi.mock('../src/lib/session.js', () => ({ session: { init: async () => {}, signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ rememberRecent: vi.fn(), forgetRecent: vi.fn() }));
vi.mock('../src/lib/puter.js', () => ({
  hasSDK: () => true, isSignedIn: async () => true, onAuth() {}, onLaunchedWithItems() {}, onWindowClose() {}, setWindowTitle() {}, isNotFound: () => false, samePath: (a, b) => a === b,
}));

let handlers;
let answers;
let flush;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="app"></div>';
  mocks.doc = Object.assign(new EventTarget(), { path: null, name: 'Untitled spreadsheet', draftKept: true });
  mocks.home.mockImplementation(() => ({ el: document.createElement('div'), destroy: vi.fn() }));
  // The editor's flush stands in for the leave question: each call is answered by hand.
  answers = [];
  flush = vi.fn(() => new Promise((resolve) => answers.push(resolve)));
  mocks.editor.mockImplementation((options) => ({ el: document.createElement('div'), doc: options.doc, flush, destroy: vi.fn(), goTo: vi.fn() }));
  handlers = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => { handlers.push([type, listener, options]); add(type, listener, options); });
  history.replaceState(null, '', '#/new');
});
afterEach(() => {
  closeAllModals();
  for (const [type, listener, options] of handlers) window.removeEventListener(type, listener, options);
  vi.restoreAllMocks();
  document.body.replaceChildren();
  history.replaceState(null, '', '#/');
});

const settle = () => new Promise((r) => setTimeout(r, 20));

/** The editor is open with the leave question pending for a navigation to the list, and a second navigation arrives meanwhile. */
async function questionOpenWithSecondNavigation() {
  await import('../src/main.js');
  await vi.waitFor(() => expect(mocks.editor).toHaveBeenCalledOnce());
  location.hash = '#/home';
  await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
}

// A navigation arriving while the leave question was open (Back pressed a second time, say) was queued
// and replayed once the question was answered: after "Keep editing" the editor was asked to leave again.
it('drops a navigation queued while the leave question was open once the user chooses to stay', { timeout: 30000 }, async () => {
  await questionOpenWithSecondNavigation();
  location.hash = '#/sample';
  await settle();
  expect(flush).toHaveBeenCalledTimes(1);
  answers[0](false); // Keep editing
  await settle();
  expect(flush).toHaveBeenCalledTimes(1);
  expect(location.hash).toBe('#/new');
  expect(mocks.home).not.toHaveBeenCalled();
  expect(mocks.editor).toHaveBeenCalledOnce();
});

it('still leaves for a queued navigation when the user chooses to go', { timeout: 30000 }, async () => {
  await questionOpenWithSecondNavigation();
  location.hash = '#/sample';
  await settle();
  answers[0](true); // Leave
  await settle();
  // The first navigation went through (to the list), then the queued one from there.
  expect(mocks.home).toHaveBeenCalledOnce();
  expect(location.hash).toBe('#/sample');
});

it('keeps a file dropped while the question was open, a deliberate move on the app itself', { timeout: 30000 }, async () => {
  await questionOpenWithSecondNavigation();
  const imported = Object.assign(new EventTarget(), { path: null, name: 'Dropped' });
  mocks.fromBrowserFile.mockResolvedValue(imported);
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  const file = new File(['a,b'], 'dropped.csv');
  Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [file] } });
  window.dispatchEvent(drop); // closes the question ("stay") and asks for the import
  await settle();
  answers[0](false);
  await settle();
  // The import was kept: the editor is asked once more, for it, and it opens once allowed.
  expect(flush).toHaveBeenCalledTimes(2);
  answers[1](true);
  await vi.waitFor(() => expect(mocks.editor).toHaveBeenCalledTimes(2));
  expect(mocks.editor.mock.calls[1][0].doc).toBe(imported);
  expect(location.hash).toBe('#/new');
});
