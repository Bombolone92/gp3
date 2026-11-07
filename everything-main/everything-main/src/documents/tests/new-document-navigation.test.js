// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { versioning } from '../src/lib/doc.js';

vi.mock('../src/views/editor.js', () => ({ editorView: vi.fn(({ doc }) => ({
  el: document.createElement('div'), doc,
  flush: async () => { try { return await doc.flush(); } catch { return false; } },
  destroy: vi.fn(() => doc.destroy()),
})) }));

it('saves an unsaved document before creating another document on the same route', async () => {
  versioning.enabled = false;
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  const write = vi.fn(async () => ({}));
  vi.stubGlobal('puter', {
    auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test' }) },
    fs: { readdir: async () => [], mkdir: async () => {}, stat: async () => null, write },
  });
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '#/new');
  await import('../src/main.js');
  const { editorView } = await import('../src/views/editor.js');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('editor'));
    const first = window.__docs.current.view;
    const bytes = new Blob(['Work awaiting autosave']);
    first.doc.attach(async () => bytes); first.doc.changed();
    write.mockRejectedValueOnce(new Error('Offline'));
    editorView.mock.lastCall[0].newDoc();
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Leave without saving?"]')).not.toBeNull());
    document.querySelector('.modal-panel .btn-ghost').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.__docs.current.view).toBe(first);
    expect(first.doc.dirty).toBe(true);
    expect(first.destroy).not.toHaveBeenCalled();

    editorView.mock.lastCall[0].newDoc();
    await vi.waitFor(() => expect(window.__docs.current.view).not.toBe(first));
    expect(write).toHaveBeenCalledWith('Documents/Untitled document.docx', bytes, expect.anything());
    expect(first.doc.dirty).toBe(false);
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(window.__docs.current.view.doc.path).toBeNull();
    expect(window.__docs.current.view.doc.dirty).toBe(false);
    expect(location.hash).toBe('#/new');

    // Choosing the same template again is also an explicit new-document action.
    editorView.mock.lastCall[0].newFromTemplate('letter');
    await vi.waitFor(() => expect(window.__docs.current.view.doc.template).toBe('letter'));
    const letter = window.__docs.current.view;
    letter.doc.attach(async () => bytes);
    editorView.mock.lastCall[0].newFromTemplate('letter');
    await vi.waitFor(() => expect(window.__docs.current.view).not.toBe(letter));
    expect(letter.doc.dirty).toBe(false);
    expect(window.__docs.current.view.doc.template).toBe('letter');
    expect(window.__docs.current.view.doc.path).toBeNull();

    // Laying a template out clears the template from the document, so a blank
    // document asked for from one is not the document already open.
    window.__docs.current.view.doc.attach(async () => bytes);
    editorView.mock.lastCall[0].newFromTemplate('essay');
    await vi.waitFor(() => expect(window.__docs.current.view.doc.template).toBe('essay'));
    const essay = window.__docs.current.view;
    essay.doc.template = null;
    essay.doc.attach(async () => bytes);
    editorView.mock.lastCall[0].newDoc();
    await vi.waitFor(() => expect(window.__docs.current.view).not.toBe(essay));
    expect(window.__docs.current.view.doc.template).toBeNull();
    expect(location.hash).toBe('#/new');
  } finally {
    window.__docs.current?.view.destroy(); versioning.enabled = true; errors.mockRestore(); vi.unstubAllGlobals();
  }
});
