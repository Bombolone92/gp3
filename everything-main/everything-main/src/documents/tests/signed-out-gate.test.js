// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';

vi.mock('../src/views/editor.js', () => ({
  editorView: vi.fn(({ doc }) => ({
    el: document.createElement('div'), doc,
    flush: () => doc.flush(), destroy: () => doc.destroy(),
  })),
}));

it('asks for the sign-in before reading a cloud document from the URL, then opens it', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  const read = vi.fn(async () => new Blob(['A']));
  const sdk = {
    env: 'web',
    _signedIn: false,
    auth: {
      isSignedIn: () => sdk._signedIn,
      signIn: vi.fn(async () => { sdk._signedIn = true; }),
      getUser: async () => (sdk._signedIn ? { username: 'nariman' } : null),
    },
    fs: { readdir: vi.fn(async () => []), read, mkdir: async () => {}, stat: async () => null, write: async () => ({}) },
  };
  vi.stubGlobal('puter', sdk);
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '#/edit/Documents%2FA.docx');
  await import('../src/main.js');

  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('gate'));
  const gate = document.getElementById('app');
  expect(gate.textContent).toContain('Sign in to open this document');
  // Nothing was fetched: without a session the read itself would pop the dialog.
  expect(read).not.toHaveBeenCalled();
  expect(location.hash).toBe('#/edit/Documents%2FA.docx');

  // "New document" leaves the file alone and starts writing.
  [...gate.querySelectorAll('button')].find((b) => b.textContent === 'New document').click();
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('editor'));
  expect(window.__docs.current.view.doc.path).toBeNull();
  expect(read).not.toHaveBeenCalled();

  // Back at the document's URL, signing in opens it.
  location.hash = '#/edit/Documents%2FA.docx';
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('gate'));
  [...document.getElementById('app').querySelectorAll('button')].find((b) => b.textContent === 'Sign in to Puter').click();
  await vi.waitFor(() => expect(sdk.auth.signIn).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(window.__docs.current?.view.doc?.path).toBe('Documents/A.docx'));
  expect(read).toHaveBeenCalledWith('Documents/A.docx');

  window.__docs.current.view.destroy();
  vi.unstubAllGlobals();
});
