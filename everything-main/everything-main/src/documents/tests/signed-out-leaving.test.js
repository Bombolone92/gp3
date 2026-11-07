// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { stubEditorBrowser } from './helpers/editor-browser.js';
// Booting the whole app shell can exceed the default timeout on a loaded machine.
vi.setConfig({ testTimeout: 60000 });

vi.mock('../src/lib/engine.js', () => ({ loadEngine: () => new Promise(() => {}) }));

const buttons = () => [...document.querySelectorAll('.modal-panel .row button')];
const dialogTitle = () => document.querySelector('[role="dialog"]')?.getAttribute('aria-label');

it('offers keep editing, leave, or sign in and save when leaving unsaved work without a session', async () => {
  stubEditorBrowser();
  const write = vi.fn(async (path) => ({ path, name: path.split('/').pop() }));
  const sdk = {
    env: 'web',
    _signedIn: false,
    auth: {
      isSignedIn: () => sdk._signedIn,
      signIn: vi.fn(async () => { sdk._signedIn = true; }),
      getUser: async () => (sdk._signedIn ? { username: 'nariman' } : null),
    },
    fs: { readdir: vi.fn(async () => []), mkdir: async () => {}, stat: async () => null, write },
  };
  vi.stubGlobal('puter', sdk);
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '#/new');
  await import('../src/main.js');
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('editor'));
  const view = window.__docs.current.view;
  const doc = view.doc;
  doc.attach(async () => new Blob(['unsaved work']));
  doc.changed();

  // Keep editing: the document, its edits, and its URL stay.
  view.el.querySelector('[aria-label="All Documents"]').click();
  await vi.waitFor(() => expect(dialogTitle()).toBe('Save before leaving?'));
  expect(buttons().map((b) => b.textContent)).toEqual(['Keep editing', 'Leave without saving', 'Sign in and save']);
  expect(document.querySelector('.toast')).toBeNull();
  buttons()[0].click();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect(window.__docs.current?.view).toBe(view);
  expect(doc.dirty).toBe(true);
  expect(location.hash).toBe('#/new');
  expect(sdk.auth.signIn).not.toHaveBeenCalled();

  // Sign in and save: the edit is written, then the list opens.
  location.hash = '#/home';
  await vi.waitFor(() => expect(dialogTitle()).toBe('Save before leaving?'));
  buttons()[2].click();
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('home'));
  expect(sdk.auth.signIn).toHaveBeenCalledTimes(1);
  expect(write.mock.calls.map(([path]) => path).filter((path) => !path.includes('/.versions/'))).toEqual(['Documents/Untitled document.docx']);
  expect(doc.dirty).toBe(false);
  expect(location.hash).toBe('#/home');
  // The home screen lists the account, not the sign-in.
  expect(document.querySelector('.user-btn').title).toBe('nariman');

  window.__docs.current.view.destroy();
  vi.unstubAllGlobals();
});
