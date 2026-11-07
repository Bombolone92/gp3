// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';

vi.mock('../src/views/editor.js', () => ({ editorView: vi.fn(({ doc }) => ({
  el: document.createElement('div'), doc, flush: async () => true, destroy: vi.fn(() => doc.destroy()),
})) }));

it('does not let a delayed version reload overwrite a newer editor, even if reloading fails', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('puter', {
    auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test' }) },
    fs: { read: async () => new Blob(['document']) },
  });
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '#/edit/Documents%2FA.docx');
  await import('../src/main.js');
  const { editorView } = await import('../src/views/editor.js');
  await vi.waitFor(() => expect(window.__docs.current?.view.doc.path).toBe('Documents/A.docx'));
  const reopen = editorView.mock.lastCall[0].reopen;
  const read = vi.spyOn(Doc, 'fromPath');
  try {
    for (const fail of [false, true]) {
      let finish;
      read.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = fail ? reject : resolve; }));
      const pending = reopen('Documents/A.docx');
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      const path = fail ? 'Documents/C.docx' : 'Documents/B.docx';
      location.hash = `#/edit/${encodeURIComponent(path)}`;
      await vi.waitFor(() => expect(window.__docs.current?.view.doc.path).toBe(path));
      const newest = window.__docs.current.view;
      newest.doc.changed();
      finish(fail ? new Error('Reload failed') : new Doc({ path: 'Documents/A.docx' }));
      await pending;
      expect(window.__docs.current.view).toBe(newest);
      expect(newest.doc.dirty).toBe(true);
      expect(newest.destroy).not.toHaveBeenCalled();
      expect(location.hash).toBe(`#/edit/${encodeURIComponent(path)}`);
    }
  } finally {
    window.__docs.current?.view.destroy(); read.mockRestore(); vi.unstubAllGlobals();
  }
});
