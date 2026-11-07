// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import { closeMenu } from '../src/ui/menu.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

let view;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('puter', { fs: {
    mkdir: async () => {},
    readdir: async () => [{ path: 'Documents/Report.docx', name: 'Report.docx', size: 1200, modified: 1 }],
    stat: async () => { throw new Error('missing'); },
  } });
  Object.defineProperty(document.documentElement, 'clientWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true, writable: true });
});
afterEach(() => {
  view?.destroy(); closeMenu(); document.body.replaceChildren();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

async function setup() {
  view = homeView({ openPath: vi.fn(), newDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el);
  await vi.waitFor(() => expect(view.el.querySelector('.file-row')).not.toBeNull());
  return view.el.querySelector('.file-row');
}

it('opens the document menu at the pointer on a right-click', async () => {
  const row = await setup();
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 420, clientY: 260 });
  row.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  const menu = document.querySelector('.menu');
  expect(menu?.getAttribute('aria-label')).toBe('Report.docx options');
  expect(menu.style.left).toBe('420px');
  expect(menu.style.top).toBe('260px');
  expect(row.querySelector('.file-menu-btn').getAttribute('aria-expanded')).toBe('true');
});

it('opens a keyboard-invoked context menu under the menu button', async () => {
  const row = await setup();
  const button = row.querySelector('.file-menu-btn');
  button.getBoundingClientRect = () => ({ left: 700, right: 736, width: 36, top: 100, bottom: 136, height: 36 });
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
  const menu = document.querySelector('.menu');
  expect(menu).not.toBeNull();
  expect(menu.style.top).toBe('140px');
});

it('names the sort button after the current order', async () => {
  await setup();
  const sort = view.el.querySelector('.sort-btn');
  expect(sort.getAttribute('aria-label')).toBe('Sort documents: Last modified');
  sort.click();
  [...document.querySelectorAll('[role="menuitemradio"]')].find((item) => item.textContent.includes('Name')).click();
  expect(sort.getAttribute('aria-label')).toBe('Sort documents: Name');
  expect(sort.textContent).toContain('Name');
});
