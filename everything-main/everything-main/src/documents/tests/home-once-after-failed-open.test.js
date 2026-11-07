// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from 'vitest';

vi.mock('../src/lib/engine.js', () => ({ loadEngine: async () => { throw new Error('engine unavailable'); } }));

let errors, readdir;
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  readdir = vi.fn(async () => []);
  vi.stubGlobal('puter', {
    auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test' }) },
    fs: { readdir, read: async () => { throw Object.assign(new Error('gone'), { code: 'subject_does_not_exist' }); } },
  });
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { window.__docs?.current?.view.destroy(); errors.mockRestore(); vi.unstubAllGlobals(); });

it('shows the document list once, with the reason, when the file to open no longer exists', async () => {
  history.replaceState(null, '', '#/edit/Documents%2FMissing.docx');
  await import('../src/main.js');
  await vi.waitFor(() => expect(window.__docs.current?.kind).toBe('home'));
  const home = window.__docs.current.view;
  await new Promise((resolve) => setTimeout(resolve, 60));
  // The same list is still up: it was not torn down and rebuilt by a second routing.
  expect(window.__docs.current.view).toBe(home);
  expect(readdir).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.toast')?.textContent).toContain('That file no longer exists');
  // The keyboard starts at the list's heading rather than staying on the page body.
  expect(document.activeElement.tagName).toBe('H1');
  expect(home.el.contains(document.activeElement)).toBe(true);
});
