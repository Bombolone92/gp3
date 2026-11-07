// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// The app shell's waits were silent: the loading screen is a spinner and a paragraph, with no live
// region, no landmark and nothing taking the focus to it, so neither "Opening…" nor "Importing
// <name>…" was ever announced. (The home list's and the sign-in's waits are announced by their own
// views; see shell-announces-waits.test.js.)

const mocks = vi.hoisted(() => ({
  fromPath: vi.fn(), blank: vi.fn(), fromBrowserFile: vi.fn(), editor: vi.fn(), home: vi.fn(),
  session: { init: vi.fn(async () => {}), signedOut: false, signedIn: true, signIn: vi.fn(), addEventListener() {}, removeEventListener() {} },
}));
vi.mock('../src/lib/doc.js', () => ({ Doc: { fromPath: mocks.fromPath, blank: mocks.blank, fromBrowserFile: mocks.fromBrowserFile, fromDraft: vi.fn() } }));
vi.mock('../src/views/editor.js', () => ({ editorView: mocks.editor }));
vi.mock('../src/views/home.js', () => ({ homeView: mocks.home }));
vi.mock('../src/lib/session.js', () => ({ session: mocks.session }));
vi.mock('../src/lib/recent.js', () => ({ rememberRecent: vi.fn(), forgetRecent: vi.fn() }));
vi.mock('../src/lib/puter.js', () => ({
  hasSDK: () => true, isSignedIn: async () => true, onAuth() {}, onLaunchedWithItems() {}, onWindowClose() {}, setWindowTitle() {}, isNotFound: () => false, samePath: (a, b) => a === b,
}));

const editors = [];
const doc = (path) => Object.assign(new EventTarget(), { path, name: path || 'Untitled spreadsheet' });
const tick = async (n = 12) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
const waiting = () => document.querySelector('#app [role="status"]');

let handlers;
let deferred;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="app"></div>';
  editors.length = 0;
  deferred = {};
  deferred.promise = new Promise((resolve) => { deferred.resolve = resolve; });
  mocks.session.init.mockImplementation(async () => {});
  mocks.blank.mockImplementation(() => doc(null));
  mocks.fromPath.mockImplementation(async () => deferred.promise);
  mocks.fromBrowserFile.mockImplementation(async () => deferred.promise);
  mocks.editor.mockImplementation((options) => {
    const el = document.createElement('div');
    el.textContent = options.doc.path || 'blank';
    const view = { el, doc: options.doc, flush: vi.fn().mockResolvedValue(true), destroy: vi.fn(), goTo: vi.fn() };
    editors.push({ view, options });
    return view;
  });
  mocks.home.mockImplementation(() => ({ el: document.createElement('div'), destroy: vi.fn() }));
  handlers = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    handlers.push([type, listener, options]);
    add(type, listener, options);
  });
});
afterEach(() => {
  for (const [type, listener, options] of handlers) window.removeEventListener(type, listener, options);
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it('says what it is waiting for while a spreadsheet is opened from its address', async () => {
  history.replaceState(null, '', '#/edit/Spreadsheets%2FBudget.xlsx');
  await import('../src/main.js');
  await vi.waitFor(() => expect(waiting()).not.toBeNull());
  expect(waiting().textContent).toBe('Opening…');
  deferred.resolve(doc('Spreadsheets/Budget.xlsx'));
  await vi.waitFor(() => expect(editors).toHaveLength(1));
  expect(waiting()).toBeNull(); // the wait is over, and its line goes with it
});

it('names the file it is reading while an import is opened', async () => {
  history.replaceState(null, '', '#/new');
  await import('../src/main.js');
  await vi.waitFor(() => expect(editors).toHaveLength(1));
  editors[0].options.importFile({ name: 'Q3 report.csv' });
  await tick();
  expect(waiting().textContent).toBe('Importing Q3 report.csv…');
  deferred.resolve(doc(null));
  await vi.waitFor(() => expect(editors).toHaveLength(2));
});

it('says the app is loading while the session is looked up at boot', async () => {
  let ready;
  mocks.session.init.mockImplementation(() => new Promise((resolve) => { ready = resolve; }));
  history.replaceState(null, '', '#/new');
  await import('../src/main.js');
  await vi.waitFor(() => expect(waiting()).not.toBeNull());
  expect(waiting().textContent).toBe('Loading…');
  ready();
  await vi.waitFor(() => expect(editors).toHaveLength(1));
});
