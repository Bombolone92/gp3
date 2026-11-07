// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu, isMenuOpen } from '../src/ui/menu.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
let view;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(P, 'listFiles').mockResolvedValue([
    { name: 'Report.docx', path: 'Documents/Report.docx', size: 10, modified: 2 },
    { name: 'Notes.docx', path: 'Documents/Notes.docx', size: 10, modified: 1 },
  ]);
  vi.spyOn(P, 'listFolder').mockResolvedValue([]);
  view = homeView({ openPath: vi.fn(), newDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
});
afterEach(() => {
  view.destroy(); closeMenu(); closeAllModals();
  vi.runAllTimers(); document.body.replaceChildren();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const names = () => [...view.el.querySelectorAll('.file-name')].map((n) => n.textContent);
const templates = () => [...view.el.querySelectorAll('button')].find((b) => b.textContent === 'Templates');

it('searches the names as shown, not the file extension', () => {
  const search = view.el.querySelector('.home-search');
  const type = (value) => { search.value = value; search.dispatchEvent(new Event('input')); };
  type('rep');
  expect(names()).toEqual(['Report']);
  // Every document ends in .docx; that is not a match for all of them.
  type('docx');
  expect(names()).toEqual([]);
  type('.');
  expect(names()).toEqual([]);
  type('');
  expect(names()).toEqual(['Report', 'Notes']);
});

it('closes the Templates menu on a second click instead of reopening it', async () => {
  const button = templates();
  expect(button.getAttribute('aria-expanded')).toBe('false');
  button.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(isMenuOpen()).toBe(true);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  // The click that closes it: the pointer goes down outside the menu, then the button's click fires.
  button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  expect(isMenuOpen()).toBe(false);
  button.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(isMenuOpen()).toBe(false);
  expect(button.getAttribute('aria-expanded')).toBe('false');
  // A later click opens it again.
  button.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(isMenuOpen()).toBe(true);
});

it('leaves the ? shortcut to an open dialog or menu', async () => {
  const press = (target) => target.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }));
  view.el.querySelector('.file-menu-btn').click();
  await vi.advanceTimersByTimeAsync(0);
  press(document.querySelector('[role="menuitem"]'));
  expect(document.querySelector('.modal-root')).toBeNull();
  closeMenu();
  [...view.el.querySelectorAll('.file-menu-btn')][0].click();
  [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('Delete')).click();
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelectorAll('.modal-root')).toHaveLength(1);
  press(document.querySelector('.modal-panel button'));
  expect(document.querySelectorAll('.modal-root')).toHaveLength(1);
  closeAllModals();
  await vi.advanceTimersByTimeAsync(300);
  // With nothing on top, the shortcut list opens.
  press(view.el.querySelector('.home-search').parentElement);
  expect(document.querySelector('.modal-panel')?.getAttribute('aria-label')).toBe('Keyboard shortcuts');
});

it('does not open the Templates menu over a menu the user opened while the templates were being listed', async () => {
  let resolveTemplates;
  P.listFolder.mockReturnValueOnce(new Promise((resolve) => { resolveTemplates = resolve; }));
  templates().click();
  await vi.advanceTimersByTimeAsync(0);
  // The menu opens at once with the built-in templates while the user's own are listed.
  expect(document.querySelector('.menu[aria-label="Templates"]')).not.toBeNull();
  // Meanwhile the user opens a document's options.
  view.el.querySelector('.file-menu-btn').click();
  expect(document.querySelector('.menu[aria-label="Report.docx options"]')).not.toBeNull();
  resolveTemplates([]);
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('.menu[aria-label="Report.docx options"]')).not.toBeNull();
  expect(document.querySelector('.menu[aria-label="Templates"]')).toBeNull();
});

it('names the page with a heading', () => {
  expect(view.el.querySelector('h1.brand')?.textContent).toBe('Documents');
});
