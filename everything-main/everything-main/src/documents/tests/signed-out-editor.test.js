// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { stubEditorBrowser } from './helpers/editor-browser.js';
import { AUTOSAVE_MS, RETRY_MS } from '../src/lib/doc.js';
// Booting the whole app shell can exceed the default timeout on a loaded machine.
vi.setConfig({ testTimeout: 60000 });

// The router, session, document model, and editor shell, without the canvas.
vi.mock('../src/lib/engine.js', () => ({ loadEngine: () => new Promise(() => {}) }));

it('opens into a new document without a session, and saves once the status pill signs the user in', async () => {
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
  history.replaceState(null, '', '#/');
  await import('../src/main.js');

  // No intro, no sign-in screen: the editor, with a blank document.
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('editor'));
  const view = window.__docs.current.view;
  const doc = view.doc;
  expect(doc.path).toBeNull();
  expect(document.querySelector('.auth-view')).toBeNull();
  const pill = view.el.querySelector('.save-status');
  expect(pill.classList.contains('signed-out')).toBe(true);
  expect(pill.textContent).toContain('Sign in to save');
  expect(pill.disabled).toBe(false);
  const account = view.el.querySelector('.user-btn');
  expect(account.title).toBe('Not signed in');
  expect(account.querySelector('svg')).not.toBeNull();

  // Edits stay in the tab: no autosave can reach the cloud without a session.
  vi.useFakeTimers();
  const exporter = vi.fn(async () => new Blob(['work']));
  doc.attach(exporter);
  doc.changed();
  await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + RETRY_MS);
  expect(exporter).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(sdk.auth.signIn).not.toHaveBeenCalled();
  expect(doc.dirty).toBe(true);
  expect(pill.textContent).toContain('Sign in to save');

  // The pill opens Puter's sign-in; the pending edit is written right after it.
  pill.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(sdk.auth.signIn).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(write.mock.calls.map(([path]) => path).filter((path) => !path.includes('/.versions/'))).toEqual(['Documents/Untitled document.docx']));
  await vi.waitFor(() => expect(doc.dirty).toBe(false));
  expect(doc.path).toBe('Documents/Untitled document.docx');
  expect(pill.classList.contains('signed-out')).toBe(false);
  expect(pill.textContent).toContain('Saved');
  expect(account.title).toBe('nariman');
  expect(account.textContent).toBe('n');

  // From here on autosave runs as usual.
  doc.changed();
  await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
  await vi.waitFor(() => expect(write.mock.calls.filter(([path]) => path === 'Documents/Untitled document.docx').length).toBe(2));

  vi.useRealTimers();
  window.__docs.current.view.destroy();
  vi.unstubAllGlobals();
});
