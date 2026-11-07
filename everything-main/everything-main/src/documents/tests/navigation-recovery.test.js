// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { stubEditorBrowser } from './helpers/editor-browser.js';
// Booting the whole app shell can exceed the default timeout on a loaded machine.
vi.setConfig({ testTimeout: 60000 });

vi.mock('../src/lib/engine.js', () => ({ loadEngine: async () => { throw new Error('engine unavailable'); } }));

it('lets the user explicitly discard an imported copy when its engine cannot load', async () => {
  stubEditorBrowser();
  vi.stubGlobal('puter', {
    auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test' }) },
    fs: { readdir: async () => [] },
  });
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '#/new');
  await import('../src/main.js');
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('editor'));
  const input = window.__docs.current.view.el.querySelector('input[aria-label="Open DOCX file"]');
  Object.defineProperty(input, 'files', { value: [new File(['document'], 'Import.docx')] });
  input.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(window.__docs.current?.view.doc?.name).toBe('Import'));
  const view = window.__docs.current.view;
  await vi.waitFor(() => expect(view.el.querySelector('.editor-error')).not.toBeNull());

  view.el.querySelector('[aria-label="All Documents"]').click();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Leave without saving?'));
  expect(window.__docs.current.view === view).toBe(true);
  document.querySelector('.modal-panel .btn-danger').click();
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('home'));
  expect(location.hash).toBe('#/home');
  window.__docs.current.view.destroy();
  errors.mockRestore();
  vi.unstubAllGlobals();
});
