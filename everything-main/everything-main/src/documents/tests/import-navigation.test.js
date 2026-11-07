// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';

vi.mock('../src/views/editor.js', () => ({
  editorView: vi.fn(({ doc }) => ({
    el: document.createElement('div'), doc,
    flush: () => doc.flush(), destroy: vi.fn(() => doc.destroy()),
  })),
}));

it('does not let a delayed import replace a newer navigation or import', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('puter', {
    auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test' }) },
    fs: { readdir: async () => [], read: async () => new Blob(['document']), mkdir: async () => {}, stat: async () => null, write: async () => ({}) },
  });
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '#/new');
  await import('../src/main.js');
  const { editorView } = await import('../src/views/editor.js');
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('editor'));
  const importFile = editorView.mock.lastCall[0].importFile;
  const pending = new Map();
  const convert = vi.spyOn(Doc, 'fromImportFile').mockImplementation((file) => new Promise((resolve) => pending.set(file.name, resolve)));
  try {
    const oldImport = importFile(new File([], 'slow.hwp'));
    location.hash = '#/edit/Documents%2FB.docx';
    await vi.waitFor(() => expect(window.__docs.current?.view.doc.path).toBe('Documents/B.docx'));
    const newerView = window.__docs.current.view;
    pending.get('slow.hwp')(new Doc({ name: 'Slow' }));
    await oldImport;
    expect(window.__docs.current.view).toBe(newerView);
    expect(newerView.destroy).not.toHaveBeenCalled();

    const first = importFile(new File([], 'first.hwp'));
    const second = importFile(new File([], 'second.hwp'));
    pending.get('second.hwp')(new Doc({ name: 'Second' }));
    await second;
    const latestView = window.__docs.current.view;
    pending.get('first.hwp')(new Doc({ name: 'First' }));
    await first;
    expect(window.__docs.current.view).toBe(latestView);
    expect(latestView.doc.name).toBe('Second');
    expect(latestView.destroy).not.toHaveBeenCalled();

    // A newer import can arrive while the previous import is saving the editor.
    let finishSave;
    latestView.doc.attach(() => new Promise((resolve) => { finishSave = resolve; }));
    latestView.doc.changed();
    const third = importFile(new File([], 'third.hwp'));
    pending.get('third.hwp')(new Doc({ name: 'Third' }));
    await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'));
    const fourth = importFile(new File([], 'fourth.hwp'));
    pending.get('fourth.hwp')(new Doc({ name: 'Fourth' }));
    finishSave(new Blob(['saved work']));
    await Promise.all([third, fourth]);
    expect(window.__docs.current.view.doc.name).toBe('Fourth');
    expect(latestView.doc.dirty).toBe(false);
    expect(latestView.destroy).toHaveBeenCalledTimes(1);
    expect(editorView.mock.calls.some(([args]) => args.doc.name === 'Third')).toBe(false);
  } finally {
    window.__docs.current?.view.destroy();
    convert.mockRestore();
    vi.unstubAllGlobals();
  }
});
