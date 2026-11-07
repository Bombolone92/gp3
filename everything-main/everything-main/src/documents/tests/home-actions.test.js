// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';
import { listVersions, versionName } from '../src/lib/versions.js';
import { rememberGoal, recallGoal } from '../src/lib/goal.js';
import { rememberPosition, recallPosition } from '../src/lib/position.js';
import { toggleStar, isStarred } from '../src/lib/starred.js';
import { toast } from '../src/ui/toast.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

describe('home document actions', () => {
  let files, view;
  const original = 'Documents/Report.docx';
  const renamed = 'Documents/Final.docx';
  const snapshot = versionName(Date.UTC(2026, 8, 1));

  beforeEach(() => {
    localStorage.clear();
    files = new Map([[original, new Blob(['current'])], [`Documents/.versions/Report/${snapshot}`, new Blob(['earlier'])]]);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.stubGlobal('puter', { fs: {
      mkdir: async () => {},
      read: async (path) => files.get(path),
      write: vi.fn(async (path, blob, { overwrite, dedupeName }) => {
        let target = path, n = 1;
        while (files.has(target) && dedupeName) target = path.replace(/(\.[^/.]+)$/, ` (${n++})$1`);
        if (files.has(target) && !overwrite) throw new Error('Already exists');
        files.set(target, blob);
        return { path: target, name: target.split('/').pop() };
      }),
      readdir: async (dir) => [...files].filter(([path]) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/'))
        .map(([path, blob]) => ({ path, name: path.split('/').pop(), size: blob.size })),
      rename: vi.fn(async (path, name) => {
        const target = `${path.slice(0, path.lastIndexOf('/') + 1)}${name}`;
        if (target !== path && files.has(target)) throw new Error('A file with that name already exists');
        for (const [key, value] of [...files]) {
          if (key === path || key.startsWith(`${path}/`)) { files.set(target + key.slice(path.length), value); files.delete(key); }
        }
      }),
    } });
  });
  afterEach(() => {
    view?.destroy(); closeMenu(); closeAllModals(); document.body.replaceChildren();
    vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  async function setup() {
    view = homeView({ openPath: vi.fn(), newDoc: vi.fn(), importFile: vi.fn() });
    document.body.append(view.el);
    await vi.waitFor(() => expect(view.el.querySelector('.file-row')).not.toBeNull());
  }

  function submitRename() {
    view.el.querySelector(`[data-path="${original}"] .file-menu-btn`).click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('Rename')).click();
    const input = document.querySelector('.modal-panel input');
    input.value = 'Final';
    input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return input.closest('form');
  }

  it.each(['success', 'failure', 'cancel'])('clears only a successfully deleted document\'s local state (%s)', async (result) => {
    rememberGoal(original, 1200); rememberPosition(original, { blockId: 'old-paragraph', offset: 12 }); toggleStar(original);
    rememberGoal(renamed, 700); rememberPosition(renamed, { blockId: 'other-paragraph', offset: 3 });
    puter.fs.delete = vi.fn(async (path) => {
      if (result === 'failure') throw new Error('Deletion failed');
      files.delete(path);
    });
    await setup();
    view.el.querySelector('.file-menu-btn').click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === 'Delete').click();
    if (result === 'cancel') closeAllModals();
    else document.querySelector('.modal-panel .btn-danger').click();
    if (result === 'success') {
      await vi.waitFor(() => expect(files.has(original)).toBe(false));
      expect([recallGoal(original), recallPosition(original)]).toEqual([null, null]);
      expect(isStarred(original)).toBe(false);
    } else {
      if (result === 'failure') await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Deletion failed', { icon: 'alert' }));
      expect(files.has(original)).toBe(true);
      expect(recallGoal(original)).toBe(1200);
      expect(recallPosition(original)).toMatchObject({ blockId: 'old-paragraph', offset: 12 });
      expect(isStarred(original)).toBe(true);
    }
    expect(recallGoal(renamed)).toBe(700);
    expect(recallPosition(renamed)).toMatchObject({ blockId: 'other-paragraph', offset: 3 });
  });

  it('keeps version history, word goal, reading position, and star after a home rename', async () => {
    rememberGoal(original, 1200);
    rememberPosition(original, { blockId: 'paragraph-2', offset: 12 });
    toggleStar(original);
    await setup();
    submitRename();
    await vi.waitFor(() => expect(view.el.querySelector('.file-name').textContent).toBe('Final'));
    expect(files.has(original)).toBe(false);
    expect(files.has(renamed)).toBe(true);
    expect((await listVersions(renamed)).map((v) => v.name)).toEqual([snapshot]);
    expect(recallGoal(renamed)).toBe(1200);
    expect(recallPosition(renamed)).toMatchObject({ blockId: 'paragraph-2', offset: 12 });
    expect(isStarred(renamed)).toBe(true);
    expect(await listVersions(original)).toEqual([]);
    expect(recallGoal(original)).toBeNull();
    expect(recallPosition(original)).toBeNull();
  });

  it('closes the rename prompt quietly when the current name is confirmed', async () => {
    vi.mocked(toast).mockClear();
    await setup();
    view.el.querySelector(`[data-path="${original}"] .file-menu-btn`).click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('Rename')).click();
    const input = document.querySelector('.modal-panel input');
    expect(input.value).toBe('Report');
    input.closest('form').requestSubmit();
    await vi.waitFor(() => expect(document.querySelector('.modal-root:not(.closing)')).toBeNull());
    expect(puter.fs.rename).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalledWith('Renamed');
    expect(files.has(original)).toBe(true);
  });

  it('leaves the file and its metadata in place if renaming fails', async () => {
    rememberGoal(original, 1200);
    rememberPosition(original, { blockId: 'paragraph-2', offset: 12 });
    toggleStar(original);
    puter.fs.rename.mockRejectedValueOnce(new Error('Rename failed'));
    await setup();
    const form = submitRename();
    await vi.waitFor(() => expect(puter.fs.rename).toHaveBeenCalledOnce());
    expect(document.querySelector('.modal-root:not(.closing)')).not.toBeNull();
    await vi.waitFor(() => expect(form.querySelector('[role="alert"]').textContent).toBe('Rename failed'));
    expect(form.querySelector('input').value).toBe('Final');
    expect(files.has(original)).toBe(true);
    expect(files.has(renamed)).toBe(false);
    expect((await listVersions(original)).map((v) => v.name)).toEqual([snapshot]);
    expect(recallGoal(original)).toBe(1200);
    expect(recallPosition(original)).toMatchObject({ blockId: 'paragraph-2', offset: 12 });
    expect(isStarred(original)).toBe(true);
    form.requestSubmit();
    await vi.waitFor(() => expect(view.el.querySelector('.file-name').textContent).toBe('Final'));
    expect(files.has(renamed)).toBe(true);
    expect(recallGoal(renamed)).toBe(1200);
    expect(isStarred(renamed)).toBe(true);
  });

  it('keeps the entered name when another tab creates that file before rename', async () => {
    await setup();
    const other = new Blob(['Other document']);
    files.set(renamed, other);
    const form = submitRename();
    await vi.waitFor(() => expect(puter.fs.rename).toHaveBeenCalledOnce());
    expect(document.querySelector('.modal-root:not(.closing)')).not.toBeNull();
    expect(form.querySelector('input').value).toBe('Final');
    await vi.waitFor(() => expect(form.querySelector('[role="alert"]').textContent).toContain('already exists'));
    expect(files.get(renamed)).toBe(other);
    form.querySelector('input').value = 'Final revised'; form.requestSubmit();
    await vi.waitFor(() => expect(files.has('Documents/Final revised.docx')).toBe(true));
    expect(files.get(renamed)).toBe(other);
  });

  it('prevents duplicate rename submissions while the server is working', async () => {
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const rename = puter.fs.rename.getMockImplementation();
    puter.fs.rename.mockImplementationOnce(async (...args) => { await pending; return rename(...args); });
    await setup();
    const form = submitRename(); form.requestSubmit();
    await vi.waitFor(() => expect(puter.fs.rename).toHaveBeenCalledOnce());
    expect(form.getAttribute('aria-busy')).toBe('true');
    expect(form.querySelector('input').disabled).toBe(true);
    expect(form.querySelector('[type="submit"]').disabled).toBe(true);
    expect(document.querySelector('.modal-root:not(.closing)')).not.toBeNull();
    finish();
    await vi.waitFor(() => expect(view.el.querySelector('.file-name').textContent).toBe('Final'));
    expect(document.querySelector('.modal-root:not(.closing)')).toBeNull();
    expect(puter.fs.rename.mock.calls.filter(([path]) => path === original)).toHaveLength(1);
  });

  it.each(['cancel', 'leave'])('does not start renaming after an immediate %s', async (action) => {
    await setup();
    submitRename();
    if (action === 'cancel') closeAllModals();
    else { view.destroy(); view = null; }
    await Promise.resolve(); await Promise.resolve();
    expect(puter.fs.rename).not.toHaveBeenCalled();
    expect(files.has(original)).toBe(true);
  });

  it('finishes moving metadata and refreshing the list after a pending rename is cancelled', async () => {
    rememberGoal(original, 1200); toggleStar(original);
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const rename = puter.fs.rename.getMockImplementation();
    puter.fs.rename.mockImplementationOnce(async (...args) => { await pending; return rename(...args); });
    await setup(); submitRename();
    await vi.waitFor(() => expect(puter.fs.rename).toHaveBeenCalledOnce());
    closeAllModals(); toast.mockClear(); finish();
    await vi.waitFor(() => expect(view.el.querySelector('.file-name').textContent).toBe('Final'));
    expect(recallGoal(renamed)).toBe(1200);
    expect(isStarred(renamed)).toBe(true);
    expect((await listVersions(renamed)).map((v) => v.name)).toEqual([snapshot]);
    expect(toast).not.toHaveBeenCalled();
  });

  it.each(['duplicate another file', 'reopen the home screen'])('preserves a renamed star while history is moving and the user chooses to %s', async (action) => {
    files.set('Documents/Other.docx', new Blob(['other']));
    rememberGoal(original, 1200); rememberPosition(original, { blockId: 'paragraph-2', offset: 12 }); toggleStar(original);
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const rename = puter.fs.rename.getMockImplementation();
    puter.fs.rename.mockImplementation(async (path, name) => {
      if (path === 'Documents/.versions/Report') await pending;
      return rename(path, name);
    });
    await setup(); submitRename();
    await vi.waitFor(() => expect(puter.fs.rename).toHaveBeenCalledWith('Documents/.versions/Report', 'Final'));
    expect(files.has(renamed)).toBe(true);
    closeAllModals();
    if (action === 'duplicate another file') {
      view.el.querySelector('[data-path="Documents/Other.docx"] .file-menu-btn').click();
      [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === 'Duplicate').click();
      await vi.waitFor(() => expect(view.el.querySelector('[data-path="Documents/Other copy.docx"]')).not.toBeNull());
    } else {
      view.destroy(); view.el.remove(); await setup();
    }
    expect(view.el.querySelector(`[data-path="${renamed}"]`)).not.toBeNull();
    finish();
    await vi.waitFor(() => expect(files.has(`Documents/.versions/Final/${snapshot}`)).toBe(true));
    expect(isStarred(renamed)).toBe(true);
    expect(isStarred(original)).toBe(false);
    expect(recallGoal(renamed)).toBe(1200);
    expect(recallPosition(renamed)).toMatchObject({ blockId: 'paragraph-2', offset: 12 });
  });

  it('ignores a pre-rename listing after local state has moved to the accepted new path', async () => {
    files.set('Documents/Other.docx', new Blob(['other'])); toggleStar(original);
    let renameFile, moveHistory, finishListing;
    const filePending = new Promise((resolve) => { renameFile = resolve; });
    const historyPending = new Promise((resolve) => { moveHistory = resolve; });
    const listing = new Promise((resolve) => { finishListing = resolve; });
    const rename = puter.fs.rename.getMockImplementation();
    puter.fs.rename.mockImplementation(async (path, name) => {
      if (path === original) await filePending;
      if (path === 'Documents/.versions/Report') await historyPending;
      return rename(path, name);
    });
    await setup(); submitRename();
    await vi.waitFor(() => expect(puter.fs.rename).toHaveBeenCalledWith(original, 'Final.docx'));
    closeAllModals();
    const list = vi.spyOn(P, 'listFiles').mockReturnValueOnce(listing);
    view.el.querySelector('[data-path="Documents/Other.docx"] .file-menu-btn').click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === 'Duplicate').click();
    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
    renameFile();
    await vi.waitFor(() => expect(puter.fs.rename).toHaveBeenCalledWith('Documents/.versions/Report', 'Final'));
    finishListing(['Report.docx', 'Other.docx', 'Other copy.docx'].map((name) => ({ name, path: `Documents/${name}` })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isStarred(renamed)).toBe(true);
    expect(isStarred(original)).toBe(false);
    moveHistory();
    await vi.waitFor(() => expect(view.el.querySelector(`[data-path="${renamed}"]`)).not.toBeNull());
    expect(view.el.querySelector(`[data-path="${original}"]`)).toBeNull();
    expect(isStarred(renamed)).toBe(true);
  });

  it('downloads to this device inside the Puter desktop too, without Puter\'s Save dialog', async () => {
    puter.env = 'app';
    puter.ui = { showSaveFilePicker: vi.fn() };
    const download = vi.spyOn(P, 'downloadBlob').mockImplementation(() => {});
    await setup();
    view.el.querySelector('.file-menu-btn').click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === 'Download').click();
    await vi.waitFor(() => expect(download).toHaveBeenCalledWith(files.get(original), 'Report.docx'));
    expect(puter.ui.showSaveFilePicker).not.toHaveBeenCalled();
  });

  it('reports a download that could not be read instead of silently discarding the error', async () => {
    const download = vi.spyOn(P, 'downloadBlob').mockImplementation(() => {});
    await setup();
    puter.fs.read = async () => { throw new Error('Storage quota exceeded'); };
    toast.mockClear();
    view.el.querySelector('.file-menu-btn').click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === 'Download').click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Storage quota exceeded', { icon: 'alert' }));
    expect(download).not.toHaveBeenCalled();
    expect(files.get(original)).toBeDefined();
  });

  it('preserves a copy created by another tab after the file list loaded', async () => {
    await setup();
    const other = new Blob(['other tab']);
    files.set('Documents/Report copy.docx', other);
    view.el.querySelector('.file-menu-btn').click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('Duplicate')).click();
    await vi.waitFor(() => expect(puter.fs.write).toHaveBeenCalled());
    expect(files.get('Documents/Report copy.docx')).toBe(other);
    expect(files.get('Documents/Report copy (1).docx')).toBe(files.get(original));
  });

  it('finds the next duplicate name without repeatedly scanning every file', async () => {
    files.set('Documents/REPORT COPY.docx', new Blob(['first copy']));
    for (let i = 2; i <= 200; i++) files.set(`Documents/Report copy ${i}.docx`, new Blob(['copy']));
    await setup();
    view.el.querySelector('[data-path="Documents/Report.docx"] .file-menu-btn').click();
    const duplicate = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('Duplicate'));
    const folded = vi.spyOn(String.prototype, 'toLowerCase');
    duplicate.click();
    await vi.waitFor(() => expect(puter.fs.write).toHaveBeenCalled());
    expect(files.get('Documents/Report copy 201.docx')).toBe(files.get(original));
    // Count work, not wall-clock time: naming must stay linear as copies grow.
    const nameFolds = folded.mock.contexts.filter((value) => /^report(?: copy(?: \d+)?)?\.docx$/i.test(value));
    expect(nameFolds.length).toBeLessThan(10 * files.size);
  });

  it('reads starred state a bounded number of times when rendering a large file list', async () => {
    for (let i = 0; i < 120; i++) files.set(`Documents/File ${i}.docx`, new Blob(['text']));
    localStorage.setItem('documents:starred', JSON.stringify([...files.keys()].filter((path) => path.includes('File'))));
    const reads = vi.spyOn(Storage.prototype, 'getItem');
    await setup();
    const starReads = () => reads.mock.calls.filter(([key]) => key === 'documents:starred').length;
    expect(view.el.querySelectorAll('.file-row')).toHaveLength(121);
    expect(view.el.querySelectorAll('.is-starred')).toHaveLength(120);
    expect(starReads()).toBeLessThan(5);
    reads.mockClear();
    // Read fresh state on each render so changes from another tab are visible.
    localStorage.setItem('documents:starred', '[]');
    const search = view.el.querySelector('.home-search');
    search.value = 'File';
    search.dispatchEvent(new Event('input'));
    expect(view.el.querySelectorAll('.file-row')).toHaveLength(120);
    expect(view.el.querySelectorAll('.is-starred')).toHaveLength(0);
    expect(starReads()).toBeLessThan(5);
  });

  it('keeps keyboard focus on the star button when its row moves', async () => {
    files.set('Documents/Another.docx', new Blob(['text']));
    await setup();
    const button = view.el.querySelector('[aria-label="Star Report.docx"]');
    button.focus();
    button.click();
    expect(view.el.querySelector('.file-name').textContent).toBe('Report');
    expect(document.activeElement).toBe(view.el.querySelector('[aria-label="Unstar Report.docx"]'));
    document.activeElement.click();
    expect(view.el.querySelector('.file-name').textContent).toBe('Another');
    expect(document.activeElement).toBe(view.el.querySelector('[aria-label="Star Report.docx"]'));
  });

  it('does not double the extension when it is typed along with the name', async () => {
    await setup();
    view.el.querySelector(`[data-path="${original}"] .file-menu-btn`).click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('Rename')).click();
    const input = document.querySelector('.modal-panel input');
    input.value = 'Final.DOCX';
    input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(puter.fs.rename).toHaveBeenCalledWith(original, 'Final.docx'));
    await vi.waitFor(() => expect(view.el.querySelector('.file-name').textContent).toBe('Final'));
  });

  it('keeps keyboard focus in the list after renaming and deleting through a row menu', async () => {
    files.set('Documents/Another.docx', new Blob(['text']));
    await setup();
    const button = view.el.querySelector(`[data-path="${original}"] .file-menu-btn`);
    button.focus();
    submitRename();
    await vi.waitFor(() => expect(view.el.querySelector(`[data-path="${renamed}"]`)).not.toBeNull());
    // The list was rebuilt while the dialog closed; focus lands on the renamed row's options, not on <body>.
    await vi.waitFor(() => expect(document.activeElement).toBe(view.el.querySelector(`[data-path="${renamed}"] .file-menu-btn`)));
    puter.fs.delete = vi.fn(async (path) => { files.delete(path); });
    document.activeElement.click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === 'Delete').click();
    document.querySelector('.modal-panel .btn-danger').click();
    await vi.waitFor(() => expect(view.el.querySelector(`[data-path="${renamed}"]`)).toBeNull());
    // The deleted row's place is taken by the next document, which now has focus.
    await vi.waitFor(() => expect(document.activeElement).toBe(view.el.querySelector('[data-path="Documents/Another.docx"] .file-main')));
  });

  it('leaves the search box alone after deleting the last document that matched', async () => {
    files.set('Documents/Another.docx', new Blob(['text']));
    puter.fs.delete = vi.fn(async (path) => { files.delete(path); });
    await setup();
    const search = view.el.querySelector('.home-search');
    search.value = 'rep'; search.dispatchEvent(new Event('input'));
    expect(view.el.querySelectorAll('.file-row')).toHaveLength(1);
    view.el.querySelector(`[data-path="${original}"] .file-menu-btn`).click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === 'Delete').click();
    document.querySelector('.modal-panel .btn-danger').click();
    await vi.waitFor(() => expect(view.el.querySelector('.empty-title')?.textContent).toBe('No matches'));
    search.focus();
    search.value = 'a'; search.dispatchEvent(new Event('input'));
    expect(view.el.querySelectorAll('.file-row')).toHaveLength(1);
    expect(document.activeElement).toBe(search);
  });

  it('keeps keyboard focus on the copy after duplicating when the listing spells paths from the root', async () => {
    // Puter lists files by their absolute path while the app writes the copy by its folder path.
    const root = '/nj';
    puter.fs.readdir = async (dir) => [...files].filter(([path]) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/'))
      .map(([path, blob]) => ({ path: `${root}/${path}`, name: path.split('/').pop(), size: blob.size }));
    puter.fs.read = async (path) => files.get(path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path);
    await setup();
    const button = view.el.querySelector('.file-menu-btn');
    button.focus();
    button.click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === 'Duplicate').click();
    await vi.waitFor(() => expect(view.el.querySelector(`[data-path="${root}/Documents/Report copy.docx"]`)).not.toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(view.el.querySelector(`[data-path="${root}/Documents/Report copy.docx"] .file-menu-btn`)));
  });

  it('returns focus to the same file options after starring through its menu', async () => {
    await setup();
    const button = view.el.querySelector('.file-menu-btn');
    button.focus();
    button.click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === 'Star').click();
    expect(document.activeElement).toBe(view.el.querySelector('.file-menu-btn'));
    expect(view.el.querySelector('[aria-label="Unstar Report.docx"]')).not.toBeNull();
  });

  it('refuses a name made of dots alone', async () => {
    await setup();
    view.el.querySelector(`[data-path="${original}"] .file-menu-btn`).click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('Rename')).click();
    const input = document.querySelector('.modal-panel input');
    for (const value of ['.', '..', ' ... ']) {
      input.value = value;
      document.querySelector('.modal-panel form').requestSubmit();
      await Promise.resolve();
      expect(document.querySelector('.modal-panel .field-error').textContent).toBe('Enter a name');
    }
    expect(puter.fs.rename).not.toHaveBeenCalled();
  });

  it('treats a delete of a file that is already gone as done', async () => {
    await setup();
    const missing = Object.assign(new Error('Subject does not exist'), { code: 'subject_does_not_exist' });
    puter.fs.delete = vi.fn(async () => { throw missing; });
    view.el.querySelector(`[data-path="${original}"] .file-menu-btn`).click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('Delete')).click();
    [...document.querySelectorAll('.modal-panel button')].find((b) => b.textContent === 'Delete').click();
    await vi.waitFor(() => expect(view.el.querySelector(`[data-path="${original}"]`)).toBeNull());
    expect(toast).toHaveBeenCalledWith('Deleted', { icon: 'trash' });
  });

  it('refreshes the list instead of leaving a ghost row when a duplicated file is already gone', async () => {
    await setup();
    const missing = Object.assign(new Error('Subject does not exist'), { code: 'subject_does_not_exist' });
    puter.fs.read = vi.fn(async () => { throw missing; });
    const readdir = vi.spyOn(puter.fs, 'readdir');
    view.el.querySelector(`[data-path="${original}"] .file-menu-btn`).click();
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('Duplicate')).click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('That file no longer exists', { icon: 'alert' }));
    expect(readdir).toHaveBeenCalled();
  });
});
