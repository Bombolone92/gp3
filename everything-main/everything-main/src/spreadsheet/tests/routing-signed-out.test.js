// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fromPath: vi.fn(), blank: vi.fn(), editor: vi.fn(), home: vi.fn(),
  session: { init: async () => {}, signedOut: true, signedIn: false, signIn: vi.fn(), addEventListener() {}, removeEventListener() {} },
}));
vi.mock('../src/lib/doc.js', () => ({ Doc: { fromPath: mocks.fromPath, blank: mocks.blank, fromBrowserFile: vi.fn(), fromDraft: vi.fn() } }));
vi.mock('../src/views/editor.js', () => ({ editorView: mocks.editor }));
vi.mock('../src/views/home.js', () => ({ homeView: mocks.home }));
vi.mock('../src/lib/session.js', () => ({ session: mocks.session }));
vi.mock('../src/lib/recent.js', () => ({ rememberRecent: vi.fn(), forgetRecent: vi.fn() }));
vi.mock('../src/lib/puter.js', () => ({
  hasSDK: () => true, isSignedIn: async () => false, onAuth() {}, onLaunchedWithItems() {}, onWindowClose() {}, setWindowTitle() {}, isNotFound: () => false, samePath: (a, b) => a === b,
}));

const editors = [];
function doc(path) { return Object.assign(new EventTarget(), { path, name: path || 'Untitled spreadsheet' }); }
let handlers;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.session.signedOut = true;
  mocks.session.signedIn = false;
  mocks.session.signIn.mockImplementation(async () => { mocks.session.signedOut = false; mocks.session.signedIn = true; return true; });
  document.body.innerHTML = '<div id="app"></div>';
  editors.length = 0;
  mocks.blank.mockImplementation(() => doc(null));
  mocks.fromPath.mockImplementation(async (path) => doc(path));
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

describe('opening the app without a session', () => {
  it('lands in a new spreadsheet, with no intro or sign-in screen', async () => {
    history.replaceState(null, '', '#/');
    await import('../src/main.js');
    await vi.waitFor(() => expect(editors).toHaveLength(1));
    expect(mocks.blank).toHaveBeenCalledOnce();
    expect(mocks.home).not.toHaveBeenCalled();
    expect(mocks.session.signIn).not.toHaveBeenCalled();
    expect(document.querySelector('#app').textContent).toBe('blank');
    // The editor gets the dialog for edits that have nowhere to go.
    expect(typeof editors[0].options.leaveDialog).toBe('function');
    // The list is its own address.
    editors[0].options.goHome();
    await vi.waitFor(() => expect(mocks.home).toHaveBeenCalledOnce());
    expect(location.hash).toBe('#/home');
  });

  it('asks for the sign-in before reading a cloud file from the address, then opens it', async () => {
    history.replaceState(null, '', '#/edit/Spreadsheets%2FBudget.xlsx');
    await import('../src/main.js');
    const app = document.querySelector('#app');
    await vi.waitFor(() => expect(app.textContent).toContain('Sign in to open this spreadsheet'));
    expect(mocks.fromPath).not.toHaveBeenCalled();
    expect(location.hash).toBe('#/edit/Spreadsheets%2FBudget.xlsx');

    [...app.querySelectorAll('button')].find((b) => b.textContent === 'Sign in to Puter').click();
    await vi.waitFor(() => expect(mocks.session.signIn).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(editors).toHaveLength(1));
    expect(mocks.fromPath).toHaveBeenCalledWith('Spreadsheets/Budget.xlsx');
    expect(editors[0].view.doc.path).toBe('Spreadsheets/Budget.xlsx');
  });

  it('offers a new spreadsheet instead of the sign-in', async () => {
    history.replaceState(null, '', '#/edit/Spreadsheets%2FBudget.xlsx');
    await import('../src/main.js');
    const app = document.querySelector('#app');
    await vi.waitFor(() => expect(app.textContent).toContain('Sign in to open this spreadsheet'));
    [...app.querySelectorAll('button')].find((b) => b.textContent === 'New spreadsheet').click();
    await vi.waitFor(() => expect(editors).toHaveLength(1));
    expect(editors[0].view.doc.path).toBeNull();
    expect(mocks.fromPath).not.toHaveBeenCalled();
    expect(mocks.session.signIn).not.toHaveBeenCalled();
  });
});
