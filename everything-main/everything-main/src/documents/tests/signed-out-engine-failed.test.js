// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { stubEditorBrowser } from './helpers/editor-browser.js';
// Booting the whole app shell can exceed the default timeout on a loaded machine.
vi.setConfig({ testTimeout: 60000 });

vi.mock('../src/lib/engine.js', () => ({ loadEngine: async () => { throw new Error('engine unavailable'); } }));

it('does not offer to sign in and save a document that never opened', async () => {
  stubEditorBrowser();
  vi.stubGlobal('puter', {
    auth: { isSignedIn: () => false, getUser: async () => null, signIn: async () => true },
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
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  const dialog = document.querySelector('[role="dialog"]');
  // Signing in could not save this document: only leaving or staying is offered, and no "still opening" toast.
  expect(dialog.getAttribute('aria-label')).toBe('Leave without saving?');
  expect([...dialog.querySelectorAll('button')].map((button) => button.textContent)).not.toContain('Sign in and save');
  expect([...document.querySelectorAll('.toast')].map((toast) => toast.textContent).join(' ')).not.toContain('still opening');
  document.querySelector('.modal-panel .btn-danger').click();
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('home'));
  // The modal exit animation still uses this document; finish it before jsdom teardown.
  await vi.waitFor(() => expect(document.querySelector('.modal-root')).toBeNull());
  window.__docs.current.view.destroy();
  errors.mockRestore();
  vi.unstubAllGlobals();
});
