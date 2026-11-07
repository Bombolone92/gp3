// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';

// The whole app boots; only the canvas is left out.
vi.mock('../src/views/editor.js', () => ({
  editorView: vi.fn(({ doc }) => ({
    el: document.createElement('div'), doc,
    flush: () => doc.flush(), destroy: vi.fn(() => doc.destroy()),
  })),
}));

const writes = [];

/** A file drag over the app, ending in a drop unless `stop` holds it at the dragover. */
function dragFiles(files, { stop = false, handled = false } = {}) {
  const send = (type) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files, dropEffect: 'none' } });
    // A screen that makes something of the drop itself takes it before the app does.
    if (handled) document.body.addEventListener(type, (e) => e.preventDefault(), { once: true });
    document.body.dispatchEvent(event);
    return event;
  };
  const over = send('dragover');
  return stop ? over : send('drop');
}

it('opens files dropped anywhere the screen underneath does not take them itself', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('puter', {
    auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test' }) },
    fs: {
      readdir: async () => [], read: async () => new Blob(['document']), mkdir: async () => {},
      stat: async () => null, write: async (path) => { writes.push(path); return { path }; },
    },
  });
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '#/new');
  await import('../src/main.js');
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('editor'));
  const blank = window.__docs.current.view;

  // The drag is accepted so the browser cannot leave the app for the file.
  const over = dragFiles([new File(['word bytes'], 'Report.docx')], { stop: true });
  expect(over.defaultPrevented).toBe(true);
  expect(over.dataTransfer.dropEffect).toBe('copy');
  expect(document.querySelector('.drop-hint')).not.toBeNull();

  const open = vi.spyOn(Doc, 'fromImportFile');
  dragFiles([new File(['word bytes'], 'Report.docx')]);
  await vi.waitFor(() => expect(window.__docs.current.view.doc.name).toBe('Report'));
  expect(open).toHaveBeenCalledOnce();
  expect(blank.destroy).toHaveBeenCalledOnce();
  // An imported document has no file yet; the URL says so until it is saved.
  expect(location.hash).toBe('#/new');
  expect(document.querySelector('.drop-hint')).toBeNull();

  // A drop the screen underneath answered is left alone.
  const opened = window.__docs.current.view;
  const handled = dragFiles([new File(['word bytes'], 'Other.docx')], { handled: true });
  expect(handled.defaultPrevented).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(open).toHaveBeenCalledOnce();
  expect(window.__docs.current.view).toBe(opened);

  // Several at once: they are written into the folder, behind the open document.
  dragFiles([new File(['word bytes'], 'First.docx'), new File(['word bytes'], 'Second.docx')]);
  await vi.waitFor(() => expect(writes).toEqual(['Documents/First.docx', 'Documents/Second.docx']));
  expect(window.__docs.current.view).toBe(opened);

  // Nothing reports the drag leaving the window, so the hint goes when the dragover repeats stop.
  vi.useFakeTimers();
  try {
    dragFiles([new File(['word bytes'], 'Report.docx')], { stop: true });
    expect(document.querySelector('.drop-hint')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(600);
    expect(document.querySelector('.drop-hint')).toBeNull();
  } finally { vi.useRealTimers(); }

  window.__docs.current.view.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
