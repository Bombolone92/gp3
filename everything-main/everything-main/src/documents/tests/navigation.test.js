// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { stubEditorBrowser } from './helpers/editor-browser.js';
// Booting the whole app shell can exceed the default timeout on a loaded machine.
vi.setConfig({ testTimeout: 60000 });

// Exercise the actual router, document model, and editor shell without loading the canvas.
vi.mock('../src/lib/engine.js', () => ({ loadEngine: () => new Promise(() => {}) }));

it('keeps the editor and its unsaved content when saving before navigation fails', async () => {
  stubEditorBrowser();
  vi.stubGlobal('puter', {
    auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test' }) },
    fs: { readdir: async () => [], mkdir: async () => {}, stat: async () => null, write: vi.fn() },
  });
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '#/new');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('../src/main.js');
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('editor'));
  const view = window.__docs.current.view;
  const doc = view.doc;
  const destroy = vi.spyOn(view, 'destroy');
  doc.attach(async () => new Blob(['unsaved work']));
  doc.changed();
  puter.fs.write.mockRejectedValueOnce(new Error('offline'));

  location.hash = '#/home';
  await vi.waitFor(() => expect(doc.status).toBe('error'));
  expect(window.__docs.current?.view).toBe(view);
  expect(destroy).not.toHaveBeenCalled();
  expect(doc.dirty).toBe(true);
  expect(document.getElementById('app').contains(view.el)).toBe(true);
  expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Leave without saving?');
  document.querySelector('.modal-panel .btn-ghost').click();
  // Finish the cancelled navigation before issuing another one.
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Retrying after the connection recovers saves and navigates normally.
  puter.fs.write.mockResolvedValue({});
  location.hash = '#/home';
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('home'));
  expect(doc.dirty).toBe(false);
  expect(destroy).toHaveBeenCalledTimes(1);
  window.__docs.current.view.destroy();
  errors.mockRestore();
  vi.unstubAllGlobals();
});
