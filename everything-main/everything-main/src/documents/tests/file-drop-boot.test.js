// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';

vi.mock('../src/views/editor.js', () => ({
  editorView: vi.fn(({ doc }) => ({
    el: document.createElement('div'), doc,
    flush: () => doc.flush(), destroy: vi.fn(() => doc.destroy()),
  })),
}));

it('keeps a file dropped on the loading screen and opens it once the app is up', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  let signIn;
  vi.stubGlobal('puter', {
    auth: { isSignedIn: () => new Promise((resolve) => { signIn = resolve; }), getUser: async () => ({ username: 'test' }) },
    fs: { readdir: async () => [], read: async () => new Blob(['document']), mkdir: async () => {}, stat: async () => null, write: async (path) => ({ path }) },
  });
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '#/new');
  await import('../src/main.js');
  await vi.waitFor(() => expect(signIn).toBeTypeOf('function'));
  expect(window.__docs.current).toBeNull();

  const drop = new MouseEvent('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [new File(['word bytes'], 'Report.docx')] } });
  document.body.dispatchEvent(drop);
  // The browser must not leave the app for the file, boot or no boot.
  expect(drop.defaultPrevented).toBe(true);

  signIn(true);
  await vi.waitFor(() => expect(window.__docs.current?.view.doc.name).toBe('Report'));
  window.__docs.current.view.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
