// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';

vi.mock('../src/views/editor.js', () => ({
  editorView: vi.fn(({ doc }) => ({
    el: document.createElement('div'), doc,
    flush: () => doc.flush(), destroy: () => doc.destroy(),
  })),
}));

it('honors the latest navigation while another document is still loading', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  let finishFirst;
  const first = new Promise((resolve) => { finishFirst = resolve; });
  const read = vi.fn((path) => path === 'Documents/A.docx' ? first : Promise.resolve(new Blob(['B'])));
  vi.stubGlobal('puter', {
    auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test' }) },
    fs: { readdir: async () => [], read, mkdir: async () => {}, stat: async () => null, write: async () => ({}) },
  });
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '#/home');
  await import('../src/main.js');
  const { editorView } = await import('../src/views/editor.js');
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('home'));

  location.hash = '#/edit/Documents%2FA.docx';
  await vi.waitFor(() => expect(read).toHaveBeenCalledWith('Documents/A.docx'));
  const changed = new Promise((resolve) => window.addEventListener('hashchange', resolve, { once: true }));
  location.hash = '#/edit/Documents%2FB.docx';
  await changed;
  finishFirst(new Blob(['A']));

  await vi.waitFor(() => expect(window.__docs.current?.view.doc?.path).toBe('Documents/B.docx'));
  expect(editorView.mock.calls.map(([args]) => args.doc.path)).toEqual(['Documents/B.docx']);
  expect(location.hash).toBe('#/edit/Documents%2FB.docx');

  // Allocating a file path during a first save must not replace the destination URL.
  location.hash = '#/new';
  await vi.waitFor(() => expect(window.__docs.current?.view.doc?.path).toBeNull());
  const doc = window.__docs.current.view.doc;
  doc.attach(async () => new Blob(['new work']));
  doc.changed();
  location.hash = '#/home';
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('home'));
  expect(doc.dirty).toBe(false);
  expect(location.hash).toBe('#/home');
  window.__docs.current.view.destroy();
  vi.unstubAllGlobals();
});
