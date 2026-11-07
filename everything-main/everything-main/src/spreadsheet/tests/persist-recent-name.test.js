// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { stripExtension } from '../src/core/io.js';
import { memoryStorage } from './helpers/memory-storage.js';

const mocks = vi.hoisted(() => ({ fromPath: vi.fn(), editor: vi.fn(), home: vi.fn(), rememberRecent: vi.fn() }));
vi.mock('../src/lib/doc.js', () => ({ Doc: { fromPath: mocks.fromPath, fromBrowserFile: vi.fn(), fromDraft: vi.fn() } }));
vi.mock('../src/views/editor.js', () => ({ editorView: mocks.editor }));
vi.mock('../src/views/home.js', () => ({ homeView: mocks.home }));
vi.mock('../src/lib/session.js', () => ({ session: { init: async () => {}, signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', async (importOriginal) => ({ ...(await importOriginal()), rememberRecent: mocks.rememberRecent }));
vi.mock('../src/lib/puter.js', () => ({
  hasSDK: () => true, isSignedIn: async () => true, onAuth() {}, onLaunchedWithItems() {}, onWindowClose() {}, setWindowTitle() {}, isNotFound: () => false, samePath: (a, b) => a === b,
  inAppFolder: (path) => String(path).startsWith('Spreadsheets/'),
}));

let handlers;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="app"></div>';
  mocks.editor.mockImplementation((options) => ({ el: document.createElement('div'), doc: options.doc, flush: vi.fn().mockResolvedValue(true), destroy: vi.fn(), goTo: vi.fn() }));
  mocks.home.mockImplementation(() => ({ el: document.createElement('div'), destroy: vi.fn() }));
  handlers = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => { handlers.push([type, listener, options]); add(type, listener, options); });
});
afterEach(() => {
  for (const [type, listener, options] of handlers) window.removeEventListener(type, listener, options);
  vi.restoreAllMocks();
  document.body.replaceChildren();
  history.replaceState(null, '', '#/');
});

// The record held the document's name, already without its extension, and the home screen
// stripped an extension once more when showing it: "Q3.5.xlsx" was listed as "Q3".
it('remembers a file opened from elsewhere by its address and id alone, so the list strips its extension only once', async () => {
  const path = '/nj/Desktop/Q3.5.xlsx';
  const doc = Object.assign(new EventTarget(), { path, uid: 'u1', name: 'Q3.5' });
  Object.defineProperty(doc, 'file', { get: () => ({ path: doc.path, uid: doc.uid }) });
  mocks.fromPath.mockResolvedValue(doc);
  history.replaceState(null, '', `#/edit/${encodeURIComponent(path)}`);
  await import('../src/main.js');
  await vi.waitFor(() => expect(mocks.rememberRecent).toHaveBeenCalled());
  expect(mocks.rememberRecent).toHaveBeenCalledWith({ path, uid: 'u1' });
  // A first save or a rename records the file the same way.
  doc.path = '/nj/Desktop/Q3.6.xlsx';
  doc.dispatchEvent(new CustomEvent('path', { detail: { path: doc.path, name: 'Q3.6' } }));
  expect(mocks.rememberRecent).toHaveBeenLastCalledWith({ path: '/nj/Desktop/Q3.6.xlsx', uid: 'u1' });
});

it('keeps the file name in the record, which shows as the document name once stripped', async () => {
  const { rememberRecent, recentFiles } = await vi.importActual('../src/lib/recent.js');
  const storage = memoryStorage();
  rememberRecent('/nj/Desktop/Q3.5.xlsx', undefined, storage);
  const [record] = recentFiles(storage);
  expect(record.name).toBe('Q3.5.xlsx');
  expect(stripExtension(record.name)).toBe('Q3.5');
});
