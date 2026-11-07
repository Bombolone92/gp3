// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { stubEditorBrowser } from './helpers/editor-browser.js';
// Booting the whole app shell can exceed the default timeout on a loaded machine.
vi.setConfig({ testTimeout: 60000 });

vi.mock('../src/lib/engine.js', () => ({ loadEngine: async () => { throw new Error('engine unavailable'); } }));

let errors;
beforeEach(() => {
  stubEditorBrowser();
  vi.stubGlobal('puter', {
    auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test' }) },
    fs: { readdir: async () => [] },
  });
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { window.__docs?.current?.view.destroy(); errors.mockRestore(); vi.unstubAllGlobals(); });

it('opens a file imported from the untouched first screen, which the app reaches without a hash', async () => {
  // The app's bare URL routes to a new document without ever writing "#/new" into it.
  history.replaceState(null, '', location.pathname);
  expect(location.hash).toBe('');
  await import('../src/main.js');
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('editor'));
  const before = window.__docs.current.view;
  expect(before.doc.name).toBe('Untitled document');
  const input = before.el.querySelector('input[aria-label="Open DOCX file"]');
  Object.defineProperty(input, 'files', { value: [new File(['document'], 'Import.docx')], configurable: true });
  input.dispatchEvent(new Event('change'));
  // The clean document leaves without a question and the import takes its place, instead of another blank document.
  await vi.waitFor(() => expect(window.__docs.current?.view.doc.name).toBe('Import'));
  expect(location.hash).toBe('#/new');
});
