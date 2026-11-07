// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
let view, files, listing;

beforeEach(async () => {
  localStorage.clear();
  files = new Map([['Documents/Report.docx', new Blob(['r'])], ['Documents/Notes.docx', new Blob(['n'])]]);
  listing = null; // when set, readdir waits for it
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('puter', { fs: {
    mkdir: async () => {},
    read: async (path) => files.get(path),
    write: vi.fn(async (path, blob) => { files.set(path, blob); return { path, name: path.split('/').pop() }; }),
    readdir: async (dir) => {
      if (listing) await listing;
      return [...files].filter(([path]) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(([path, blob]) => ({ path, name: path.split('/').pop(), size: blob.size }));
    },
    delete: vi.fn(async (path) => { files.delete(path); }),
  } });
  view = homeView({ openPath: vi.fn(), newDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el);
  await vi.waitFor(() => expect(view.el.querySelector('.file-row')).not.toBeNull());
});
afterEach(() => {
  view.destroy(); closeMenu(); closeAllModals(); document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function remove(path) {
  view.el.querySelector(`[data-path="${path}"] .file-menu-btn`).click();
  [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === 'Delete').click();
  // The dialog of an earlier deletion may still be closing: only an open one has the button to press.
  await vi.waitFor(() => expect(document.querySelector('.modal-root:not(.closing) .btn-danger')).not.toBeNull());
  document.querySelector('.modal-root:not(.closing) .btn-danger').click();
  await vi.waitFor(() => expect(view.el.querySelector(`[data-path="${path}"]`)).toBeNull());
}

it('does not take the focus from the search field when a remembered row lands late', async () => {
  let release;
  listing = new Promise((resolve) => { release = resolve; });
  view.el.querySelector('[data-path="Documents/Report.docx"] .file-menu-btn').click();
  [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('Duplicate')).click();
  await vi.waitFor(() => expect(puter.fs.write).toHaveBeenCalled());
  // Meanwhile the user is typing a search.
  const search = view.el.querySelector('.home-search');
  search.focus();
  release();
  await vi.waitFor(() => expect(view.el.querySelectorAll('.file-row').length).toBe(3));
  expect(document.activeElement).toBe(search);
});

it('moves the focus to the search field or the New document button when the last visible document is deleted', async () => {
  const search = view.el.querySelector('.home-search');
  search.value = 'rep'; search.dispatchEvent(new Event('input'));
  expect(view.el.querySelectorAll('.file-row')).toHaveLength(1);
  await remove('Documents/Report.docx');
  expect(document.activeElement).toBe(search);
  search.value = ''; search.dispatchEvent(new Event('input'));
  await vi.waitFor(() => expect(view.el.querySelectorAll('.file-row')).toHaveLength(1));
  await remove('Documents/Notes.docx');
  expect(view.el.querySelectorAll('.file-row')).toHaveLength(0);
  expect(document.activeElement).not.toBe(document.body);
  expect(document.activeElement.textContent).toContain('New document');
});
