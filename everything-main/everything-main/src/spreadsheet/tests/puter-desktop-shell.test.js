// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Puter desktop hands the app files from the drive (launched with, or dragged onto the window)
// and lets it decide when its window closes.
const mocks = vi.hoisted(() => ({
  fromPath: vi.fn(), fromBrowserFile: vi.fn(), fromDraft: vi.fn(), editor: vi.fn(), home: vi.fn(), init: vi.fn(async () => {}),
  launch: null, close: null, exitApp: vi.fn(), readFile: vi.fn(),
}));
vi.mock('../src/lib/doc.js', () => ({ Doc: { fromPath: mocks.fromPath, fromBrowserFile: mocks.fromBrowserFile, fromDraft: mocks.fromDraft, blank: () => Object.assign(new EventTarget(), { path: null, name: 'Untitled' }) } }));
vi.mock('../src/views/editor.js', () => ({ editorView: mocks.editor }));
vi.mock('../src/views/home.js', () => ({ homeView: mocks.home }));
vi.mock('../src/lib/session.js', () => ({ session: { init: mocks.init, signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ rememberRecent: vi.fn(), forgetRecent: vi.fn() }));
vi.mock('../src/lib/puter.js', () => ({
  hasSDK: () => true, isSignedIn: async () => true, onAuth() {}, setWindowTitle() {}, isNotFound: () => false,
  samePath: (a, b) => a === b,
  displayName: (p) => String(p).split('/').pop(),
  isDirItem: (it) => !!(it?.is_dir || it?.isDirectory),
  onLaunchedWithItems: (handler) => { mocks.launch = handler; },
  onWindowClose: (handler) => { mocks.close = handler; return true; },
  exitApp: mocks.exitApp,
  readFile: mocks.readFile,
}));

const editors = [];
let handlers;
function doc(path) { return Object.assign(new EventTarget(), { path, name: path, draftKept: true }); }

/** The drop the SDK dispatches for items dragged in from the desktop: the drive's entries, and no dataTransfer. */
function driveDrop(items) {
  const event = new CustomEvent('drop', { bubbles: true, cancelable: true, detail: { clientX: 10, clientY: 10, items } });
  document.body.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.launch = null;
  mocks.close = null;
  mocks.init.mockImplementation(async () => {});
  document.body.className = '';
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '#/edit/First.xlsx');
  editors.length = 0;
  mocks.fromPath.mockImplementation(async (path) => doc(path));
  mocks.editor.mockImplementation((options) => {
    const el = document.createElement('div');
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

describe('launched from the desktop', () => {
  it('opens the spreadsheet it was launched with, where it lives', async () => {
    let ready;
    mocks.init.mockImplementation(() => new Promise((done) => { ready = done; }));
    await import('../src/main.js');
    mocks.launch([{ name: 'Budget.xlsx', path: '/nj/Desktop/Budget.xlsx' }]);
    ready();
    await vi.waitFor(() => expect(editors).toHaveLength(1));
    expect(mocks.fromPath).toHaveBeenCalledWith('/nj/Desktop/Budget.xlsx');
  });

  it('says so, and opens nothing of it, when launched with a file that is not a spreadsheet', async () => {
    let ready;
    mocks.init.mockImplementation(() => new Promise((done) => { ready = done; }));
    await import('../src/main.js');
    mocks.launch([{ name: 'Song.mp3', path: '/nj/Desktop/Song.mp3' }]);
    expect(document.querySelector('.toast')?.textContent).toContain('Cannot open Song.mp3');
    ready();
    await vi.waitFor(() => expect(editors).toHaveLength(1));
    expect(mocks.fromPath).not.toHaveBeenCalledWith('/nj/Desktop/Song.mp3');
  });
});

describe('files dragged onto the window from the desktop', () => {
  it('opens a spreadsheet at its own address, so that its edits go back to it', async () => {
    const { view } = await bootEditor();
    const drop = driveDrop([{ name: 'Sales.csv', path: '/nj/Documents/Sales.csv', uid: 'u-1' }]);
    expect(drop.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(mocks.fromPath).toHaveBeenCalledWith('/nj/Documents/Sales.csv'));
    expect(view.flush).toHaveBeenCalled(); // the sheet it replaces was saved first
    expect(mocks.fromBrowserFile).not.toHaveBeenCalled();
  });

  it('puts an image on the open sheet', async () => {
    const { view } = await bootEditor();
    mocks.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    driveDrop([{ name: 'Logo.PNG', path: '/nj/Pictures/Logo.PNG' }]);
    await vi.waitFor(() => expect(view.acceptDrop).toHaveBeenCalled());
    const f = view.acceptDrop.mock.calls[0][0];
    expect(f.name).toBe('Logo.PNG');
    expect(f.type).toBe('image/png');
    expect(f.size).toBe(3);
  });

  it('opens the first file among several, passing over folders', async () => {
    await bootEditor();
    driveDrop([{ name: 'Reports', path: '/nj/Reports', isDirectory: true }, { name: 'Q3.xlsx', path: '/nj/Reports/Q3.xlsx' }]);
    await vi.waitFor(() => expect(mocks.fromPath).toHaveBeenCalledWith('/nj/Reports/Q3.xlsx'));
  });

  it('says so when what was dragged in cannot be opened', async () => {
    const { view } = await bootEditor();
    driveDrop([{ name: 'Song.mp3', path: '/nj/Music/Song.mp3' }]);
    expect(document.querySelector('.toast')?.textContent).toContain('Cannot open Song.mp3');
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(view.acceptDrop).not.toHaveBeenCalled();
  });
});

describe('the window close button', () => {
  it('saves the open sheet before the window closes', async () => {
    const { view } = await bootEditor();
    let saved;
    view.flush.mockImplementation(() => new Promise((done) => { saved = done; }));
    mocks.close();
    expect(view.flush).toHaveBeenCalled();
    expect(mocks.exitApp).not.toHaveBeenCalled();
    saved(true);
    await vi.waitFor(() => expect(mocks.exitApp).toHaveBeenCalledOnce());
  });

  it('keeps the window open when the user stays to keep editing', async () => {
    const { view } = await bootEditor();
    view.flush.mockResolvedValue(false);
    mocks.close();
    await new Promise((done) => setTimeout(done, 0));
    expect(view.flush).toHaveBeenCalledOnce();
    expect(mocks.exitApp).not.toHaveBeenCalled();
    // And the button asks again afterwards, saving afresh rather than closing past the answer.
    view.flush.mockResolvedValue(true);
    mocks.close();
    expect(view.flush).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(mocks.exitApp).toHaveBeenCalledOnce());
  });

  it('closes on a second press while a save hangs, the edits being kept on this device', async () => {
    const { view } = await bootEditor();
    view.flush.mockImplementation(() => new Promise(() => {}));
    mocks.close();
    expect(mocks.exitApp).not.toHaveBeenCalled();
    mocks.close();
    expect(mocks.exitApp).toHaveBeenCalledOnce();
  });

  it('does not close past a question the save is waiting on', async () => {
    const { view } = await bootEditor();
    view.flush.mockImplementation(() => new Promise(() => {}));
    mocks.close();
    document.body.classList.add('modal-open');
    mocks.close();
    expect(mocks.exitApp).not.toHaveBeenCalled();
  });

  it('waits on a hanging save when this browser could not keep the edits', async () => {
    const { view } = await bootEditor();
    view.doc.draftKept = false;
    view.flush.mockImplementation(() => new Promise(() => {}));
    mocks.close();
    mocks.close();
    expect(mocks.exitApp).not.toHaveBeenCalled();
  });

  it('closes at once from a screen with nothing to save', async () => {
    history.replaceState(null, '', '#/home');
    await import('../src/main.js');
    await vi.waitFor(() => expect(mocks.home).toHaveBeenCalledOnce());
    mocks.close();
    await vi.waitFor(() => expect(mocks.exitApp).toHaveBeenCalledOnce());
  });
});
