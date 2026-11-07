// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fromPath: vi.fn(), fromBrowserFile: vi.fn(), fromDraft: vi.fn(), editor: vi.fn(), home: vi.fn(), init: vi.fn(async () => {}),
}));
vi.mock('../src/lib/doc.js', () => ({ Doc: { fromPath: mocks.fromPath, fromBrowserFile: mocks.fromBrowserFile, fromDraft: mocks.fromDraft } }));
vi.mock('../src/views/editor.js', () => ({ editorView: mocks.editor }));
vi.mock('../src/views/home.js', () => ({ homeView: mocks.home }));
vi.mock('../src/lib/session.js', () => ({ session: { init: mocks.init, signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ rememberRecent: vi.fn(), forgetRecent: vi.fn() }));
vi.mock('../src/lib/puter.js', () => ({
  hasSDK: () => true, isSignedIn: async () => true, onAuth() {}, onLaunchedWithItems() {}, onWindowClose() {}, setWindowTitle() {}, isNotFound: () => false,
  samePath: (a, b) => a === b,
}));

let handlers;
const editors = [];
function doc(path) { return Object.assign(new EventTarget(), { path, name: path }); }
function file(name, type = '') { return new File(['data'], name, { type }); }

/** jsdom has no DragEvent: an Event with the dataTransfer the app reads stands in for one. */
function dragEvent(type, { files = [], types = ['Files'], relatedTarget = null } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types, files, dropEffect: 'none' } });
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
  return event;
}
function dropOn(node, name, type = '') {
  const f = file(name, type);
  node.dispatchEvent(dragEvent('dragover', { files: [f] }));
  node.dispatchEvent(dragEvent('drop', { files: [f] }));
  return f;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.init.mockImplementation(async () => {});
  document.body.className = '';
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '#/edit/First.xlsx');
  editors.length = 0;
  mocks.fromPath.mockImplementation(async (path) => doc(path));
  mocks.fromBrowserFile.mockImplementation(async (f) => doc(null, f.name));
  mocks.editor.mockImplementation((options) => {
    const el = document.createElement('div');
    el.className = 'editor view';
    const view = { el, doc: options.doc, flush: vi.fn().mockResolvedValue(true), destroy: vi.fn(), goTo: vi.fn(), acceptDrop: vi.fn() };
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
  document.body.className = '';
  document.body.replaceChildren();
});

async function bootEditor() {
  await import('../src/main.js');
  await vi.waitFor(() => expect(editors).toHaveLength(1));
  return editors[0];
}

async function bootHome() {
  history.replaceState(null, '', '#/home');
  await import('../src/main.js');
  await vi.waitFor(() => expect(mocks.home).toHaveBeenCalledOnce());
}

describe('dropping a file on the app', () => {
  it('keeps the browser from leaving the app for the dropped file', async () => {
    await bootEditor();
    const dragover = dragEvent('dragover', { files: [file('Budget.xlsx')] });
    const drop = dragEvent('drop', { files: [file('Budget.xlsx')] });
    document.body.dispatchEvent(dragover);
    document.body.dispatchEvent(drop);
    expect(dragover.defaultPrevented).toBe(true);
    expect(dragover.dataTransfer.dropEffect).toBe('copy');
    expect(drop.defaultPrevented).toBe(true);
  });

  it('hands a file dropped outside the sheet to the open spreadsheet', async () => {
    const { view } = await bootEditor();
    const dropped = dropOn(document.body, 'Picture.png', 'image/png');
    expect(view.acceptDrop).toHaveBeenCalledWith(dropped, expect.objectContaining({ files: [dropped] }));
    expect(mocks.fromBrowserFile).not.toHaveBeenCalled();
  });

  it('opens a spreadsheet dropped on a screen of its own, such as the file list', async () => {
    await bootHome();
    const dropped = dropOn(document.body, 'Budget.xlsx');
    await vi.waitFor(() => expect(mocks.fromBrowserFile).toHaveBeenCalledWith(dropped));
  });

  it('closes an open dialog the file was dropped over and still opens the file', async () => {
    const { view } = await bootEditor();
    // The app's own copy of the module, so the dialog is one it knows how to close.
    const { openModal } = await import('../src/ui/modal.js');
    openModal({ title: 'Format cells', content: document.createElement('div') });
    const panel = document.querySelector('.modal-panel');
    expect(document.body.classList.contains('modal-open')).toBe(true);
    const dropped = dropOn(panel, 'Budget.xlsx');
    expect(document.body.classList.contains('modal-open')).toBe(false);
    expect(view.acceptDrop).toHaveBeenCalledWith(dropped, expect.objectContaining({ files: [dropped] }));
  });

  it('opens a file dropped on the loading screen once the app is up', async () => {
    let ready;
    mocks.init.mockImplementation(() => new Promise((done) => { ready = done; }));
    await import('../src/main.js');
    await vi.waitFor(() => expect(mocks.init).toHaveBeenCalledOnce());
    const dropped = dropOn(document.body, 'Budget.xlsx');
    expect(mocks.fromBrowserFile).not.toHaveBeenCalled();
    ready();
    await vi.waitFor(() => expect(mocks.fromBrowserFile).toHaveBeenCalledWith(dropped));
    expect(mocks.fromPath).not.toHaveBeenCalled(); // the drop replaces the document the address named
  });

  it('says so when the file is not one the app can open', async () => {
    await bootHome();
    dropOn(document.body, 'Song.mp3', 'audio/mpeg');
    expect(mocks.fromBrowserFile).not.toHaveBeenCalled();
    expect(document.querySelector('.toast')?.textContent).toContain('Cannot open Song.mp3');
  });

  it('leaves a drag that carries no file to the browser', async () => {
    await bootEditor();
    const dragover = dragEvent('dragover', { types: ['text/plain'] });
    document.body.dispatchEvent(dragover);
    expect(dragover.defaultPrevented).toBe(false);
    expect(document.body.classList.contains('dropping')).toBe(false);
  });

  it('marks the window while the file is over it, until it leaves or lands', async () => {
    await bootEditor();
    document.body.dispatchEvent(dragEvent('dragover', { files: [file('Budget.xlsx')] }));
    expect(document.body.classList.contains('dropping')).toBe(true);
    // Crossing onto another element is not leaving: the whole window takes the drop.
    document.body.dispatchEvent(dragEvent('dragleave', { relatedTarget: document.querySelector('#app') }));
    expect(document.body.classList.contains('dropping')).toBe(true);
    document.body.dispatchEvent(dragEvent('dragleave'));
    expect(document.body.classList.contains('dropping')).toBe(false);
    dropOn(document.body, 'Budget.xlsx');
    expect(document.body.classList.contains('dropping')).toBe(false);
  });

  it('lets the open spreadsheet mark where the file goes in place of the window, and clears it when the drag ends', async () => {
    const { view } = await bootEditor();
    view.dragOver = vi.fn((x) => x !== null); // the stand-in drag has no position: it is over the panel
    document.body.dispatchEvent(dragEvent('dragover', { files: [file('receipt.png')] }));
    expect(document.body.classList.contains('dropping-local')).toBe(true);
    document.body.dispatchEvent(dragEvent('dragleave'));
    expect(document.body.classList.contains('dropping-local')).toBe(false);
    expect(view.dragOver).toHaveBeenLastCalledWith(null);
  });
});
