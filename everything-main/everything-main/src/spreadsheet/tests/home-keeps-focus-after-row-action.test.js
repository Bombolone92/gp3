// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';
import { homeView } from '../src/views/home.js';
import { session } from '../src/lib/session.js';
import { closeMenu } from '../src/ui/menu.js';

// Deleting, renaming or duplicating a file rebuilds every row, so the ⋮ button the keyboard was on
// left the document and focus fell to <body> — the top of the page, a dozen tab stops from the next
// file. Each rebuild now puts focus back on the same row, the row that took its place, or the heading.

let sdk, view;
const files = [
  { path: 'Spreadsheets/Budget.xlsx', name: 'Budget.xlsx', size: 12, modified: 3 },
  { path: 'Spreadsheets/Plan.xlsx', name: 'Plan.xlsx', size: 14, modified: 2 },
  { path: 'Spreadsheets/Taxes.xlsx', name: 'Taxes.xlsx', size: 16, modified: 1 },
];

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  sdk = {
    env: 'web',
    _signedIn: true,
    _files: files.map((f) => ({ ...f })),
    auth: {
      isSignedIn: () => sdk._signedIn,
      signIn: vi.fn(async () => { sdk._signedIn = true; }),
      getUser: async () => ({ username: 'nariman', uuid: 'u-1' }),
    },
    kv: { get: async () => null, set: async () => true, del: async () => true },
    fs: {
      readdir: vi.fn(async () => sdk._files),
      stat: async () => null,
      mkdir: async () => {},
      read: async () => new Blob([new Uint8Array([1, 2, 3])]),
      write: vi.fn(async (path) => ({ name: path.slice(path.lastIndexOf('/') + 1), path, uid: 'new-uid' })),
      delete: vi.fn(async (path) => { sdk._files = sdk._files.filter((f) => f.path !== path); return true; }),
      rename: vi.fn(async (path, name) => {
        const f = sdk._files.find((x) => x.path === path);
        if (f) { f.name = name; f.path = `Spreadsheets/${name}`; }
        return true;
      }),
    },
    ui: {},
  };
  vi.stubGlobal('puter', sdk);
});

afterEach(() => {
  view?.destroy();
  closeMenu();
  document.body.replaceChildren();
  session.state = 'unknown';
  session.user = null;
  vi.unstubAllGlobals();
});

const tick = async (n = 12) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
const menuItem = (text) => [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes(text));
const dialogButton = (text) => [...document.querySelectorAll('.modal-root button')].find((b) => b.textContent.trim() === text);
const names = () => [...view.el.querySelectorAll('.file-name')].map((n) => n.textContent);

async function mount() {
  await session.init();
  view = homeView({ openPath() {}, newDoc() {}, sampleDoc() {}, templateDoc() {}, importFile() {} });
  document.body.append(view.el);
  await tick(14);
}

/** Open the row's ⋮ menu from the button, with the keyboard on it, and choose an item. */
async function fromRowMenu(index, item) {
  const optionsBtn = [...view.el.querySelectorAll('.file-menu-btn')][index];
  optionsBtn.focus();
  expect(document.activeElement).toBe(optionsBtn);
  optionsBtn.click();
  await tick();
  menuItem(item).click();
  await tick();
  return optionsBtn;
}

it('puts focus on the row that takes a deleted file’s place', async () => {
  await mount();
  await fromRowMenu(0, 'Delete');
  dialogButton('Delete').click();
  await tick(20);
  expect(names()).toEqual(['Plan', 'Taxes']);
  // Not <body>: the ⋮ button of the file that is now first.
  expect(document.activeElement).toBe(view.el.querySelector('.file-row .file-menu-btn'));
  expect(document.activeElement.getAttribute('aria-label')).toBe('Options for Plan');
});

it('keeps focus on the last row when the file at the end is deleted', async () => {
  await mount();
  await fromRowMenu(2, 'Delete');
  dialogButton('Delete').click();
  await tick(20);
  expect(names()).toEqual(['Budget', 'Plan']);
  expect(document.activeElement.getAttribute('aria-label')).toBe('Options for Plan');
});

it('falls back to the list heading when the last file goes', async () => {
  sdk._files = [{ path: 'Spreadsheets/Only.xlsx', name: 'Only.xlsx', size: 9, modified: 1 }];
  await mount();
  await fromRowMenu(0, 'Delete');
  dialogButton('Delete').click();
  await tick(20);
  const heading = view.el.querySelector('.home-list-head .home-h2');
  expect(heading.getAttribute('tabindex')).toBe('-1');
  expect(document.activeElement).toBe(heading);
});

it('holds focus across the reload a rename runs, and lands on the renamed row', async () => {
  await mount();
  await fromRowMenu(1, 'Rename');
  const input = document.querySelector('.modal-root input.input');
  input.value = 'Plan B';
  dialogButton('Rename').click();
  await tick(30);
  expect(names()).toContain('Plan B');
  // The skeleton the reload paints has no rows at all; the note survives it.
  expect(document.activeElement.getAttribute('aria-label')).toBe('Options for Plan B');
});

it('lands on the copy’s neighbour after a duplicate rather than on the body', async () => {
  await mount();
  const before = document.activeElement;
  await fromRowMenu(0, 'Duplicate');
  await tick(30);
  expect(document.activeElement).not.toBe(document.body);
  expect(document.activeElement).not.toBe(before);
  expect(document.activeElement.classList.contains('file-menu-btn')).toBe(true);
});

it('leaves the search field alone while it narrows the list', async () => {
  await mount();
  const search = view.el.querySelector('.home-search');
  search.focus();
  search.value = 'plan';
  search.dispatchEvent(new Event('input'));
  await tick();
  expect(names()).toEqual(['Plan']);
  expect(document.activeElement).toBe(search);
});

it('leaves focus where the user moved it while a reload was in flight', async () => {
  await mount();
  const search = view.el.querySelector('.home-search');
  await fromRowMenu(1, 'Rename');
  document.querySelector('.modal-root input.input').value = 'Plan B';
  dialogButton('Rename').click();
  await tick(2);
  search.focus();
  await tick(30);
  expect(document.activeElement).toBe(search);
});
