// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fromPath: vi.fn(), fromBrowserFile: vi.fn(), fromDraft: vi.fn(), editor: vi.fn(), home: vi.fn() }));
vi.mock('../src/lib/doc.js', () => ({ Doc: { fromPath: mocks.fromPath, fromBrowserFile: mocks.fromBrowserFile, fromDraft: mocks.fromDraft } }));
vi.mock('../src/views/editor.js', () => ({ editorView: mocks.editor }));
vi.mock('../src/views/home.js', () => ({ homeView: mocks.home }));
vi.mock('../src/lib/session.js', () => ({ session: { init: async () => {}, signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ rememberRecent: vi.fn(), forgetRecent: vi.fn() }));
vi.mock('../src/lib/puter.js', () => ({
  hasSDK: () => true, isSignedIn: async () => true, onAuth() {}, onLaunchedWithItems() {}, onWindowClose() {}, setWindowTitle() {}, isNotFound: () => false, samePath: (a, b) => a === b,
}));

let handlers;
const editors = [];
function doc(path) { return Object.assign(new EventTarget(), { path, name: path }); }
function navigate(hash) {
  history.replaceState(null, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '#/edit/First.xlsx');
  editors.length = 0;
  mocks.fromPath.mockImplementation(async (path) => doc(path));
  mocks.editor.mockImplementation((options) => {
    const el = document.createElement('div');
    el.textContent = options.doc.path;
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

describe('document routing', () => {
  it('queues draft recovery behind a pending file open and flushes the intervening editor', async () => {
    let resolve;
    history.replaceState(null, '', '#/home');
    await import('../src/main.js');
    await vi.waitFor(() => expect(mocks.home).toHaveBeenCalledOnce());
    const nav = mocks.home.mock.calls[0][0];
    const recovered = doc(null);
    recovered.name = 'Recovered';
    mocks.fromDraft.mockReturnValue(recovered);
    mocks.fromPath.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    nav.openPath('Slow.xlsx');
    await vi.waitFor(() => expect(mocks.fromPath).toHaveBeenCalledOnce());
    nav.recoverDraft('draft-key');
    expect(mocks.fromDraft).not.toHaveBeenCalled();
    resolve(doc('Slow.xlsx'));
    await vi.waitFor(() => expect(editors).toHaveLength(2));
    expect(mocks.fromDraft).toHaveBeenCalledWith('draft-key');
    expect(editors[0].view.flush).toHaveBeenCalledOnce();
    expect(editors[0].view.destroy).toHaveBeenCalledOnce();
    expect(editors[1].view.doc).toBe(recovered);
  });

  it('honors navigation during a device import without replacing an unflushed editor', async () => {
    let resolve;
    mocks.fromBrowserFile.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await import('../src/main.js');
    await vi.waitFor(() => expect(editors).toHaveLength(1));
    const importing = editors[0].options.importFile({ name: 'Imported.xlsx' });
    await vi.waitFor(() => expect(mocks.fromBrowserFile).toHaveBeenCalledOnce());
    navigate('#/edit/Second.xlsx');
    resolve(doc('Spreadsheets/Imported.xlsx'));
    await importing;
    await vi.waitFor(() => expect(document.querySelector('#app').textContent).toBe('Second.xlsx'));
    for (const editor of editors.slice(0, -1)) {
      expect(editor.view.flush).toHaveBeenCalledOnce();
      expect(editor.view.destroy).toHaveBeenCalledOnce();
    }
    expect(location.hash).toBe('#/edit/Second.xlsx');
  });

  it('destroys the home view when leaving it', async () => {
    history.replaceState(null, '', '#/home');
    await import('../src/main.js');
    await vi.waitFor(() => expect(mocks.home).toHaveBeenCalledOnce());
    const home = mocks.home.mock.results[0].value;
    navigate('#/edit/First.xlsx');
    await vi.waitFor(() => expect(editors).toHaveLength(1));
    expect(home.destroy).toHaveBeenCalledOnce();
  });

  it('keeps the mounted editor and restores its address if navigation cannot save', async () => {
    await import('../src/main.js');
    await vi.waitFor(() => expect(editors).toHaveLength(1));
    editors[0].view.flush.mockResolvedValue(false);
    navigate('#/home');
    await vi.waitFor(() => expect(location.hash).toBe('#/edit/First.xlsx'));
    expect(document.querySelector('#app').textContent).toBe('First.xlsx');
    expect(editors[0].view.destroy).not.toHaveBeenCalled();
    expect(mocks.home).not.toHaveBeenCalled();
  });

  it('reloads a current file when explicitly requested', async () => {
    await import('../src/main.js');
    await vi.waitFor(() => expect(editors).toHaveLength(1));
    editors[0].options.openPath('First.xlsx', { reload: true });
    await vi.waitFor(() => expect(editors).toHaveLength(2));
    expect(mocks.fromPath).toHaveBeenCalledTimes(2);
    expect(editors[0].view.destroy).toHaveBeenCalledOnce();
  });

  it('honors navigation requested while another file is still opening', async () => {
    let resolve;
    mocks.fromPath.mockImplementationOnce((path) => new Promise((done) => { resolve = () => done(doc(path)); }));
    await import('../src/main.js');
    await vi.waitFor(() => expect(mocks.fromPath).toHaveBeenCalledOnce());
    navigate('#/edit/Second.xlsx');
    resolve();
    await vi.waitFor(() => expect(document.querySelector('#app').textContent).toBe('Second.xlsx'));
    expect(location.hash).toBe('#/edit/Second.xlsx');
  });
});
