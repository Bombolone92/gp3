// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// A shared spreadsheet's #/file/<uid> link said the file did not exist, or had not been shared, whenever
// the look-up failed at all: offline, or a server that did not answer, said the same as a refusal.
const mocks = vi.hoisted(() => ({ fromPath: vi.fn(), editor: vi.fn(), home: vi.fn(), toast: vi.fn(), statByUid: vi.fn() }));
vi.mock('../src/lib/doc.js', () => ({ Doc: { fromPath: mocks.fromPath, fromBrowserFile: vi.fn(), fromDraft: vi.fn() } }));
vi.mock('../src/views/editor.js', () => ({ editorView: mocks.editor }));
vi.mock('../src/views/home.js', () => ({ homeView: mocks.home }));
vi.mock('../src/ui/toast.js', () => ({ toast: mocks.toast }));
vi.mock('../src/lib/session.js', () => ({ session: { init: async () => {}, signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ rememberRecent: vi.fn(), forgetRecent: vi.fn() }));
vi.mock('../src/lib/puter.js', () => ({
  hasSDK: () => true, isSignedIn: async () => true, onAuth() {}, onLaunchedWithItems() {}, onWindowClose() {}, setWindowTitle() {}, isNotFound: () => false, samePath: (a, b) => a === b,
  statByUid: mocks.statByUid, inTrash: () => false,
}));

let handlers;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
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

it('opens the file at the address the drive gives it', async () => {
  const doc = Object.assign(new EventTarget(), { path: '/ana/u1/Team.xlsx', name: 'Team' });
  mocks.statByUid.mockResolvedValue({ path: '/ana/u1/Team.xlsx', is_dir: false });
  mocks.fromPath.mockResolvedValue(doc);
  history.replaceState(null, '', '#/file/u1');
  await import('../src/main.js');
  await vi.waitFor(() => expect(mocks.editor).toHaveBeenCalledOnce());
  expect(mocks.fromPath).toHaveBeenCalledWith('/ana/u1/Team.xlsx');
});

it.each([
  ['a file that is not there', () => mocks.statByUid.mockResolvedValue(null)],
  ['a refusal', () => mocks.statByUid.mockRejectedValue({ code: 'access_denied', message: 'Access denied' })],
])('says the spreadsheet is not there, or not shared, for %s', async (_, setup) => {
  setup();
  history.replaceState(null, '', '#/file/u1');
  await import('../src/main.js');
  await vi.waitFor(() => expect(mocks.home).toHaveBeenCalledOnce());
  expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('has not been shared with you'), expect.anything());
});

it('does not say so when the look-up itself failed', async () => {
  mocks.statByUid.mockRejectedValue(new Error('Failed to fetch'));
  history.replaceState(null, '', '#/file/u1');
  await import('../src/main.js');
  await vi.waitFor(() => expect(mocks.home).toHaveBeenCalledOnce());
  expect(mocks.toast).toHaveBeenCalledWith('Could not open the file', expect.anything());
  expect(mocks.toast).not.toHaveBeenCalledWith(expect.stringContaining('shared with you'), expect.anything());
});
