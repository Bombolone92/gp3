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

const dialogs = () => [...document.querySelectorAll('.modal-root:not(.closing)')];

it('asks once when a second import and a navigation both want to leave an unsaved document', async () => {
  history.replaceState(null, '', '#/new');
  await import('../src/main.js');
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('editor'));
  const first = window.__docs.current.view.el.querySelector('input[aria-label="Open DOCX file"]');
  Object.defineProperty(first, 'files', { value: [new File(['document'], 'Import.docx')], configurable: true });
  first.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(window.__docs.current?.view.doc?.name).toBe('Import'));
  const view = window.__docs.current.view;
  await vi.waitFor(() => expect(view.el.querySelector('.editor-error')).not.toBeNull());
  // A second file is imported over the unsaved copy: the leave question comes up.
  const second = view.el.querySelector('input[aria-label="Open DOCX file"]');
  Object.defineProperty(second, 'files', { value: [new File(['document'], 'Second.docx')], configurable: true });
  second.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Leave without saving?'));
  expect(dialogs()).toHaveLength(1);
  // The user presses Back while it is up: no second question on top of the first.
  location.hash = '#/home';
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(dialogs()).toHaveLength(1);
  // Leaving goes where the user went last.
  dialogs()[0].querySelector('.modal-panel .btn-danger').click();
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('home'));
  expect(location.hash).toBe('#/home');
  expect(dialogs()).toHaveLength(0);
});
