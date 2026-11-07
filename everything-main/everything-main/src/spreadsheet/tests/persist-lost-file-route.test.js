// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fromPath: vi.fn(), editor: vi.fn(), home: vi.fn(), forgetRecent: vi.fn(), toast: vi.fn() }));
vi.mock('../src/lib/doc.js', () => ({ Doc: { fromPath: mocks.fromPath, fromBrowserFile: vi.fn(), fromDraft: vi.fn() } }));
vi.mock('../src/views/editor.js', () => ({ editorView: mocks.editor }));
vi.mock('../src/views/home.js', () => ({ homeView: mocks.home }));
vi.mock('../src/ui/toast.js', () => ({ toast: mocks.toast }));
vi.mock('../src/lib/session.js', () => ({ session: { init: async () => {}, signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ rememberRecent: vi.fn(), forgetRecent: mocks.forgetRecent }));
vi.mock('../src/lib/puter.js', () => ({
  hasSDK: () => true, isSignedIn: async () => true, onAuth() {}, onLaunchedWithItems() {}, onWindowClose() {}, setWindowTitle() {}, isNotFound: () => false, samePath: (a, b) => a === b,
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

it('opens the recovered edits of a deleted file as a new spreadsheet, says so, and forgets the old address', async () => {
  const path = '/nj/Desktop/Gone.xlsx';
  const recovered = Object.assign(new EventTarget(), { path: null, name: 'Gone' });
  mocks.fromPath.mockResolvedValue(recovered);
  history.replaceState(null, '', `#/edit/${encodeURIComponent(path)}`);
  await import('../src/main.js');
  await vi.waitFor(() => expect(mocks.editor).toHaveBeenCalledOnce());
  expect(mocks.editor.mock.calls[0][0].doc).toBe(recovered);
  expect(location.hash).toBe('#/new');
  expect(mocks.forgetRecent).toHaveBeenCalledWith(path);
  expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('no longer exists'), expect.anything());
  expect(mocks.home).not.toHaveBeenCalled();
});

it('forgets the old address of a file found where the drive keeps it now', async () => {
  const path = '/nj/Desktop/Old.xlsx';
  mocks.fromPath.mockResolvedValue(Object.assign(new EventTarget(), { path: '/nj/Desktop/New.xlsx', name: 'New' }));
  history.replaceState(null, '', `#/edit/${encodeURIComponent(path)}`);
  await import('../src/main.js');
  await vi.waitFor(() => expect(mocks.editor).toHaveBeenCalledOnce());
  expect(location.hash).toBe(`#/edit/${encodeURIComponent('/nj/Desktop/New.xlsx')}`);
  expect(mocks.forgetRecent).toHaveBeenCalledWith(path);
  expect(mocks.toast).not.toHaveBeenCalled();
});
